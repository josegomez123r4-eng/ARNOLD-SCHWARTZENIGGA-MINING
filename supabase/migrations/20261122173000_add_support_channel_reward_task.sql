-- Add an independent 48-hour reward cycle for the ARNOLD support channel.
-- Existing news-channel and daily check-in claims remain unchanged.
CREATE OR REPLACE FUNCTION public.claim_arnold_task_reward(
  p_telegram_user_id text,
  p_task_key text,
  p_channel_verified boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_now timestamptz := pg_catalog.now();
  v_today date := (pg_catalog.now() at time zone 'UTC')::date;
  v_yesterday date := ((pg_catalog.now() at time zone 'UTC')::date - 1);
  v_last_claim timestamptz;
  v_last_date date;
  v_streak smallint := 0;
  v_next_streak smallint := 0;
  v_amount numeric(20,6);
  v_claim_id uuid := gen_random_uuid();
begin
  if p_telegram_user_id is null or p_telegram_user_id !~ '^[0-9]{1,20}$' then
    raise exception 'INVALID_TELEGRAM_USER_ID';
  end if;
  if p_task_key is null or p_task_key not in ('channel_join','support_channel_join','daily_checkin') then
    raise exception 'INVALID_TASK_KEY';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_telegram_user_id || ':' || p_task_key, 0));

  if p_task_key in ('channel_join','support_channel_join') then
    if coalesce(p_channel_verified,false) is not true then
      return pg_catalog.jsonb_build_object('claimed',false,'error',case when p_task_key='support_channel_join' then 'SUPPORT_CHANNEL_MEMBERSHIP_REQUIRED' else 'CHANNEL_MEMBERSHIP_REQUIRED' end);
    end if;
    select claimed_at into v_last_claim from public.task_reward_claims
      where telegram_user_id=p_telegram_user_id and task_key=p_task_key
      order by claimed_at desc limit 1;
    if v_last_claim is not null and v_last_claim + interval '48 hours' > v_now then
      return pg_catalog.jsonb_build_object('claimed',false,
        'error',case when p_task_key='support_channel_join' then 'SUPPORT_CHANNEL_COOLDOWN' else 'CHANNEL_COOLDOWN' end,
        'next_available_at',v_last_claim + interval '48 hours');
    end if;
    v_amount := 2;
  else
    insert into public.task_checkin_state(telegram_user_id) values(p_telegram_user_id) on conflict(telegram_user_id) do nothing;
    select current_streak,last_claim_date into v_streak,v_last_date
      from public.task_checkin_state where telegram_user_id=p_telegram_user_id for update;
    if v_last_date = v_today then
      return pg_catalog.jsonb_build_object('claimed',false,'error','CHECKIN_ALREADY_CLAIMED','streak',v_streak,'next_available_at',((v_today + 1)::timestamp at time zone 'UTC'));
    end if;
    if v_last_date = v_yesterday then
      v_next_streak := case when v_streak >= 7 then 1 else v_streak + 1 end;
    else
      v_next_streak := 1;
    end if;
    v_amount := 0.5;
  end if;

  insert into public.task_reward_claims(id,telegram_user_id,task_key,amount,claim_date,claimed_at)
    values(v_claim_id,p_telegram_user_id,p_task_key,v_amount,v_today,v_now);
  insert into public.user_earnings(telegram_user_id,source,amount,reference_id)
    values(p_telegram_user_id,'task',v_amount,'task:' || p_task_key || ':' || v_claim_id::text)
    on conflict(source,reference_id) do nothing;

  if p_task_key = 'daily_checkin' then
    update public.task_checkin_state set current_streak=v_next_streak,last_claim_date=v_today,updated_at=v_now
      where telegram_user_id=p_telegram_user_id;
    return pg_catalog.jsonb_build_object('claimed',true,'amount',v_amount,'streak',v_next_streak,'next_available_at',((v_today + 1)::timestamp at time zone 'UTC'),'claim_id',v_claim_id);
  end if;
  return pg_catalog.jsonb_build_object('claimed',true,'amount',v_amount,'next_available_at',v_now + interval '48 hours','claim_id',v_claim_id);
end;
$function$;
