-- タイムラインのピン留め（既存 DB 向け。新規で init のみ流した場合はスキップされる）
alter table public.contact_logs
  add column if not exists pinned boolean not null default false;

create index if not exists contact_logs_customer_pinned_visited_idx
  on public.contact_logs (customer_id, pinned desc, visited_at desc);
