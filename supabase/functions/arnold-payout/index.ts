import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Address, beginCell, internal, SendMode, toNano } from "npm:@ton/core@0.63.0";
import { TonClient, WalletContractV4, JettonMaster } from "npm:@ton/ton@15.1.0";
import { mnemonicToPrivateKey } from "npm:@ton/crypto@3.3.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WORKER_TOKEN = Deno.env.get("ARNOLD_PAYOUT_WORKER_TOKEN") ?? "";
const MNEMONIC = Deno.env.get("ARNOLD_TREASURY_MNEMONIC") ?? "";
const TONCENTER_KEY = Deno.env.get("TONCENTER_API_KEY") ?? "";
const TONAPI_KEY = Deno.env.get("TONAPI_KEY") ?? "";
const TREASURY = "UQDuU4KpCx7KsjwXJa4N9XizHF9k1s7pfyfzCvftFwofEgGk";
const MASTER = "EQAx1gPnzQHLRWULxJJL0mSb-iB88JEcZCc0f8BA8Kk_pa9w";
const cors = {
  "Access-Control-Allow-Origin": "https://arnold-schwartzenigga-mining.vercel.app",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const ton = new TonClient({
  endpoint: "https://toncenter.com/api/v2/jsonRPC",
  apiKey: TONCENTER_KEY || undefined,
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
function sameAddress(a: Address, b: Address) {
  return a.workChain === b.workChain && a.hash.equals(b.hash);
}
function toJettonUnits(decimal: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(decimal)) throw new Error("INVALID_ARNOLD_AMOUNT");
  const [whole, fraction = ""] = decimal.split(".");
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) {
    throw new Error("ARNOLD_AMOUNT_EXCEEDS_TOKEN_PRECISION");
  }
  return BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction.slice(0, decimals) + "0".repeat(decimals)).slice(0, decimals) || "0");
}
async function getDecimals(): Promise<number> {
  const expected = Deno.env.get("ARNOLD_DECIMALS");
  if (!expected || !/^\d{1,2}$/.test(expected)) throw new Error("ARNOLD_DECIMALS_SECRET_REQUIRED");
  const headers: Record<string,string> = { accept: "application/json" };
  if (TONAPI_KEY) headers.Authorization = "Bearer " + TONAPI_KEY;
  const response = await fetch("https://tonapi.io/v2/jettons/" + MASTER, {
    headers, signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error("ARNOLD_MASTER_METADATA_UNAVAILABLE");
  const info = await response.json();
  if (String(info?.metadata?.decimals) !== expected) throw new Error("ARNOLD_DECIMALS_MISMATCH");
  const decimals = Number(expected);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error("ARNOLD_DECIMALS_INVALID");
  return decimals;
}
async function verifyMasterAndTreasury(owner: Address) {
  const master = ton.open(JettonMaster.create(Address.parse(MASTER)));
  const masterData = await master.getJettonData();
  if (!masterData.totalSupply || masterData.totalSupply <= 0n) throw new Error("ARNOLD_MASTER_INVALID");
  const jettonWalletAddress = await master.getWalletAddress(owner);
  const walletData = await ton.runMethod(jettonWalletAddress, "get_wallet_data");
  const balance = walletData.stack.readBigNumber();
  const walletOwner = walletData.stack.readAddress();
  const walletMaster = walletData.stack.readAddress();
  if (!sameAddress(walletOwner, owner) || !sameAddress(walletMaster, Address.parse(MASTER))) {
    throw new Error("TREASURY_JETTON_WALLET_MISMATCH");
  }
  return { master, jettonWalletAddress, balance };
}
async function deriveTreasuryWallet() {
  if (!MNEMONIC) throw new Error("ARNOLD_TREASURY_SIGNER_NOT_CONFIGURED");
  const words = MNEMONIC.trim().split(/\s+/);
  if (words.length !== 24) throw new Error("ARNOLD_TREASURY_SIGNER_MUST_BE_24_WORDS");
  const keyPair = await mnemonicToPrivateKey(words);
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
  if (!sameAddress(wallet.address, Address.parse(TREASURY))) {
    throw new Error("SIGNER_DERIVED_ADDRESS_DOES_NOT_MATCH_TREASURY");
  }
  return { keyPair, wallet };
}
function queryIdFromUuid(id: string): bigint {
  const hex = id.replaceAll("-", "");
  return BigInt("0x" + hex.slice(0, 16));
}
function payoutBody(order: any, amount: bigint, queryId: bigint, owner: Address) {
  const payload = beginCell().storeUint(0, 32).storeStringTail("ARNOLD-PAYOUT:" + order.id).endCell();
  return beginCell()
    .storeUint(0x0f8a7ea5, 32)
    .storeUint(queryId, 64)
    .storeCoins(amount)
    .storeAddress(owner)
    .storeAddress(Address.parse(TREASURY))
    .storeBit(0)
    .storeCoins(1n)
    .storeBit(1)
    .storeRef(payload)
    .endCell();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
  const bearer = req.headers.get("authorization") ?? "";
  if (!WORKER_TOKEN || bearer !== "Bearer " + WORKER_TOKEN) return json(401, { error: "UNAUTHORIZED_WORKER" });
  if (!SUPABASE_URL || !SERVICE_KEY) return json(503, { error: "PAYOUT_BACKEND_NOT_CONFIGURED" });

  let claimedOrderId = "";
  let broadcastAttempted = false;
  try {
    const body = await req.json();
    const orderId = String(body.order_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json(400, { error: "INVALID_ORDER_ID" });

    // Atomic compare-and-set: only one worker can claim a paid, unfulfilled order.
    const { data: order, error: claimError } = await admin.from("arnold_sale_orders")
      .update({ payout_status: "processing", payout_attempted_at: new Date().toISOString(), payout_error: null })
      .eq("id", orderId).eq("payment_status", "paid").eq("payout_status", "pending")
      .select("id,buyer_wallet_address,arnold_amount,payout_status")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!order) {
      const { data: existing, error } = await admin.from("arnold_sale_orders")
        .select("id,payment_status,payout_status,payout_tx_hash")
        .eq("id", orderId).maybeSingle();
      if (error) throw error;
      if (!existing) return json(404, { error: "SALE_ORDER_NOT_FOUND" });
      return json(409, { error: "PAYOUT_NOT_CLAIMABLE", payout_status: existing.payout_status });
    }
    claimedOrderId = order.id;

    const { keyPair, wallet } = await deriveTreasuryWallet();
    const owner = Address.parse(order.buyer_wallet_address);
    const decimals = await getDecimals();
    const amount = toJettonUnits(String(order.arnold_amount), decimals);
    if (amount <= 0n) throw new Error("PAYOUT_AMOUNT_INVALID");

    const { jettonWalletAddress, balance } = await verifyMasterAndTreasury(wallet.address);
    if (balance < amount) throw new Error("TREASURY_ARNOLD_BALANCE_INSUFFICIENT");

    const openedWallet = ton.open(wallet);
    const seqno = await openedWallet.getSeqno();
    const queryId = queryIdFromUuid(order.id);
    const bodyCell = payoutBody(order, amount, queryId, owner);
    const transfer = internal({
      to: jettonWalletAddress,
      value: toNano("0.15"),
      bounce: true,
      body: bodyCell,
    });
    const { error: intentError } = await admin.from("arnold_sale_orders").update({
      payout_query_id: queryId.toString(),
      payout_wallet_seqno: seqno,
      payout_attempted_at: new Date().toISOString(),
    }).eq("id", order.id).eq("payout_status", "processing");
    if (intentError) throw intentError;

    broadcastAttempted = true;
    await openedWallet.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      messages: [transfer],
      sendMode: SendMode.PAY_GAS_SEPARATELY,
    });

    return json(202, {
      order_id: order.id,
      payout_status: "processing",
      wallet_seqno: seqno,
      query_id: queryId.toString(),
      message: "Transferencia enviada a TON. La orden queda en procesamiento hasta verificar la notificación Jetton del destinatario.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_PAYOUT_ERROR";
    // A failed broadcast request can be ambiguous; never reopen automatic retries after it.
    if (claimedOrderId && !broadcastAttempted) {
      await admin.from("arnold_sale_orders").update({
        payout_status: "failed", payout_error: message,
      }).eq("id", claimedOrderId).eq("payout_status", "processing");
    } else if (claimedOrderId) {
      await admin.from("arnold_sale_orders").update({
        payout_error: "BROADCAST_RESULT_UNCERTAIN: " + message,
      }).eq("id", claimedOrderId).eq("payout_status", "processing");
    }
    return json(500, { error: message, payout_requires_reconciliation: broadcastAttempted });
  }
});
