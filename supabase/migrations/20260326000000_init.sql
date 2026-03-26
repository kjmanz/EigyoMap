-- pg_trgm（検索用）。PostGIS は拡張が重く Dashboard でタイムアウトしやすいため使わず、
-- 近接判定は下記 find_nearby_customers（ハーバーサイン）で行う。
create extension if not exists pg_trgm;

-- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  role text default 'staff',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- customers
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  address text,
  phone text,
  memo text,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_user_id_idx on public.customers (user_id);
create index if not exists customers_name_trgm on public.customers using gin (name gin_trgm_ops);
create index if not exists customers_address_trgm on public.customers using gin (coalesce(address, '') gin_trgm_ops);

-- 緯度経度の絞り込み用（厳密な距離は find_nearby_customers 内の式で判定）
create index if not exists customers_lat_lng_idx on public.customers (lat, lng);

create or replace function public.set_customers_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_customers_updated on public.customers;
create trigger trg_customers_updated
  before update on public.customers
  for each row execute function public.set_customers_updated_at();

alter table public.customers enable row level security;

create policy "customers_all_own"
  on public.customers for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- labels
create table if not exists public.labels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text not null default '#6b7280',
  created_at timestamptz not null default now()
);

create index if not exists labels_user_id_idx on public.labels (user_id);

alter table public.labels enable row level security;

create policy "labels_all_own"
  on public.labels for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- customer_labels
create table if not exists public.customer_labels (
  customer_id uuid not null references public.customers (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  primary key (customer_id, label_id)
);

alter table public.customer_labels enable row level security;

create policy "customer_labels_select"
  on public.customer_labels for select
  using (
    exists (
      select 1 from public.customers c
      where c.id = customer_id and c.user_id = auth.uid()
    )
  );

create policy "customer_labels_insert"
  on public.customer_labels for insert
  with check (
    exists (
      select 1 from public.customers c
      where c.id = customer_id and c.user_id = auth.uid()
    )
    and exists (
      select 1 from public.labels l
      where l.id = label_id and l.user_id = auth.uid()
    )
  );

create policy "customer_labels_delete"
  on public.customer_labels for delete
  using (
    exists (
      select 1 from public.customers c
      where c.id = customer_id and c.user_id = auth.uid()
    )
  );

-- contact_logs
create table if not exists public.contact_logs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  memo text not null default '',
  visited_at timestamptz not null default now(),
  pinned boolean not null default false,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);

create index if not exists contact_logs_customer_visited_idx
  on public.contact_logs (customer_id, visited_at desc);
create index if not exists contact_logs_user_visited_idx
  on public.contact_logs (user_id, visited_at desc);

alter table public.contact_logs enable row level security;

create policy "contact_logs_all_via_customer"
  on public.contact_logs for all
  using (
    exists (
      select 1 from public.customers c
      where c.id = customer_id and c.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.customers c
      where c.id = customer_id and c.user_id = auth.uid()
    )
  );

-- photos
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  contact_log_id uuid not null references public.contact_logs (id) on delete cascade,
  storage_path text not null,
  thumbnail_path text,
  created_at timestamptz not null default now()
);

create index if not exists photos_contact_idx on public.photos (contact_log_id);

alter table public.photos enable row level security;

create policy "photos_all_via_log"
  on public.photos for all
  using (
    exists (
      select 1 from public.contact_logs cl
      join public.customers c on c.id = cl.customer_id
      where cl.id = contact_log_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.contact_logs cl
      join public.customers c on c.id = cl.customer_id
      where cl.id = contact_log_id and c.user_id = auth.uid()
    )
  );

-- 新規ユーザーで profiles 作成
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 近接顧客（重複チェック）— PostGIS 不要。WGS84 上の大円距離（メートル）で判定。
create or replace function public.find_nearby_customers(p_lat double precision, p_lng double precision, p_meters double precision default 30)
returns table (id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id
  from public.customers c
  where c.user_id = auth.uid()
    and (
      6371000.0 * 2.0 * asin(sqrt(least(1.0::double precision,
        power(sin(radians((c.lat - p_lat) / 2.0)), 2.0)
        + cos(radians(p_lat)) * cos(radians(c.lat))
          * power(sin(radians((c.lng - p_lng) / 2.0)), 2.0)
      )))
    ) <= p_meters;
$$;

grant execute on function public.find_nearby_customers(double precision, double precision, double precision) to authenticated;

-- Storage: 写真（先頭フォルダ = user_id）
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

create policy "photos_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
