-- Real Telegram-to-wallet verification for ARNOLD.
create table if not exists public.telegram_wallet_verification_intents (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id text not null,
  wallet_address text not null,
  memo text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists telegram_wallet_verification_intents_user_idx
  on public.telegram_wallet_verification_intents (telegram_user_id, created_at desc);

create table if not exists public.telegram_wallet_links (
  telegram_user_id text primary key,
  wallet_address text not null unique,
  payment_tx_hash text not null unique,
  verified_at timestamptz not null default now()
);

alter table public.telegram_wallet_verification_intents enable row level security;
alter table public.telegram_wallet_links enable row level security;
revoke all on public.telegram_wallet_verification_intents from anon, authenticated;
revoke all on public.telegram_wallet_links from anon, authenticated;
grant all on public.telegram_wallet_verification_intents to service_role;
grant all on public.telegram_wallet_links to service_role;
