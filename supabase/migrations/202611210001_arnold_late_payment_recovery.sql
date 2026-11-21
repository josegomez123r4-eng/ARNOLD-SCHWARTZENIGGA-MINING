-- Recover an expired Arnold sale order only after arnold-sale has
-- verified the exact incoming TON transaction (sender, treasury, amount and memo).
create or replace function public.confirm_arnold_sale_payment(
  p_order_id uuid,
  p_payment_tx_hash text
)
returns public.arnold_sale_orders
language plpgsql
set search_path to ''
as $function$
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

  if not found then
    raise exception 'SALE_ORDER_NOT_FOUND';
  end if;

  if v_order.payment_status = 'paid' and v_order.payment_tx_hash = p_payment_tx_hash then
    return v_order;
  end if;

  if v_order.payment_status not in ('pending', 'expired') then
    raise exception 'SALE_ORDER_NOT_PAYABLE';
  end if;

  if v_order.payment_status = 'pending' then
    -- Reservation still exists: convert it atomically into sold tokens.
    update public.arnold_sale_phases
    set tokens_reserved = tokens_reserved - v_order.arnold_amount,
        tokens_sold = tokens_sold + v_order.arnold_amount,
        updated_at = now()
    where phase_number = v_order.phase_number
      and tokens_reserved >= v_order.arnold_amount;
  else
    -- Expiry cron already released the reservation. Re-check remaining capacity
    -- before honoring the late but exact payment.
    update public.arnold_sale_phases
    set tokens_sold = tokens_sold + v_order.arnold_amount,
        updated_at = now()
    where phase_number = v_order.phase_number
      and token_allocation - tokens_sold - tokens_reserved >= v_order.arnold_amount;
  end if;

  if not found then
    raise exception 'SALE_RESERVATION_INTEGRITY_ERROR';
  end if;

  update public.arnold_sale_orders
  set payment_status = 'paid',
      payout_status = 'pending',
      payment_tx_hash = p_payment_tx_hash,
      paid_at = now(),
      updated_at = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$function$;
