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
  `UQCSeF2dCiBsO367d32y2OKPRCgbgSkTc5am-MU5K8EAlCWm`.
- ARNOLD Jetton master supplied and confirmed by the user:
  `EQAx1gPnzQHLRWULxJJL0mSb-iB88JEcZCc0f8BA8Kk_pa9w`.

## Added files

- `supabase/migrations/202611110001_arnold_four_phase_sale.sql`: private order ledger, four phase rows, row-locked reservation RPC, idempotent payment-finalization RPC, and expired-reservation release function.
- `supabase/functions/arnold-sale/index.ts`: Telegram initData validation, public quote endpoint, server-side quote calculation, order reservation, order status lookup, and initial native TON payment verification against TON Center API v3 (sender, recipient, exact nanoTON amount, order memo, transaction execution success, and masterchain inclusion).

## Important safety state

- `ARNOLD_SALE_ENABLED` must remain unset or `false`. The create-order endpoint fails closed unless explicitly enabled.
- `ARNOLD_SALE_ENABLED` must remain false. The purchase path is closed.
- The payout worker and reconciler are not deployed and cannot run until backend secrets are configured.
- The payout worker requires `ARNOLD_TREASURY_MNEMONIC`, `ARNOLD_PAYOUT_WORKER_TOKEN`, `ARNOLD_DECIMALS`, `SUPABASE_SERVICE_ROLE_KEY`, `TONCENTER_API_KEY`; `TONAPI_KEY` is recommended.
- The payout worker now accepts either a 12-word BIP39 multichain phrase or the previous 24-word TON-native phrase. For 12 words it derives TON keys with BIP44/SLIP-0010 Ed25519 at `m/44'/607'/{accountIndex}'`, testing account indexes 0–50, then compares the resulting Wallet V5R1 mainnet address to the configured treasury. For 24 words it retains TON-native mnemonic derivation. Any mismatch fails closed. This derivation has not yet been compiled or tested against the user's OKX wallet; do not configure the secret or enable payouts until the exact account derivation is independently verified. Never send the mnemonic in chat or store it in GitHub/Vercel frontend variables.
- The worker does not automatically retry uncertain broadcasts; those require on-chain reconciliation to prevent duplicate transfers.
- Added `supabase/migrations/202611110002_arnold_payout_worker.sql` for payout claim, seqno, query id and reconciliation fields.
- Added `supabase/migrations/202611110003_arnold_payout_reconciliation.sql` with a restricted, idempotent service-role RPC that marks an order fulfilled only after verified on-chain evidence.
- Added `supabase/functions/arnold-payout-reconcile/index.ts`, a private worker that inspects recipient Jetton-wallet transactions and calls the finalization RPC only after all notification fields match.
- Added `supabase/functions/arnold-payout/index.ts`: authenticated server-only worker; derives a Wallet V5R1 key from a backend-only 12-word BIP39 multichain or 24-word TON-native mnemonic secret; refuses to sign unless the derived address exactly matches the configured treasury; checks the configured master, the treasury Jetton wallet owner/master and token balance; creates a TEP-74 transfer with a unique order query id and a notification payload.
- The worker does not mark a payout fulfilled. It leaves the order in `processing` until `arnold-payout-reconcile` verifies the buyer Jetton wallet's on-chain `transfer_notification#7362d09c`, exact amount, query id, treasury Jetton wallet sender, original treasury owner, order payload, and successful transaction.
- No private key or mnemonic is stored in this repository.
- Payment verification code is committed but has not been compiled, deployed, or exercised against a real testnet payment. It must not be treated as production-ready.
- The migrations have not been applied to any Supabase project yet; the reconciliation migration is new and requires isolated development testing first.
- The Edge Function has not been deployed.
- The sale has not been enabled and no production deployment has been made.

## OKX 12-word mnemonic compatibility change (2026-11-12)

- Updated `arnold-payout` to recognize 12-word BIP39 multichain mnemonics and derive candidate TON keys using SLIP-0010 Ed25519 path `m/44'/607'/{accountIndex}'` for account indexes 0–50. The derived V5R1 mainnet address must match the configured treasury exactly before signing is possible.
- The 24-word TON-native path remains supported for backward compatibility.
- This code change is not yet type-checked or tested against the exact OKX account. OKX account naming alone does not prove which BIP44 account index was used. Do not configure a secret or run the worker until verification is complete.

## Latest public-chain observation (2026-11-11)

- TonAPI reports the new treasury owner address as uninitialized with 0.1 TON native balance. Its associated Jetton account reports 200,000,000,000,000 base units of ARNOLD (200,000 ARNOLD at 9 decimals) for the supplied master address. The user independently confirmed the wallet in Tonviewer; this API check is an additional observation, not a signing test.
- Because the owner account is uninitialized and exposes no deployed wallet code yet, the wallet contract version/signing derivation is not proven. The current payout worker was initially hard-coded to Wallet V4R2; it is now configured for Wallet V5R1 and will fail closed unless a backend-only signer derives the exact treasury address. Do not transfer more funds or configure a mnemonic until the wallet contract derivation is confirmed safely.

## Remaining blockers before any real sale

1. Apply and test the migration in an isolated Supabase development project/branch.
2. Independently query TON for the Jetton master metadata, decimals, supply, treasury Jetton wallet, and treasury balance.
3. Validate the TON Center API v3 payment verifier against real testnet transactions and malformed/adversarial cases. The current implementation checks exact recipient, amount in nanoTON, sender equals the wallet bound to the order, unique memo/order id, successful execution, and masterchain inclusion. Add provider health/rate-limit handling and independent cross-checking before production.
4. Add rate limiting, require/configure a TONCENTER_API_KEY, wallet address canonicalization/validation, and a second independent transaction data source.
5. Test the new payout reconciler against controlled testnet transfers and malformed/adversarial notifications. Add controlled manual retry only after proving no prior transfer occurred.
6. Decide secure signing custody. Prefer a dedicated limited-balance hot wallet or external signer/HSM over placing the full treasury mnemonic in an Edge Function secret. Then add client-side market UI for quotes, order creation, TonConnect payment, and status polling.
7. Test all order, expiry, duplicate payment, over-reservation, phase-transition, and payout cases on testnet or a dedicated low-value test wallet.
8. Review Supabase security advisors and run a Vite/TypeScript production build.
9. Only after explicit approval, configure secrets, deploy the Edge Function, apply production migration, and enable the sale.

Do not paste mnemonic phrases or private keys into chat, source control, or browser environment variables.
