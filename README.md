# ARNOLD SCHWARTZENIGGA MINING

Telegram Mini App for the **$ARNOLD** token community.

## Project overview

A manual mining experience where eligible users start a mining cycle, wait for it to finish, and claim their **$ARNOLD** rewards.

## Initial product rules

- Mining cycle: 24 hours.
- Initial base reward: 5 $ARNOLD per completed daily cycle.
- Mining is manual: users must start a cycle and claim after it completes.
- Wallet holdings can provide reward bonuses based on the user's $ARNOLD balance.
- Holding eligibility is checked when a cycle starts and again when rewards are claimed.
- If a user no longer meets the required holding level at claim time, the corresponding holding bonus is not granted.
- Mining rewards are designed to decrease progressively as the mining reserve is depleted.

## Important implementation notes

- Validate wallet ownership and token balances on the server; do not trust client-side balances.
- Prevent multiple active cycles and duplicate claims.
- Store cycle start/end times and claim state persistently.
- Keep reward calculations deterministic and auditable.

## To be defined

- Supported wallet connection flow and $ARNOLD token contract address.
- Holding tiers and bonus amounts.
- Mining reserve size and the exact reward-reduction formula.
- Backend, database, hosting, and Telegram Mini App configuration.
- UI design, supported languages, and admin controls.

## Status

Project repository initialized. Implementation has not started.
