-- Safe, single-claim payout worker state. Apply only in isolated development first.
alter table public.arnold_sale_orders
  add column if not exists payout_query_id text,
  add column if not exists payout_wallet_seqno integer,
  add column if not exists payout_attempted_at timestamptz,
  add column if not exists payout_error text;

create unique index if not exists arnold_sale_orders_payout_query_id_uidx
  on public.arnold_sale_orders (payout_query_id)
  where payout_query_id is not null;

create index if not exists arnold_sale_orders_payout_queue_idx
  on public.arnold_sale_orders (paid_at)
  where payment_status = 'paid' and payout_status = 'pending';

revoke all on public.arnold_sale_orders from anon, authenticated;
grant all on public.arnold_sale_orders to service_role;
