import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Address } from "npm:@ton/core@0.63.0";
import { WalletContractV5R1 } from "npm:@ton/ton@15.1.0";
import { deriveEd25519Path, keyPairFromSeed } from "npm:@ton/crypto@3.3.0";
import { mnemonicToSeedSync, validateMnemonic } from "npm:@scure/bip39@1.5.4";
import { wordlist as bip39English } from "npm:@scure/bip39@1.5.4/wordlists/english.js";
import { Buffer } from "node:buffer";

const EXPECTED_TREASURY = "UQCSeF2dCiBsO367d32y2OKPRCgbgSkTc5am-MU5K8EAlCWm";
const MNEMONIC = Deno.env.get("ARNOLD_TREASURY_MNEMONIC") ?? "";
const CHECK_TOKEN = Deno.env.get("ARNOLD_TREASURY_CHECK_TOKEN") ?? "";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function sameAddress(a: Address, b: Address) {
  return a.workChain === b.workChain && a.hash.equals(b.hash);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
  const authorization = req.headers.get("authorization") ?? "";
  if (!CHECK_TOKEN || authorization !== "Bearer " + CHECK_TOKEN) {
    return json(401, { error: "UNAUTHORIZED" });
  }
  if (!MNEMONIC) return json(503, { error: "TREASURY_MNEMONIC_SECRET_NOT_CONFIGURED" });

  try {
    const words = MNEMONIC.trim().toLowerCase().split(/\\s+/);
    if (words.length !== 12) {
      return json(400, { error: "EXPECTED_12_WORD_BIP39_PHRASE" });
    }
    const phrase = words.join(" ");
    if (!validateMnemonic(phrase, bip39English)) {
      return json(400, { error: "BIP39_CHECKSUM_INVALID" });
    }

    // TEP-3 multichain derivation: BIP39 seed + SLIP-0010 Ed25519
    // m/44'/607'/{accountIndex}'. This endpoint derives addresses only;
    // it never signs, sends messages, or accesses sale orders.
    const seed = Buffer.from(mnemonicToSeedSync(phrase, ""));
    const expected = Address.parse(EXPECTED_TREASURY);
    for (let accountIndex = 0; accountIndex <= 50; accountIndex++) {
      const childSeed = await deriveEd25519Path(seed, [44, 607, accountIndex]);
      const keyPair = keyPairFromSeed(Buffer.from(childSeed));
      const wallet = WalletContractV5R1.create({
        workchain: 0,
        publicKey: keyPair.publicKey,
        walletId: { networkGlobalId: -239 },
      });
      if (sameAddress(wallet.address, expected)) {
        return json(200, {
          match: true,
          account_index: accountIndex,
          derivation_path: `m/44'/607'/${accountIndex}'`,
          wallet_version: "V5R1",
          wallet_id: 2147483409,
          derived_address: wallet.address.toString({ urlSafe: true, bounceable: true }),
          expected_address: EXPECTED_TREASURY,
          signing_performed: false,
          transaction_sent: false,
        });
      }
    }
    return json(200, {
      match: false,
      checked_account_indexes: "0-50",
      wallet_version: "V5R1",
      wallet_id: 2147483409,
      expected_address: EXPECTED_TREASURY,
      signing_performed: false,
      transaction_sent: false,
      next_step: "Verify the OKX account derivation path and selected account; do not change or move funds.",
    });
  } catch {
    // Never return or log mnemonic material or derived private keys.
    return json(500, { error: "TREASURY_DERIVATION_CHECK_FAILED" });
  }
});
