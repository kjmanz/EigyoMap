-- ソフトデリート（顧客・メモ）と 30 日以内の復元。期限切れの物理削除は purge_expired_soft_deletes() または Edge Function で実行。

alter table public.customers add column if not exists deleted_at timestamptz;
alter table public.contact_logs add column if not exists deleted_at timestamptz;

create index if not exists customers_user_deleted_idx on public.customers (user_id, deleted_at);
create index if not exists contact_logs_customer_deleted_idx on public.contact_logs (customer_id, deleted_at);
create index if not exists contact_logs_deleted_purge_idx on public.contact_logs (deleted_at)
  where deleted_at is not null;
create index if not exists customers_deleted_purge_idx on public.customers (deleted_at)
  where deleted_at is not null;

-- 認証ユーザーは SELECT/INSERT/UPDATE のみ（DELETE はサービスロール／パージ用関数のみ想定）
drop policy if exists "customers_all_own" on public.customers;
create policy "customers_select_own"
  on public.customers for select
  using (auth.uid() = user_id);
create policy "customers_insert_own"
  on public.customers for insert
  with check (auth.uid() = user_id);
create policy "customers_update_own"
  on public.customers for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "contact_logs_all_via_customer" on public.contact_logs;
create policy "contact_logs_select"
  on public.contact_logs for select
  using (
    exists (
      select 1 from public.customers c
      where c.id = customer_id and c.user_id = auth.uid()
    )
  );
create policy "contact_logs_insert"
  on public.contact_logs for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.customers c
      where c.id = customer_id and c.user_id = auth.uid() and c.deleted_at is null
    )
  );
create policy "contact_logs_update"
  on public.contact_logs for update
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
      where c.id = customer_id and c.user_id = auth.uid() and c.deleted_at is null
    )
  );

drop policy if exists "customer_labels_select" on public.customer_labels;
drop policy if exists "customer_labels_insert" on public.customer_labels;
drop policy if exists "customer_labels_delete" on public.customer_labels;

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
      where c.id = customer_id and c.user_id = auth.uid() and c.deleted_at is null
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
      where c.id = customer_id and c.user_id = auth.uid() and c.deleted_at is null
    )
  );

drop policy if exists "photos_all_via_log" on public.photos;
create policy "photos_select_via_log"
  on public.photos for select
  using (
    exists (
      select 1 from public.contact_logs cl
      join public.customers c on c.id = cl.customer_id
      where cl.id = contact_log_id and c.user_id = auth.uid()
    )
  );
create policy "photos_insert_via_log"
  on public.photos for insert
  with check (
    exists (
      select 1 from public.contact_logs cl
      join public.customers c on c.id = cl.customer_id
      where cl.id = contact_log_id and c.user_id = auth.uid()
        and c.deleted_at is null and cl.deleted_at is null
    )
  );
create policy "photos_update_via_log"
  on public.photos for update
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
        and c.deleted_at is null and cl.deleted_at is null
    )
  );
create policy "photos_delete_via_log"
  on public.photos for delete
  using (
    exists (
      select 1 from public.contact_logs cl
      join public.customers c on c.id = cl.customer_id
      where cl.id = contact_log_id and c.user_id = auth.uid()
        and c.deleted_at is null and cl.deleted_at is null
    )
  );

-- 削除済み顧客は近接検索に出さない
create or replace function public.find_nearby_customers(
  p_lat double precision,
  p_lng double precision,
  p_meters double precision default 30
)
returns table (id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id
  from public.customers c
  where c.user_id = auth.uid()
    and c.deleted_at is null
    and (
      6371000.0 * 2.0 * asin(sqrt(least(1.0::double precision,
        power(sin(radians((c.lat - p_lat) / 2.0)), 2.0)
        + cos(radians(p_lat)) * cos(radians(c.lat))
          * power(sin(radians((c.lng - p_lng) / 2.0)), 2.0)
      )))
    ) <= p_meters;
$$;

-- 復元は削除から 30 日以内のみ（クライアント改ざん対策）
create or replace function public.enforce_restore_window_customers()
returns trigger language plpgsql as $$
begin
  if old.deleted_at is not null and new.deleted_at is null then
    if old.deleted_at < now() - interval '30 days' then
      raise exception 'restore_deadline_expired' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_customers_restore_window on public.customers;
create trigger trg_customers_restore_window
  before update on public.customers
  for each row execute function public.enforce_restore_window_customers();

create or replace function public.enforce_restore_window_contact_logs()
returns trigger language plpgsql as $$
begin
  if old.deleted_at is not null and new.deleted_at is null then
    if old.deleted_at < now() - interval '30 days' then
      raise exception 'restore_deadline_expired' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contact_logs_restore_window on public.contact_logs;
create trigger trg_contact_logs_restore_window
  before update on public.contact_logs
  for each row execute function public.enforce_restore_window_contact_logs();

-- 期限切れソフトデリートの物理削除（Storage は別途 Edge Function 等で掃除推奨）
create or replace function public.purge_expired_soft_deletes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_logs int;
  n_cust int;
begin
  delete from public.contact_logs
  where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics n_logs = row_count;

  delete from public.customers
  where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics n_cust = row_count;

  return jsonb_build_object('deleted_contact_logs', n_logs, 'deleted_customers', n_cust);
end;
$$;

revoke all on function public.purge_expired_soft_deletes() from public;
grant execute on function public.purge_expired_soft_deletes() to service_role;
