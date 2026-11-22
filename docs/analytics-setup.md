# ARNOLD analytics setup

This feature is intentionally isolated on `feature/arnold-analytics`. It does not change mining, rewards, wallet verification, sales, or the production deployment.

## Events

- `mini_app_open`: recorded by the Mini App only after Telegram `initData` is validated server-side.
- `bot_start`: supported for the Telegram bot's `/start` handler. The bot handler must call the Edge Function after parsing the Telegram sender ID, using the private webhook secret. This event is not counted until that bot integration is configured.
- Daily rows are deduplicated per Telegram user and event type. `event_count` tracks repeat events that day.
- The private summary endpoint reports the last 30 days, registrations from `arnold.user_profiles`, and verified wallets from `telegram_wallet_links`.

## Required Supabase setup (not applied yet)

1. Apply migration `202611220002_arnold_analytics.sql`.
2. Deploy Edge Function `arnold-analytics` with `verify_jwt = false` (it validates Telegram initData itself).
3. Configure Edge Function secrets:
   - `TELEGRAM_BOT_TOKEN`: token for the official Arnold bot.
   - `ARNOLD_ANALYTICS_WEBHOOK_SECRET`: long random secret used only by the bot's /start integration.
   - `ARNOLD_ANALYTICS_ADMIN_SECRET`: long random secret for the private statistics endpoint.
   - Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Edge Functions.

## Bot /start integration

After the bot has verified a real Telegram update and extracted `message.from.id`, send:

```http
POST https://<project-ref>.supabase.co/functions/v1/arnold-analytics
Content-Type: application/json
x-arnold-analytics-secret: <ARNOLD_ANALYTICS_WEBHOOK_SECRET>

{"eventType":"bot_start","telegramUserId":123456789}
```

Do not call this endpoint from the browser. Only the trusted bot webhook should know the secret.

## Private stats endpoint

Send a POST request with `{"action":"stats"}` and header `x-arnold-analytics-admin: <ARNOLD_ANALYTICS_ADMIN_SECRET>`. Never put this secret in frontend code or expose the service-role key.

## Important counting note

The Mini App tracker counts distinct Telegram accounts that have opened the Mini App since this feature is enabled. Historical opens cannot be reconstructed retroactively. Bot `/start` totals remain separate until the bot webhook is connected. Telegram account IDs are used as internal pseudonymous identifiers; the summary endpoint never returns them.
