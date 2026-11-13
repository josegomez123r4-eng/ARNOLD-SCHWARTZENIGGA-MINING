import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Address, Cell } from "npm:@ton/core@0.63.0";
import { TonClient, JettonMaster } from "npm:@ton/ton@15.1.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WORKER_TOKEN = Deno.env.get("ARNOLD_PAYOUT_WORKER_TOKEN") ?? "";
const TONCENTER_KEY = Deno.env.get("TONCENTER_API_KEY") ?? "";
const TONAPI_KEY = Deno.env.get("TONAPI_KEY") ?? "";
const TREASURY = "UQCSeF2dCiBsO367d32y2OKPRCgbgSkTc5am-MU5K8EAlCWm";
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
function parseForwardComment(slice: any): string | null {
  try {
    const isRef = slice.loadBit();
    const payload = isRef ? slice.loadRef() : slice.asCell();
    const comment = payload.beginParse();
    if (comment.remainingBits < 32 || comment.loadUint(32) !== 0) return null;
    return comment.loadStringTail();
  } catch {
    return null;
  }
}
function parseNotification(body: Cell) {
  try {
    const s = body.beginParse();
    if (s.remainingBits < 32 || s.loadUint(32) !== 0x7362d09c) return null;
    const queryId = s.loadUintBig(64);
    const amount = s.loadCoins();
    const sender = s.loadAddress();
    const comment = parseForwardComment(s);
    return { queryId, amount, sender, comment };
  } catch {
    return null;
  }
}
function isSuccessfulTransaction(tx: any): boolean {
  const d = tx?.description;
  if (!d || d.type !== "generic" || d.aborted !== false) return false;
  if (!d.computePhase?.success || !d.actionPhase?.success) return false;
  return true;
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
  const headers: Record<string, string> = { accept: "application/json" };
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
async function verifyJettonWallet(owner: Address, expected: Address) {
  const master = ton.open(JettonMaster.create(Address.parse(MASTER)));
  const derived = await master.getWalletAddress(owner);
  if (!sameAddress(derived, expected)) throw new Error("JETTON_WALLET_DERIVATION_MISMATCH");
  const result = await ton.runMethod(derived, "get_wallet_data");
  const actualOwner = result.stack.readAddress();
  const actualMaster = result.stack.readAddress();
  if (!sameAddress(actualOwner, owner) || !sameAddress(actualMaster, Address.parse(MASTER))) {
    throw new Error("JETTON_WALLET_OWNER_OR_MASTER_MISMATCH");
  }
  return derived;
}
async function findVerifiedNotification(order: any, decimals: number): Promise<string | null> {
  if (!order.payout_query_id || !order.payout_attempted_at) return null;
  const buyer = Address.parse(order.buyer_wallet_address);
  const treasury = Address.parse(TREASURY);
  const master = ton.open(JettonMaster.create(Address.parse(MASTER)));
  const treasuryJettonWallet = await master.getWalletAddress(treasury);
  const buyerJettonWallet = await master.getWalletAddress(buyer);
  await verifyJettonWallet(treasury, treasuryJettonWallet);
  await verifyJettonWallet(buyer, buyerJettonWallet);

  const expectedAmount = toJettonUnits(String(order.arnold_amount), decimals);
  const expectedQueryId = BigInt(order.payout_query_id);
  const attemptedAt = Math.floor(new Date(order.payout_attempted_at).getTime() / 1000);
  const transactions = await ton.getTransactions(buyerJettonWallet, { limit: 50 });
  for (const tx of transactions as any[]) {
    if (Number(tx.now ?? 0) < attemptedAt) continue;
    if (!isSuccessfulTransaction(tx)) continue;
    const incoming = tx.inMessage;
    if (!incoming || incoming.info?.type !== "internal") continue;
    if (incoming.info.bounced || !sameAddress(incoming.info.src, treasuryJettonWallet)) continue;
    if (!sameAddress(incoming.info.dest, buyerJettonWallet)) continue;
    // A valid Jetton transfer notification may be accompanied by an excesses
    // message, so outgoing messages must not invalidate the incoming notification.

    const parsed = parseNotification(incoming.body);
    if (!parsed) continue;
    if (parsed.queryId !== expectedQueryId || parsed.amount !== expectedAmount) continue;
    if (!parsed.sender || !sameAddress(parsed.sender, treasury)) continue;
    if (parsed.comment !== "ARNOLD-PAYOUT:" + order.id) continue;
    return tx.hash().toString("hex");
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
  const bearer = req.headers.get("authorization") ?? "";
  if (!WORKER_TOKEN || bearer !== "Bearer " + WORKER_TOKEN) return json(401, { error: "UNAUTHORIZED_WORKER" });
  if (!SUPABASE_URL || !SERVICE_KEY) return json(503, { error: "RECONCILER_BACKEND_NOT_CONFIGURED" });

  try {
    const body = await req.json().catch(() => ({}));
    const orderId = body.order_id ? String(body.order_id) : "";
    if (orderId && !/^[0-9a-f-]{36}$/i.test(orderId)) return json(400, { error: "INVALID_ORDER_ID" });
    const decimals = await getDecimals();
    let query = admin.from("arnold_sale_orders")
      .select("id,buyer_wallet_address,arnold_amount,payment_status,payout_status,payout_query_id,payout_attempted_at")
      .eq("payment_status", "paid").eq("payout_status", "processing")
      .not("payout_query_id", "is", null).not("payout_attempted_at", "is", null)
      .order("payout_attempted_at", { ascending: true }).limit(orderId ? 1 : 20);
    if (orderId) query = query.eq("id", orderId);
    const { data: orders, error } = await query;
    if (error) throw error;

    const results = [];
    for (const order of orders ?? []) {
      try {
        const txHash = await findVerifiedNotification(order, decimals);
        if (!txHash) {
          results.push({ order_id: order.id, payout_status: "processing", verified: false });
          continue;
        }
        const { data: finalized, error: finalizeError } = await admin.rpc("confirm_arnold_sale_payout", {
          p_order_id: order.id,
          p_payout_tx_hash: txHash,
          p_payout_query_id: order.payout_query_id,
        });
        if (finalizeError) throw finalizeError;
        results.push({
          order_id: order.id,
          payout_status: finalized.payout_status,
          payout_tx_hash: finalized.payout_tx_hash,
          verified: true,
        });
      } catch (error) {
        results.push({
          order_id: order.id,
          payout_status: "processing",
          error: error instanceof Error ? error.message : "RECONCILIATION_ERROR",
        });
      }
    }
    return json(200, { checked: results.length, results });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : "UNKNOWN_RECONCILIATION_ERROR" });
  }
});
