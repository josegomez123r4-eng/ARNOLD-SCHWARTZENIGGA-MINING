# ARNOLD SCHWARTZENIGGA MINING

Telegram Mini App frontend for the **$ARNOLD** token community.

## Current prototype

- Responsive mobile-first mining dashboard.
- Telegram Mini App SDK initialization and viewport expansion.
- 24-hour mining-cycle interface with a live countdown.
- Claimed and pending $ARNOLD reward panels.
- Preview-only start, complete, and claim interactions.
- Mine, leaderboard, and profile navigation.

## Product rules represented

- Initial base reward: 5 $ARNOLD per completed 24-hour cycle.
- Mining is manual: users start a cycle and claim after it completes.
- Holding eligibility must be checked at cycle start and again at claim time.
- If a user no longer meets a holding tier at claim time, that tier's bonus is not granted.
- Rewards are intended to decrease progressively as the mining reserve is depleted.

## Important: prototype only

Frontend interactions currently use local demo state. They do not authenticate a Telegram user, connect or verify a wallet, persist mining sessions, or issue real $ARNOLD tokens. Client-side values must never be used as proof of holdings or as the source of truth for rewards.

## Next milestones

1. Configure the production Telegram bot and Mini App URL.
2. Verify Telegram Web App init data on a trusted backend.
3. Connect a supported TON wallet and verify $ARNOLD balances on-chain.
4. Implement secure, persistent mining cycles and duplicate-claim protection.
5. Define holding tiers, reserve size, and reward decay formula.
6. Add admin controls, leaderboard, and production deployment.

## Development

Install dependencies with npm install, start with npm run dev, and build with npm run build.
