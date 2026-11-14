import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Address, Cell } from "npm:@ton/core@0.63.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? SECRET_KEYS.default ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TONCENTER_API_KEY = Deno.env.get("TONCENTER_API_KEY") ?? "";
const PAYOUT_WORKER_TOKEN = Deno.env.get("ARNOLD_PAYOUT_WORKER_TOKEN") ?? "";
const TREASURY = "UQCSeF2dCiBsO367d32y2OKPRCgbgSkTc5am-MU5K8EAlCWm";
const PRICE_SOURCE = "coingecko:the-open-network";
const QUOTE_MAX_AGE_MS = 60_000;
const ORDER_TTL_MS = 10 * 60_000;
const GRAM_OPTIONS_NANO = new Set(["100000000", "1000000000", "3000000000", "5000000000", "10000000000", "50000000000"]);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
function decimalToScaled(value: string, scale: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("INVALID_MARKET_QUOTE");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.slice(0, scale));
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
}
async function verifyTelegram(initData: string): Promise<string> {
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN_MISSING");
  const params = new URLSearchParams(initData);
  const suppliedHash = params.get("hash");
  if (!suppliedHash) throw new Error("INVALID_TELEGRAM_DATA");
  params.delete("hash");
  const dataCheckString = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value).join("\n");
  const encoder = new TextEncoder();
  const hmac = async (key: Uint8Array, message: string) => {
    const keyBuffer = new Uint8Array(key.byteLength);
  keyBuffer.set(key);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBuffer.buffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)));
  };
  const secret = await hmac(encoder.encode("WebAppData"), BOT_TOKEN);
  const calculated = Array.from(await hmac(secret, dataCheckString), b => b.toString(16).padStart(2, "0")).join("");
  if (calculated.length !== suppliedHash.length) throw new Error("INVALID_TELEGRAM_SIGNATURE");
  let diff = 0;
  for (let i = 0; i < calculated.length; i++) diff |= calculated.charCodeAt(i) ^ suppliedHash.charCodeAt(i);
  if (diff !== 0) throw new Error("INVALID_TELEGRAM_SIGNATURE");
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400 || authDate > Date.now() / 1000 + 30) {
    throw new Error("EXPIRED_TELEGRAM_DATA");
  }
  const user = JSON.parse(params.get("user") ?? "{}");
  if (!user.id) throw new Error("TELEGRAM_USER_MISSING");
  return String(user.id);
}
async function getTonUsd(): Promise<{ price: string; timestamp: string }> {
  const response = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) },
  );
  if (!response.ok) throw new Error("TON_USD_QUOTE_UNAVAILABLE");
  const data = await response.json();
  const price = data?.["the-open-network"]?.usd;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new Error("TON_USD_QUOTE_INVALID");
  }
  return { price: price.toString(), timestamp: new Date().toISOString() };
}

function rawAddress(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try { return Address.parse(value).toRawString(); } catch { return null; }
}
function decodeNativeComment(message: any): string | null {
  const decoded = message?.message_content?.decoded ?? message?.decoded ?? {};
  if (typeof decoded?.comment === "string") return decoded.comment;
  if (typeof message?.message === "string" && message.message.length) return message.message;
  const body = message?.message_content?.body ?? message?.msg_data?.body;
  if (typeof body !== "string" || !body) return null;
  try {
    const slice = Cell.fromBase64(body).beginParse();
    if (slice.remainingBits < 32 || slice.loadUint(32) !== 0) return null;
    return slice.loadStringTail();
  } catch { return null; }
}
async function verifyIncomingNativePayment(order: any): Promise<string | null> {
  const treasuryRaw = rawAddress(TREASURY);
  const buyerRaw = rawAddress(order.buyer_wallet_address);
  if (!treasuryRaw || !buyerRaw) throw new Error("SALE_WALLET_ADDRESS_INVALID");
  const url = new URL("https://toncenter.com/api/v3/transactions");
  url.searchParams.set("account", treasuryRaw);
  url.searchParams.set("limit", "100");
  url.searchParams.set("sort", "desc");
  url.searchParams.set("start_utime", String(Math.max(0, Math.floor(new Date(order.created_at).getTime() / 1000))));
  url.searchParams.set("end_utime", String(Math.floor(Date.now() / 1000)));
  const headers: Record<string, string> = { accept: "application/json" };
  if (TONCENTER_API_KEY) headers["X-API-Key"] = TONCENTER_API_KEY;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("TON_TRANSACTION_LOOKUP_UNAVAILABLE");
  const payload = await response.json();
  const expectedMemo = "ARNOLD:" + order.id;
  const expectedValue = BigInt(order.gram_nano);
  const createdAt = Math.floor(new Date(order.created_at).getTime() / 1000);
  const expiresAt = Math.floor(new Date(order.expires_at).getTime() / 1000);
  for (const tx of (payload?.transactions ?? [])) {
    const msg = tx?.in_msg;
    if (!msg || msg.bounced === true) continue;
    if (rawAddress(msg.destination) !== treasuryRaw || rawAddress(msg.source) !== buyerRaw) continue;
    if (BigInt(String(msg.value ?? "0")) !== expectedValue) continue;
    if (decodeNativeComment(msg) !== expectedMemo) continue;
    // API v3 exposes mc_block_seqno only once the shard transaction is referenced by masterchain.
    if (Number(tx.mc_block_seqno ?? 0) <= 0) continue;
    if (!tx.description || tx.description.aborted !== false) continue;
    if (tx.description.compute_ph?.success === false || tx.description.action?.success === false) continue;
    const txTime = Number(tx.now ?? msg.created_at ?? 0);
    if (!txTime || txTime < createdAt || txTime > expiresAt) continue;
    if (typeof tx.hash !== "string" || tx.hash.length < 20) continue;
    return tx.hash;
  }
  return null;
}

async function triggerArnoldPayout(orderId: string): Promise<{ status: string; error?: string }> {
  if (!PAYOUT_WORKER_TOKEN) return { status: "pending", error: "PAYOUT_WORKER_NOT_CONFIGURED" };
  try {
    const response = await fetch(SUPABASE_URL + "/functions/v1/arnold-payout", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + PAYOUT_WORKER_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ order_id: orderId }),
      signal: AbortSignal.timeout(12000),
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 202) return { status: "processing" };
    if (response.status === 409) return { status: String(result.payout_status ?? "processing") };
    return { status: String(result.payout_status ?? "pending"), error: String(result.error ?? "PAYOUT_WORKER_REQUEST_FAILED") };
  } catch {
    // The payment remains recorded. A later verification request may safely retry
    // the worker claim while the payout is still pending.
    return { status: "pending", error: "PAYOUT_WORKER_TEMPORARILY_UNAVAILABLE" };
  }
}

async function getActiveArnoldPrice() {
  const { data, error } = await admin.from("arnold_sale_phases")
    .select("phase_number,price_usd,token_allocation,tokens_reserved,tokens_sold")
    .order("phase_number").limit(4);
  if (error) throw error;
  const phase = (data ?? []).find((item: any) =>
    Number(item.tokens_sold) < Number(item.token_allocation));
  if (!phase) throw new Error("SALE_SOLD_OUT");
  return { phase: phase.phase_number, price: String(phase.price_usd) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return json(503, { error: "SALE_BACKEND_NOT_CONFIGURED" });
    const body = await req.json();
    const action = String(body.action ?? "");
    if (action === "quote") {
      const [ton, active] = await Promise.all([getTonUsd(), getActiveArnoldPrice()]);
      return json(200, {
        payment_asset: "TON (native Gram)",
        ton_usd: ton.price,
        ton_quote_timestamp: ton.timestamp,
        quote_source: PRICE_SOURCE,
        active_phase: active.phase,
        arnold_usd: active.price,
        supported_amounts_gram: [0.1, 1, 3, 5, 10, 50],
        purchases_enabled: Deno.env.get("ARNOLD_SALE_ENABLED") === "true",
      });
    }

    const telegramId = await verifyTelegram(String(body.initData ?? ""));
    if (action === "create_order") {
      if (Deno.env.get("ARNOLD_SALE_ENABLED") !== "true") {
        return json(503, { error: "ARNOLD_SALE_NOT_OPEN", message: "La venta permanece cerrada mientras se completa la verificación de pagos y la entrega segura." });
      }
      // Release expired reservations before calculating available phase capacity.
      const { error: expiryError } = await admin.rpc("expire_arnold_sale_orders");
      if (expiryError) throw new Error("SALE_ORDER_EXPIRY_CLEANUP_FAILED");
      const gramsText = String(body.grams ?? "");
      if (!/^\d+(\.\d{1,9})?$/.test(gramsText)) return json(400, { error: "INVALID_ORDER_INPUT" });
      const [gramsWhole, gramsFraction = ""] = gramsText.split(".");
      const gramNano = BigInt(gramsWhole) * 1_000_000_000n + BigInt((gramsFraction + "000000000").slice(0, 9));
      const wallet = String(body.walletAddress ?? "").trim();
      if (!GRAM_OPTIONS_NANO.has(gramNano.toString()) || wallet.length < 40 || wallet.length > 80) {
        return json(400, { error: "INVALID_ORDER_INPUT" });
      }
      const [ton, active] = await Promise.all([getTonUsd(), getActiveArnoldPrice()]);
      const now = new Date();
      const quoteTimestamp = new Date(ton.timestamp);
      if (Date.now() - quoteTimestamp.getTime() > QUOTE_MAX_AGE_MS) {
        return json(503, { error: "STALE_MARKET_QUOTE" });
      }
      const tonScaled = decimalToScaled(ton.price, 10);
      const arnoldScaled = decimalToScaled(active.price, 10);
      const arnoldAmountScaled = (gramNano * tonScaled * 10n ** 18n) / (1_000_000_000n * arnoldScaled);
      const arnoldAmount = (arnoldAmountScaled / 10n ** 18n).toString() + "." +
        (arnoldAmountScaled % 10n ** 18n).toString().padStart(18, "0");
      const { data, error } = await admin.rpc("reserve_arnold_sale_order", {
        p_telegram_user_id: telegramId,
        p_buyer_wallet_address: wallet,
        p_gram_nano: gramNano.toString(),
        p_ton_usd: ton.price,
        p_arnold_usd: active.price,
        p_arnold_amount: arnoldAmount,
        p_quote_source: PRICE_SOURCE,
        p_quote_timestamp: quoteTimestamp.toISOString(),
        p_expires_at: new Date(now.getTime() + ORDER_TTL_MS).toISOString(),
      });
      if (error) {
        const known = ["SALE_SOLD_OUT", "SALE_PRICE_CHANGED", "PHASE_CAPACITY_TEMPORARILY_RESERVED"].find(x => error.message?.includes(x));
        return json(409, { error: known ?? "ORDER_RESERVATION_FAILED" });
      }
      return json(201, {
        order_id: data.id,
        phase: data.phase_number,
        gram_nano: data.gram_nano,
        arnold_amount: data.arnold_amount,
        recipient: TREASURY,
        memo: "ARNOLD:" + data.id,
        expires_at: data.expires_at,
        payment_status: "pending",
        next_step: "PAYMENT_VERIFICATION_NOT_ENABLED",
      });
    }

    if (action === "verify_payment") {
      const orderId = String(body.orderId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json(400, { error: "INVALID_ORDER_ID" });
      const { data: order, error: orderError } = await admin.from("arnold_sale_orders")
        .select("id,telegram_user_id,buyer_wallet_address,gram_nano,created_at,expires_at,payment_status,payout_status")
        .eq("id", orderId).eq("telegram_user_id", telegramId).maybeSingle();
      if (orderError) throw orderError;
      if (!order) return json(404, { error: "SALE_ORDER_NOT_FOUND" });
      if (order.payment_status === "paid") {
        const payout: { status: string; error?: string } = order.payout_status === "pending"
          ? await triggerArnoldPayout(order.id)
          : { status: String(order.payout_status) };
        return json(200, {
          payment_status: "paid",
          payout_status: payout.status,
          ...(payout.error ? { payout_error: payout.error } : {}),
          message: payout.status === "fulfilled"
            ? "Pago confirmado y entrega verificada."
            : payout.status === "processing"
              ? "Pago confirmado; entrega enviada y pendiente de verificación en TON."
              : "Pago confirmado; la entrega requiere procesamiento o revisión.",
        });
      }
      if (order.payment_status !== "pending") {
        return json(409, { error: "SALE_ORDER_NOT_PAYABLE" });
      }
      const txHash = await verifyIncomingNativePayment(order);
      if (!txHash) return json(202, {
        payment_status: "pending",
        message: "Aún no encontramos una transferencia finalizada que coincida con esta orden.",
      });
      const { data: confirmed, error: confirmError } = await admin.rpc("confirm_arnold_sale_payment", {
        p_order_id: order.id,
        p_payment_tx_hash: txHash,
      });
      if (confirmError) {
        if (confirmError.message?.includes("duplicate key")) return json(409, { error: "PAYMENT_TRANSACTION_ALREADY_USED" });
        throw confirmError;
      }
      const payout = confirmed.payout_status === "pending"
        ? await triggerArnoldPayout(order.id)
        : { status: String(confirmed.payout_status) };
      return json(200, {
        payment_status: confirmed.payment_status,
        payout_status: payout.status,
        payment_tx_hash: confirmed.payment_tx_hash,
        ...(payout.error ? { payout_error: payout.error } : {}),
        next_step: payout.status === "processing" || payout.status === "fulfilled"
          ? "JETTON_PAYOUT_SUBMITTED"
          : "PAYOUT_REQUIRES_RETRY_OR_REVIEW",
      });
    }
    if (action === "sale_status") {
      const orderId = String(body.orderId ?? "");
      const { data, error } = await admin.from("arnold_sale_orders")
        .select("id,phase_number,arnold_amount,payment_status,payout_status,expires_at,payment_tx_hash,payout_tx_hash")
        .eq("id", orderId).eq("telegram_user_id", telegramId).maybeSingle();
      if (error) throw error;
      if (!data) return json(404, { error: "SALE_ORDER_NOT_FOUND" });
      return json(200, { order: data });
    }
    return json(400, { error: "UNKNOWN_ACTION" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message.startsWith("INVALID_") || message.startsWith("EXPIRED_") ? 401 : 500;
    return json(status, { error: message });
  }
});
