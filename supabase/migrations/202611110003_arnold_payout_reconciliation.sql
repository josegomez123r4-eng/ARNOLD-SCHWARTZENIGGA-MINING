-- Finalize a Jetton payout only after the reconciler proves the recipient notification on-chain.
create or replace function public.confirm_arnold_sale_payout(
  p_order_id uuid,
  p_payout_tx_hash text,
  p_payout_query_id text
) returns public.arnold_sale_orders
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.arnold_sale_orders%rowtype;
begin
  if p_payout_tx_hash is null or length(p_payout_tx_hash) < 20
     or p_payout_query_id is null or p_payout_query_id = '' then
    raise exception 'INVALID_PAYOUT_REFERENCE';
  end if;

  select * into v_order
  from public.arnold_sale_orders
  where id = p_order_id
  for update;

  if not found then raise exception 'SALE_ORDER_NOT_FOUND'; end if;

  if v_order.payout_status = 'fulfilled'
     and v_order.payout_tx_hash = p_payout_tx_hash
     and v_order.payout_query_id = p_payout_query_id then
    return v_order;
  end if;

  if v_order.payment_status <> 'paid'
     or v_order.payout_status <> 'processing'
     or v_order.payout_query_id <> p_payout_query_id
     or v_order.payout_attempted_at is null then
    raise exception 'PAYOUT_NOT_RECONCILABLE';
  end if;

  update public.arnold_sale_orders
  set payout_status = 'fulfilled',
      payout_tx_hash = p_payout_tx_hash,
      fulfilled_at = now(),
      payout_error = null,
      updated_at = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.confirm_arnold_sale_payout(uuid,text,text) from public, anon, authenticated;
grant execute on function public.confirm_arnold_sale_payout(uuid,text,text) to service_role;
