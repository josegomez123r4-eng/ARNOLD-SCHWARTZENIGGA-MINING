-- Referral reward claim requests. Rewards are reserved atomically and can be paid
-- only by a separately authorized payout worker; a UI click never marks rewards paid.
alter table arnold.referral_rewards drop constraint if exists referral_rewards_status_check;
alter table arnold.referral_rewards add constraint referral_rewards_status_check
  check (status = any (array['pending'::text,'reserved'::text,'paid'::text,'void'::text]));

create table if not exists public.arnold_referral_claim_requests (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references arnold.user_profiles(user_id),
  wallet_address text not null,
  amount numeric(30,9) not null check (amount > 0),
  status text not null default 'requested' check (status in ('requested','processing','paid','failed')),
  payout_tx_hash text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists arnold_referral_claim_requests_user_idx
  on public.arnold_referral_claim_requests(referrer_user_id,created_at desc);

create table if not exists public.arnold_referral_claim_items (
  claim_id uuid not null references public.arnold_referral_claim_requests(id),
  referral_reward_id uuid not null unique references arnold.referral_rewards(id),
  amount numeric(30,9) not null check (amount > 0),
  primary key (claim_id,referral_reward_id)
);

alter table public.arnold_referral_claim_requests enable row level security;
alter table public.arnold_referral_claim_items enable row level security;
revoke all on public.arnold_referral_claim_requests,public.arnold_referral_claim_items from anon,authenticated;
grant all on public.arnold_referral_claim_requests,public.arnold_referral_claim_items to service_role;

create or replace function public.request_arnold_referral_claim(p_referrer_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet text;
  v_claim_id uuid;
  v_total numeric(30,9);
  v_count integer;
begin
  select wallet_address into v_wallet
  from arnold.wallet_links
  where user_id=p_referrer_user_id and is_verified=true and is_primary=true
  for update;
  if v_wallet is null then
    return jsonb_build_object('requested',false,'error','VERIFIED_WALLET_REQUIRED');
  end if;

  if exists (
    select 1 from public.arnold_referral_claim_requests
    where referrer_user_id=p_referrer_user_id and status in ('requested','processing')
  ) then
    return jsonb_build_object('requested',false,'error','CLAIM_ALREADY_IN_PROCESS');
  end if;

  select coalesce(sum(amount),0),count(*) into v_total,v_count
  from arnold.referral_rewards
  where referrer_user_id=p_referrer_user_id and status='pending';
  if v_count=0 or v_total<=0 then
    return jsonb_build_object('requested',false,'error','NO_REFERRAL_REWARDS_AVAILABLE');
  end if;

  v_claim_id := gen_random_uuid();
  insert into public.arnold_referral_claim_requests(id,referrer_user_id,wallet_address,amount)
  values(v_claim_id,p_referrer_user_id,v_wallet,v_total);

  insert into public.arnold_referral_claim_items(claim_id,referral_reward_id,amount)
  select v_claim_id,id,amount from arnold.referral_rewards
  where referrer_user_id=p_referrer_user_id and status='pending'
  for update;

  update arnold.referral_rewards
  set status='reserved'
  where id in (select referral_reward_id from public.arnold_referral_claim_items where claim_id=v_claim_id)
    and status='pending';

  return jsonb_build_object('requested',true,'claim_id',v_claim_id,'amount',v_total,'items',v_count);
end;
$$;

revoke all on function public.request_arnold_referral_claim(uuid) from public,anon,authenticated;
grant execute on function public.request_arnold_referral_claim(uuid) to service_role;
