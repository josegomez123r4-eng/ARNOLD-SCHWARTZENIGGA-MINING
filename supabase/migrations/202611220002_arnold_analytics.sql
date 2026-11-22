-- ARNOLD analytics: privacy-conscious Telegram entry and Mini App activity tracking.
-- Raw Telegram IDs are stored only server-side; no wallet data or message content is collected.
create table if not exists public.arnold_analytics_events (
  id bigint generated always as identity primary key,
  telegram_user_id bigint not null,
  event_type text not null check (event_type in ('bot_start', 'mini_app_open')),
  event_day date not null default (timezone('utc', now())::date),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  event_count integer not null default 1 check (event_count > 0),
  unique (telegram_user_id, event_type, event_day)
);

create index if not exists arnold_analytics_events_day_idx
  on public.arnold_analytics_events (event_day, event_type);
create index if not exists arnold_analytics_events_user_idx
  on public.arnold_analytics_events (telegram_user_id, event_day);

alter table public.arnold_analytics_events enable row level security;
revoke all on public.arnold_analytics_events from anon, authenticated;
grant all on public.arnold_analytics_events to service_role;

-- Atomic daily deduplication: one row per Telegram user, event type and UTC day.
create or replace function public.record_arnold_analytics_event(
  p_telegram_user_id bigint,
  p_event_type text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_telegram_user_id is null or p_telegram_user_id <= 0 then
    raise exception 'invalid Telegram user id';
  end if;
  if p_event_type not in ('bot_start', 'mini_app_open') then
    raise exception 'invalid analytics event';
  end if;

  insert into public.arnold_analytics_events
    (telegram_user_id, event_type, event_day)
  values
    (p_telegram_user_id, p_event_type, timezone('utc', now())::date)
  on conflict (telegram_user_id, event_type, event_day)
  do update set
    last_seen_at = now(),
    event_count = public.arnold_analytics_events.event_count + 1;
end;
$$;

revoke all on function public.record_arnold_analytics_event(bigint, text) from public, anon, authenticated;
grant execute on function public.record_arnold_analytics_event(bigint, text) to service_role;
