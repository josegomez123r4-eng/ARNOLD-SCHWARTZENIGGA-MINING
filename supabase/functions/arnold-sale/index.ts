import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TREASURY = "UQDuU4KpCx7KsjwXJa4N9XizHF9k1s7pfyfzCvftFwofEgGk";
const PRICE_SOURCE = "coingecko:the-open-network";
const QUOTE_MAX_AGE_MS = 60_000;
const ORDER_TTL_MS = 10 * 60_000;
const GRAM_OPTIONS = new Set([1, 3, 5, 10, 50]);
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
    const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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
async function getActiveArnoldPrice() {
  const { data, error } = await admin.from("arnold_sale_phases")
    .select("phase_number,price_usd,token_allocation,tokens_reserved,tokens_sold")
    .lt("tokens_sold", 50000).order("phase_number").limit(4);
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
        supported_amounts_gram: [1, 3, 5, 10, 50],
        purchases_enabled: Deno.env.get("ARNOLD_SALE_ENABLED") === "true",
      });
    }

    const telegramId = await verifyTelegram(String(body.initData ?? ""));
    if (action === "create_order") {
      if (Deno.env.get("ARNOLD_SALE_ENABLED") !== "true") {
        return json(503, { error: "ARNOLD_SALE_NOT_OPEN", message: "La venta permanece cerrada mientras se completa la verificación de pagos y la entrega segura." });
      }
      const grams = Number(body.grams);
      const wallet = String(body.walletAddress ?? "").trim();
      if (!GRAM_OPTIONS.has(grams) || wallet.length < 40 || wallet.length > 80) {
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
      const gramNano = BigInt(grams) * 1_000_000_000n;
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
      return json(503, {
        error: "PAYMENT_VERIFICATION_NOT_ENABLED",
        detail: "No se acepta ningún pago hasta integrar y probar la verificación transaccional de TON en el backend.",
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
