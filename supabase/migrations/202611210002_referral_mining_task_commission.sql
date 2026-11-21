-- Referral commissions: 5% only on task rewards and mining claims.
-- A referral link is activated only after the invited user's wallet verification.

alter table arnold.referral_rewards
  add column if not exists source_earning_id uuid;

create unique index if not exists referral_rewards_source_earning_uidx
  on arnold.referral_rewards (source_earning_id)
  where source_earning_id is not null;

create or replace function public.award_arnold_task_referral_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referred_user_id uuid;
  v_referrer_user_id uuid;
  v_amount numeric(30,9);
begin
  if new.source <> 'task' or new.amount is null or new.amount <= 0 then
    return new;
  end if;

  select up.user_id into v_referred_user_id
  from arnold.user_profiles up
  where up.telegram_user_id::text = new.telegram_user_id;

  if v_referred_user_id is null then
    return new;
  end if;

  -- referral_links is created only after the referred wallet is verified.
  select rl.referrer_user_id into v_referrer_user_id
  from arnold.referral_links rl
  join arnold.wallet_links wl
    on wl.user_id = rl.referred_user_id
   and wl.is_verified = true
   and wl.is_primary = true
  where rl.referred_user_id = v_referred_user_id;

  if v_referrer_user_id is null then
    return new;
  end if;

  v_amount := round(new.amount * 0.05, 9);
  if v_amount <= 0 then
    return new;
  end if;

  insert into arnold.referral_rewards (
    referrer_user_id, referred_user_id, source_earning_id,
    source_reward_amount, commission_rate, amount, status
  ) values (
    v_referrer_user_id, v_referred_user_id, new.id,
    new.amount, 0.05, v_amount, 'pending'
  )
  on conflict (source_earning_id) where source_earning_id is not null do nothing;

  return new;
end;
$$;

drop trigger if exists arnold_task_referral_commission on public.user_earnings;
create trigger arnold_task_referral_commission
after insert on public.user_earnings
for each row
when (new.source = 'task' and new.amount > 0)
execute function public.award_arnold_task_referral_commission();

comment on function public.award_arnold_task_referral_commission() is
  'Credits 5% of verified referred users task earnings only; excludes all purchases.';
