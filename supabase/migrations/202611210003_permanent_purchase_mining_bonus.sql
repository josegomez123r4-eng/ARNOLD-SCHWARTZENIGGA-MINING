-- Permanent 0.10% daily mining bonus on cumulative, on-chain-confirmed ARNOLD market purchases.
-- Paid orders are counted once by their unique order id and only after payment_status becomes 'paid'.

alter table arnold.mining_cycles
  add column if not exists purchase_bonus numeric(30,9) not null default 0;

create or replace function public.get_arnold_purchase_mining_bonus(p_user_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_telegram_user_id bigint;
  v_purchased numeric(30,9) := 0;
  v_bonus numeric(30,9) := 0;
  v_base numeric(30,9) := 5;
begin
  select up.telegram_user_id into v_telegram_user_id
  from arnold.user_profiles up
  where up.user_id = p_user_id;

  if v_telegram_user_id is null then
    raise exception 'User profile does not exist';
  end if;

  select coalesce(sum(o.arnold_amount), 0)::numeric(30,9)
    into v_purchased
  from public.arnold_sale_orders o
  where o.telegram_user_id = v_telegram_user_id::text
    and o.payment_status = 'paid';

  select mc.base_reward into v_base
  from arnold.mining_config mc
  where mc.id = 1;

  v_base := coalesce(v_base, 5);
  v_bonus := round(v_purchased * 0.001, 9);

  return pg_catalog.jsonb_build_object(
    'purchased_total', v_purchased,
    'purchase_bonus_daily', v_bonus,
    'base_reward', v_base,
    'daily_reward', v_base + v_bonus,
    'bonus_rate', 0.001
  );
end;
$$;

revoke all on function public.get_arnold_purchase_mining_bonus(uuid) from public, anon, authenticated;
grant execute on function public.get_arnold_purchase_mining_bonus(uuid) to service_role;

create or replace function public.start_arnold_mining(
  p_user_id uuid,
  p_verified_holding_balance numeric
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_config arnold.mining_config%rowtype;
  v_tier arnold.holding_tiers%rowtype;
  v_base numeric(30,9);
  v_holding_bonus numeric(30,9) := 0;
  v_purchase_total numeric(30,9) := 0;
  v_purchase_bonus numeric(30,9) := 0;
  v_total numeric(30,9);
  v_telegram_user_id bigint;
  v_cycle_id uuid;
  v_now timestamptz := pg_catalog.now();
begin
  if p_user_id is null or p_verified_holding_balance is null or p_verified_holding_balance < 0 then
    raise exception 'Invalid user or verified wallet balance';
  end if;

  select * into v_config
  from arnold.mining_config
  where id = 1
  for update;

  if not found or not v_config.mining_enabled then
    raise exception 'Mining is currently disabled';
  end if;

  if v_config.reward_reduction_enabled then
    raise exception 'Reward reduction is not configured yet; mining start is blocked';
  end if;

  select telegram_user_id into v_telegram_user_id
  from arnold.user_profiles
  where user_id = p_user_id;

  if v_telegram_user_id is null then
    raise exception 'User profile does not exist';
  end if;

  if exists (
    select 1 from arnold.mining_cycles
    where user_id = p_user_id and status in ('active','claimable')
  ) then
    raise exception 'An unfinished mining cycle already exists';
  end if;

  v_base := v_config.base_reward;

  select * into v_tier
  from arnold.holding_tiers
  where is_enabled = true
    and minimum_balance <= p_verified_holding_balance
  order by minimum_balance desc
  limit 1;

  if found then
    v_holding_bonus := v_tier.bonus_reward;
  else
    v_tier.id := null;
  end if;

  select coalesce(sum(o.arnold_amount), 0)::numeric(30,9)
    into v_purchase_total
  from public.arnold_sale_orders o
  where o.telegram_user_id = v_telegram_user_id::text
    and o.payment_status = 'paid';

  v_purchase_bonus := round(v_purchase_total * 0.001, 9);
  v_total := v_base + v_holding_bonus + v_purchase_bonus;

  if v_config.remaining_mining_reserve is not null then
    if v_config.remaining_mining_reserve < v_total then
      raise exception 'Insufficient mining reserve';
    end if;
    update arnold.mining_config
    set remaining_mining_reserve = remaining_mining_reserve - v_total,
        updated_at = v_now
    where id = 1;
  end if;

  insert into arnold.mining_cycles (
    user_id, started_at, ends_at, status, base_reward,
    holding_bonus, purchase_bonus, holding_tier_id,
    holding_balance_at_start, total_reward
  )
  values (
    p_user_id, v_now,
    v_now + pg_catalog.make_interval(secs => v_config.cycle_duration_seconds),
    'active', v_base, v_holding_bonus, v_purchase_bonus, v_tier.id,
    p_verified_holding_balance, v_total
  )
  returning id into v_cycle_id;

  return pg_catalog.jsonb_build_object(
    'cycle_id', v_cycle_id,
    'status', 'active',
    'started_at', v_now,
    'ends_at', v_now + pg_catalog.make_interval(secs => v_config.cycle_duration_seconds),
    'base_reward', v_base,
    'holding_bonus_at_start', v_holding_bonus,
    'purchase_total_at_start', v_purchase_total,
    'purchase_bonus_daily', v_purchase_bonus,
    'estimated_reward', v_total
  );
end;
$function$;

create or replace function public.claim_arnold_mining(
  p_user_id uuid,
  p_cycle_id uuid,
  p_verified_holding_balance numeric
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_cycle arnold.mining_cycles%rowtype;
  v_minimum numeric(30,9);
  v_holding_bonus numeric(30,9);
  v_purchase_bonus numeric(30,9);
  v_final numeric(30,9);
  v_refund numeric(30,9) := 0;
  v_referrer uuid;
  v_referral_commission numeric(30,9) := 0;
  v_now timestamptz := pg_catalog.now();
begin
  if p_user_id is null or p_cycle_id is null
     or p_verified_holding_balance is null
     or p_verified_holding_balance < 0 then
    raise exception 'Invalid claim parameters';
  end if;

  select * into v_cycle
  from arnold.mining_cycles
  where id = p_cycle_id and user_id = p_user_id
  for update;

  if not found then raise exception 'Mining cycle not found'; end if;
  if v_cycle.status <> 'active' then raise exception 'Mining cycle is not active or was already claimed'; end if;
  if v_cycle.ends_at > v_now then raise exception 'Mining cycle has not finished yet'; end if;

  v_holding_bonus := v_cycle.holding_bonus;
  v_purchase_bonus := coalesce(v_cycle.purchase_bonus, 0);

  if v_cycle.holding_tier_id is not null then
    select minimum_balance into v_minimum
    from arnold.holding_tiers where id = v_cycle.holding_tier_id;
    if v_minimum is null or p_verified_holding_balance < v_minimum then
      v_holding_bonus := 0;
    end if;
  end if;

  -- Purchase bonus is locked for the full cycle and is never removed by later wallet-balance changes.
  v_final := v_cycle.base_reward + v_holding_bonus + v_purchase_bonus;
  v_refund := v_cycle.total_reward - v_final;

  update arnold.mining_cycles
  set status = 'claimed',
      holding_balance_at_claim = p_verified_holding_balance,
      holding_bonus = v_holding_bonus,
      total_reward = v_final,
      claimed_at = v_now
  where id = p_cycle_id;

  if v_refund > 0 then
    update arnold.mining_config
    set remaining_mining_reserve = case when remaining_mining_reserve is null then null
      else remaining_mining_reserve + v_refund end,
      updated_at = v_now
    where id = 1;
  end if;

  insert into arnold.reward_ledger(user_id, cycle_id, amount, status, claimed_at)
  values (p_user_id, p_cycle_id, v_final, 'claimed', v_now);

  select referrer_user_id into v_referrer
  from arnold.referral_links where referred_user_id = p_user_id;

  if v_referrer is not null and v_final > 0 then
    v_referral_commission := round(v_final * 0.05, 9);
    if v_referral_commission > 0 then
      insert into arnold.referral_rewards(
        referrer_user_id, referred_user_id, source_cycle_id,
        source_reward_amount, commission_rate, amount, status
      ) values (
        v_referrer, p_user_id, p_cycle_id, v_final, 0.05,
        v_referral_commission, 'pending'
      );
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'cycle_id', p_cycle_id,
    'status', 'claimed',
    'base_reward', v_cycle.base_reward,
    'holding_bonus', v_holding_bonus,
    'purchase_bonus', v_purchase_bonus,
    'total_reward', v_final,
    'holding_eligible_at_claim', (v_holding_bonus > 0 or v_cycle.holding_bonus = 0),
    'referral_commission_generated', v_referral_commission,
    'claimed_at', v_now,
    'on_chain_transfer', false
  );
end;
$function$;
