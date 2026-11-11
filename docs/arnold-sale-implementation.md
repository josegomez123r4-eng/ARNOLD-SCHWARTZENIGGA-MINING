# ARNOLD four-phase sale — isolated implementation notes

This work lives on `feature/arnold-four-phase-sale`. It is not merged or deployed.

## Sale configuration

- Phase 1: 50,000 ARNOLD at USD 0.003.
- Phase 2: 50,000 ARNOLD at USD 0.0045.
- Phase 3: 50,000 ARNOLD at USD 0.0065.
- Phase 4: 50,000 ARNOLD at USD 0.008.
- Accepted native TON amounts: 1, 3, 5, 10 and 50 TON (historically called GRAM in the product discussion).
- Quote source currently configured in code: CoinGecko `the-open-network` USD spot quote.
- Treasury recipient currently configured from the user's public address confirmation:
  `UQDuU4KpCx7KsjwXJa4N9XizHF9k1s7pfyfzCvftFwofEgGk`.
- ARNOLD Jetton master supplied and confirmed by the user:
  `EQAx1gPnzQHLRWULxJJL0mSb-iB88JEcZCc0f8BA8Kk_pa9w`.

## Added files

- `supabase/migrations/202611110001_arnold_four_phase_sale.sql`: private order ledger, four phase rows, row-locked reservation RPC, idempotent payment-finalization RPC, and expired-reservation release function.
- `supabase/functions/arnold-sale/index.ts`: Telegram initData validation, public quote endpoint, server-side quote calculation, order reservation, order status lookup, and initial native TON payment verification against TON Center API v3 (sender, recipient, exact nanoTON amount, order memo, transaction execution success, and masterchain inclusion).

## Important safety state

- `ARNOLD_SALE_ENABLED` must remain unset or `false`. The create-order endpoint fails closed unless explicitly enabled.
- `ARNOLD_SALE_ENABLED` must remain false. The purchase path is closed.
- The payout worker is not deployed and cannot run until backend secrets are configured.
- The payout worker requires `ARNOLD_TREASURY_MNEMONIC`, `ARNOLD_PAYOUT_WORKER_TOKEN`, `ARNOLD_DECIMALS`, `SUPABASE_SERVICE_ROLE_KEY`, `TONCENTER_API_KEY`; `TONAPI_KEY` is recommended.
- The mnemonic secret must derive the exact treasury address using Wallet V4R2. If the wallet is a different contract version or derivation, the worker fails closed. Never send the mnemonic in chat or store it in GitHub/Vercel frontend variables.
- The worker does not automatically retry uncertain broadcasts; those require on-chain reconciliation to prevent duplicate transfers.
- Added `supabase/migrations/202611110002_arnold_payout_worker.sql` for payout claim, seqno, query id and reconciliation fields.
- Added `supabase/functions/arnold-payout/index.ts`: authenticated server-only worker; derives a standard Wallet V4R2 key from a backend-only 24-word mnemonic secret; refuses to sign unless the derived address exactly matches the configured treasury; checks the configured master, the treasury Jetton wallet owner/master and token balance; creates a TEP-74 transfer with a unique order query id and a notification payload.
- The worker does not mark a payout fulfilled. It leaves the order in `processing` until a separate on-chain notification reconciler verifies the recipient's Jetton notification.
- No private key or mnemonic is stored in this repository.
- Payment verification code is committed but has not been compiled, deployed, or exercised against a real testnet payment. It must not be treated as production-ready.
- The migration has not been applied to the production Supabase project.
- The Edge Function has not been deployed.
- The sale has not been enabled and no production deployment has been made.

## Remaining blockers before any real sale

1. Apply and test the migration in an isolated Supabase development project/branch.
2. Independently query TON for the Jetton master metadata, decimals, supply, treasury Jetton wallet, and treasury balance.
3. Validate the TON Center API v3 payment verifier against real testnet transactions and malformed/adversarial cases. The current implementation checks exact recipient, amount in nanoTON, sender equals the wallet bound to the order, unique memo/order id, successful execution, and masterchain inclusion. Add provider health/rate-limit handling and independent cross-checking before production.
4. Add rate limiting, require/configure a TONCENTER_API_KEY, wallet address canonicalization/validation, and a second independent transaction data source.
5. Implement and test a separate payout reconciler that verifies the recipient Jetton wallet's `transfer_notification#7362d09c`, exact amount, sender treasury Jetton wallet, and query id before marking `fulfilled`. Add controlled manual retry only after proving no prior transfer occurred.
6. Decide secure signing custody. Prefer a dedicated limited-balance hot wallet or external signer/HSM over placing the full treasury mnemonic in an Edge Function secret. Then add client-side market UI for quotes, order creation, TonConnect payment, and status polling.
7. Test all order, expiry, duplicate payment, over-reservation, phase-transition, and payout cases on testnet or a dedicated low-value test wallet.
8. Review Supabase security advisors and run a Vite/TypeScript production build.
9. Only after explicit approval, configure secrets, deploy the Edge Function, apply production migration, and enable the sale.

Do not paste mnemonic phrases or private keys into chat, source control, or browser environment variables.
