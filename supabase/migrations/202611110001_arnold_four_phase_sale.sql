-- ARNOLD four-phase sale: private server-side order ledger.
create table if not exists public.arnold_sale_phases (
  phase_number smallint primary key check (phase_number between 1 and 4),
  token_allocation numeric(38,18) not null check (token_allocation > 0),
  tokens_reserved numeric(38,18) not null default 0 check (tokens_reserved >= 0),
  tokens_sold numeric(38,18) not null default 0 check (tokens_sold >= 0),
  price_usd numeric(20,10) not null check (price_usd > 0),
  updated_at timestamptz not null default now(),
  check (tokens_reserved + tokens_sold <= token_allocation)
);

insert into public.arnold_sale_phases
  (phase_number, token_allocation, price_usd)
values
  (1, 50000, 0.003),
  (2, 50000, 0.0045),
  (3, 50000, 0.0065),
  (4, 50000, 0.008)
on conflict (phase_number) do nothing;

create table if not exists public.arnold_sale_orders (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id text not null,
  buyer_wallet_address text not null,
  phase_number smallint not null references public.arnold_sale_phases(phase_number),
  gram_nano bigint not null check (gram_nano > 0),
  ton_usd numeric(20,10) not null check (ton_usd > 0),
  arnold_usd numeric(20,10) not null check (arnold_usd > 0),
  arnold_amount numeric(38,18) not null check (arnold_amount > 0),
  quote_source text not null,
  quote_timestamp timestamptz not null,
  payment_status text not null default 'pending'
    check (payment_status in ('pending','paid','failed','expired')),
  payout_status text not null default 'not_started'
    check (payout_status in ('not_started','pending','processing','fulfilled','failed')),
  payment_tx_hash text unique,
  payout_tx_hash text unique,
  expires_at timestamptz not null,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists arnold_sale_orders_user_created_idx
  on public.arnold_sale_orders (telegram_user_id, created_at desc);
create index if not exists arnold_sale_orders_pending_expiry_idx
  on public.arnold_sale_orders (expires_at)
  where payment_status = 'pending';

alter table public.arnold_sale_phases enable row level security;
alter table public.arnold_sale_orders enable row level security;
revoke all on public.arnold_sale_phases from anon, authenticated;
revoke all on public.arnold_sale_orders from anon, authenticated;
grant all on public.arnold_sale_phases to service_role;
grant all on public.arnold_sale_orders to service_role;

create or replace function public.reserve_arnold_sale_order(
  p_telegram_user_id text,
  p_buyer_wallet_address text,
  p_gram_nano bigint,
  p_ton_usd numeric,
  p_arnold_usd numeric,
  p_arnold_amount numeric,
  p_quote_source text,
  p_quote_timestamp timestamptz,
  p_expires_at timestamptz
) returns public.arnold_sale_orders
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_phase public.arnold_sale_phases%rowtype;
  v_order public.arnold_sale_orders%rowtype;
begin
  if p_telegram_user_id is null or p_telegram_user_id = ''
     or p_buyer_wallet_address is null or length(p_buyer_wallet_address) < 40
     or p_gram_nano not in (1000000000,3000000000,5000000000,10000000000,50000000000)
     or p_ton_usd <= 0 or p_arnold_usd <= 0 or p_arnold_amount <= 0
     or p_quote_timestamp < now() - interval '2 minutes'
     or p_quote_timestamp > now() + interval '15 seconds'
     or p_expires_at <= now() then
    raise exception 'INVALID_SALE_ORDER_INPUT';
  end if;

  select * into v_phase
  from public.arnold_sale_phases
  where tokens_sold < token_allocation
  order by phase_number
  limit 1
  for update;

  if not found then
    raise exception 'SALE_SOLD_OUT';
  end if;

  if v_phase.price_usd <> p_arnold_usd then
    raise exception 'SALE_PRICE_CHANGED';
  end if;

  if v_phase.tokens_sold + v_phase.tokens_reserved + p_arnold_amount > v_phase.token_allocation then
    raise exception 'PHASE_CAPACITY_TEMPORARILY_RESERVED';
  end if;

  update public.arnold_sale_phases
    set tokens_reserved = tokens_reserved + p_arnold_amount, updated_at = now()
    where phase_number = v_phase.phase_number;

  insert into public.arnold_sale_orders (
    telegram_user_id, buyer_wallet_address, phase_number, gram_nano,
    ton_usd, arnold_usd, arnold_amount, quote_source, quote_timestamp, expires_at
  ) values (
    p_telegram_user_id, p_buyer_wallet_address, v_phase.phase_number, p_gram_nano,
    p_ton_usd, p_arnold_usd, p_arnold_amount, p_quote_source, p_quote_timestamp, p_expires_at
  ) returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.confirm_arnold_sale_payment(
  p_order_id uuid,
  p_payment_tx_hash text
) returns public.arnold_sale_orders
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.arnold_sale_orders%rowtype;
begin
  if p_payment_tx_hash is null or length(p_payment_tx_hash) < 20 then
    raise exception 'INVALID_PAYMENT_REFERENCE';
  end if;

  select * into v_order
  from public.arnold_sale_orders
  where id = p_order_id
  for update;

  if not found then raise exception 'SALE_ORDER_NOT_FOUND'; end if;
  if v_order.payment_status = 'paid' and v_order.payment_tx_hash = p_payment_tx_hash then
    return v_order;
  end if;
  if v_order.payment_status <> 'pending' or v_order.expires_at <= now() then
    raise exception 'SALE_ORDER_NOT_PAYABLE';
  end if;

  update public.arnold_sale_phases
  set tokens_reserved = tokens_reserved - v_order.arnold_amount,
      tokens_sold = tokens_sold + v_order.arnold_amount,
      updated_at = now()
  where phase_number = v_order.phase_number
    and tokens_reserved >= v_order.arnold_amount;

  if not found then raise exception 'SALE_RESERVATION_INTEGRITY_ERROR'; end if;

  update public.arnold_sale_orders
  set payment_status = 'paid', payout_status = 'pending',
      payment_tx_hash = p_payment_tx_hash, paid_at = now(), updated_at = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.expire_arnold_sale_orders()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.arnold_sale_orders%rowtype;
  v_count integer := 0;
begin
  for v_order in
    select * from public.arnold_sale_orders
    where payment_status = 'pending' and expires_at <= now()
    for update skip locked
  loop
    update public.arnold_sale_phases
      set tokens_reserved = tokens_reserved - v_order.arnold_amount, updated_at = now()
      where phase_number = v_order.phase_number
        and tokens_reserved >= v_order.arnold_amount;
    update public.arnold_sale_orders
      set payment_status = 'expired', updated_at = now()
      where id = v_order.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.reserve_arnold_sale_order(text,text,bigint,numeric,numeric,numeric,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.confirm_arnold_sale_payment(uuid,text) from public, anon, authenticated;
revoke all on function public.expire_arnold_sale_orders() from public, anon, authenticated;
grant execute on function public.reserve_arnold_sale_order(text,text,bigint,numeric,numeric,numeric,text,timestamptz,timestamptz) to service_role;
grant execute on function public.confirm_arnold_sale_payment(uuid,text) to service_role;
grant execute on function public.expire_arnold_sale_orders() to service_role;
