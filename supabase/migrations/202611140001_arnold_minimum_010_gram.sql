-- Allow 0.10 GRAM as the minimum ARNOLD sale order while preserving existing packages.
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
     or p_gram_nano not in (100000000,1000000000,3000000000,5000000000,10000000000,50000000000)
     or p_ton_usd <= 0 or p_arnold_usd <= 0 or p_arnold_amount <= 0
     or p_quote_timestamp < now() - interval '2 minutes'
     or p_quote_timestamp > now() + interval '15 seconds'
     or p_expires_at <= now() then
    raise exception 'INVALID_SALE_ORDER_INPUT';
  end if;
  select * into v_phase from public.arnold_sale_phases
    where tokens_sold < token_allocation order by phase_number limit 1 for update;
  if not found then raise exception 'SALE_SOLD_OUT'; end if;
  if v_phase.price_usd <> p_arnold_usd then raise exception 'SALE_PRICE_CHANGED'; end if;
  if v_phase.tokens_sold + v_phase.tokens_reserved + p_arnold_amount > v_phase.token_allocation then
    raise exception 'PHASE_CAPACITY_TEMPORARILY_RESERVED';
  end if;
  update public.arnold_sale_phases set tokens_reserved = tokens_reserved + p_arnold_amount, updated_at = now()
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
