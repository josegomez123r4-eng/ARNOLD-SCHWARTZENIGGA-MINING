-- Persistent, server-authoritative task rewards and seven-day check-ins.
create table if not exists arnold.channel_task_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references arnold.user_profiles(user_id) on delete cascade,
  task_key text not null default 'news_channel',
  amount numeric(20,9) not null default 2 check (amount = 2),
  claimed_at timestamptz not null default now()
);
create index if not exists channel_task_claims_user_claimed_idx
  on arnold.channel_task_claims(user_id, claimed_at desc);

create table if not exists arnold.daily_checkins (
  user_id uuid primary key references arnold.user_profiles(user_id) on delete cascade,
  current_streak integer not null default 0 check (current_streak between 0 and 7),
  last_claim_date date,
  updated_at timestamptz not null default now()
);

alter table arnold.channel_task_claims enable row level security;
alter table arnold.daily_checkins enable row level security;
revoke all on arnold.channel_task_claims, arnold.daily_checkins from anon, authenticated;
grant all on arnold.channel_task_claims, arnold.daily_checkins to service_role;

create or replace function arnold.claim_channel_task(p_telegram_user_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_last timestamptz;
  v_now timestamptz := now();
  v_claim_id uuid;
  v_next timestamptz;
begin
  select user_id into v_user_id
  from arnold.user_profiles
  where telegram_user_id = p_telegram_user_id
  for update;
  if v_user_id is null then raise exception 'TELEGRAM_PROFILE_NOT_FOUND'; end if;

  select max(claimed_at) into v_last
  from arnold.channel_task_claims
  where user_id = v_user_id and task_key = 'news_channel';

  if v_last is not null and v_last + interval '48 hours' > v_now then
    return jsonb_build_object('claimed', false, 'next_available_at', v_last + interval '48 hours');
  end if;

  insert into arnold.channel_task_claims(user_id, task_key, amount, claimed_at)
  values (v_user_id, 'news_channel', 2, v_now)
  returning id into v_claim_id;

  insert into public.user_earnings(telegram_user_id, source, amount, reference_id, created_at)
  values (p_telegram_user_id::text, 'task', 2, 'channel_join:' || v_claim_id::text, v_now);

  return jsonb_build_object('claimed', true, 'amount', 2, 'claimed_at', v_now,
    'next_available_at', v_now + interval '48 hours', 'claim_id', v_claim_id);
end;
$$;

create or replace function arnold.claim_daily_checkin(p_telegram_user_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_today date := (now() at time zone 'UTC')::date;
  v_last date;
  v_streak integer;
  v_next integer;
  v_claim_id uuid := gen_random_uuid();
begin
  select user_id into v_user_id
  from arnold.user_profiles
  where telegram_user_id = p_telegram_user_id
  for update;
  if v_user_id is null then raise exception 'TELEGRAM_PROFILE_NOT_FOUND'; end if;

  insert into arnold.daily_checkins(user_id, current_streak, last_claim_date)
  values (v_user_id, 0, null) on conflict (user_id) do nothing;

  select last_claim_date, current_streak into v_last, v_streak
  from arnold.daily_checkins where user_id = v_user_id for update;

  if v_last = v_today then
    return jsonb_build_object('claimed', false, 'already_claimed', true,
      'streak', v_streak, 'last_claim_date', v_last,
      'next_available_at', ((v_today + 1)::timestamp at time zone 'UTC'));
  end if;

  if v_last = v_today - 1 then
    v_next := case when v_streak >= 7 then 1 else v_streak + 1 end;
  else
    v_next := 1;
  end if;

  update arnold.daily_checkins
  set current_streak = v_next, last_claim_date = v_today, updated_at = now()
  where user_id = v_user_id;

  insert into public.user_earnings(telegram_user_id, source, amount, reference_id, created_at)
  values (p_telegram_user_id::text, 'task', 0.5,
    'daily_checkin:' || p_telegram_user_id::text || ':' || v_today::text, now());

  return jsonb_build_object('claimed', true, 'amount', 0.5, 'streak', v_next,
    'last_claim_date', v_today,
    'next_available_at', ((v_today + 1)::timestamp at time zone 'UTC'),
    'weekly_total', round(v_next * 0.5, 2));
end;
$$;

create or replace function arnold.get_task_rewards_status(p_telegram_user_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_last timestamptz;
  v_streak integer := 0;
  v_last_date date;
  v_today date := (now() at time zone 'UTC')::date;
begin
  select user_id into v_user_id from arnold.user_profiles
  where telegram_user_id = p_telegram_user_id;
  if v_user_id is null then
    return jsonb_build_object('channel_next_available_at', null, 'checkin_streak', 0,
      'checkin_claimed_today', false, 'checkin_next_available_at', ((v_today + 1)::timestamp at time zone 'UTC'));
  end if;
  select max(claimed_at) into v_last from arnold.channel_task_claims
  where user_id = v_user_id and task_key = 'news_channel';
  select current_streak, last_claim_date into v_streak, v_last_date
  from arnold.daily_checkins where user_id = v_user_id;
  return jsonb_build_object(
    'channel_last_claimed_at', v_last,
    'channel_next_available_at', case when v_last is null then null else v_last + interval '48 hours' end,
    'checkin_streak', case when v_last_date is null or v_last_date < v_today - 1 then 0 else coalesce(v_streak, 0) end,
    'checkin_claimed_today', v_last_date = v_today,
    'checkin_last_claim_date', v_last_date,
    'checkin_next_available_at', ((v_today + 1)::timestamp at time zone 'UTC')
  );
end;
$$;

revoke all on function arnold.claim_channel_task(bigint) from public, anon, authenticated;
revoke all on function arnold.claim_daily_checkin(bigint) from public, anon, authenticated;
revoke all on function arnold.get_task_rewards_status(bigint) from public, anon, authenticated;
grant execute on function arnold.claim_channel_task(bigint) to service_role;
grant execute on function arnold.claim_daily_checkin(bigint) to service_role;
grant execute on function arnold.get_task_rewards_status(bigint) to service_role;
