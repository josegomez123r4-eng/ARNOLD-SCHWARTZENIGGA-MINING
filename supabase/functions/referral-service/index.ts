import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? SECRET_KEYS.default ?? "";
const RECIPIENT = "UQDuU4KpCx7KsjwXJa4N9XizHF9k1s7pfyfzCvftFwofEgGk";
const FEE_NANO = "100000000";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

async function hmac(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message)));
}
function hex(bytes: Uint8Array) { return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""); }

async function verifyInitData(initData: string) {
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN_MISSING");
  const params = new URLSearchParams(initData);
  const suppliedHash = params.get("hash");
  if (!suppliedHash) throw new Error("INVALID_TELEGRAM_DATA");
  params.delete("hash");
  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([key, value]) => key + "=" + value).join("\n");
  const secretKey = await hmac(new TextEncoder().encode("WebAppData"), BOT_TOKEN);
  const calculated = hex(await hmac(secretKey, dataCheckString));
  if (calculated.length !== suppliedHash.length || !crypto.subtle.timingSafeEqual) {
    if (calculated !== suppliedHash) throw new Error("INVALID_TELEGRAM_SIGNATURE");
  } else {
    const a = new TextEncoder().encode(calculated);
    const b = new TextEncoder().encode(suppliedHash);
    let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    if (diff !== 0) throw new Error("INVALID_TELEGRAM_SIGNATURE");
  }
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 86400) throw new Error("EXPIRED_TELEGRAM_DATA");
  const userRaw = params.get("user");
  if (!userRaw) throw new Error("TELEGRAM_USER_MISSING");
  const user = JSON.parse(userRaw);
  if (!user?.id) throw new Error("TELEGRAM_USER_MISSING");
  return String(user.id);
}

function normalizeAddress(value: string): string {
  const v = value.trim();
  if (/^-?\d+:[0-9a-fA-F]{64}$/.test(v)) {
    const [wc, hash] = v.split(":"); return wc + ":" + hash.toLowerCase();
  }
  try {
    const b64 = v.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64);
    if (binary.length !== 36) return v.toLowerCase();
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const wc = new DataView(bytes.buffer).getInt8(1);
    const hash = Array.from(bytes.slice(2, 34), b => b.toString(16).padStart(2, "0")).join("");
    return wc + ":" + hash;
  } catch { return v.toLowerCase(); }
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
  try {
    if (!SERVICE_KEY) return json(500, { error: "SUPABASE_SERVICE_ROLE_KEY_MISSING" });
    const body = await req.json();
    const telegramId = await verifyInitData(String(body.initData ?? ""));
    const action = String(body.action ?? "");

    if (action === "sync") {
      const referrer = String(body.referrerTelegramId ?? "");
      if (referrer && /^\d{1,20}$/.test(referrer) && referrer !== telegramId) {
        const { error } = await admin.from("referral_attributions").upsert(
          { referred_telegram_id: telegramId, referrer_telegram_id: referrer },
          { onConflict: "referred_telegram_id", ignoreDuplicates: true }
        );
        if (error) throw error;
      }
      return json(200, { ok: true });
    }

    if (action === "stats") {
      const { data: rows, error } = await admin.from("referral_attributions")
        .select("referred_telegram_id").eq("referrer_telegram_id", telegramId);
      if (error) throw error;
      const ids = (rows ?? []).map((r: { referred_telegram_id: string }) => r.referred_telegram_id);
      if (!ids.length) return json(200, { total: 0, eligible: 0, ineligible: 0 });
      const { data: paid, error: paymentError } = await admin.from("referral_payments")
        .select("telegram_user_id").in("telegram_user_id", ids);
      if (paymentError) throw paymentError;
      const eligible = new Set((paid ?? []).map((r: { telegram_user_id: string }) => r.telegram_user_id)).size;
      return json(200, { total: ids.length, eligible, ineligible: ids.length - eligible });
    }

    if (action === "pay") {
      const sender = String(body.walletAddress ?? "");
      const normalizedSender = normalizeAddress(sender);
      if (!sender || normalizedSender === normalizeAddress(RECIPIENT)) {
        return json(400, { error: "INVALID_SENDER_WALLET" });
      }

      // Confirm the payment from the treasury's indexed inbound transactions.
      // A client-side "sent" response is never treated as proof of payment.
      const txResponse = await fetch(
        "https://tonapi.io/v2/blockchain/accounts/" + encodeURIComponent(RECIPIENT) + "/transactions?limit=100",
        { headers: { accept: "application/json" } }
      );
      if (!txResponse.ok) {
        return json(502, { error: "PAYMENT_INDEXER_UNAVAILABLE", detail: "HTTP " + txResponse.status });
      }
      const txData = await txResponse.json();
      const cutoff = Math.floor(Date.now() / 1000) - 20 * 60;
      const transactions = Array.isArray(txData.transactions) ? txData.transactions : [];
      const match = transactions.find((tx: any) => {
        const message = tx?.in_msg;
        return Number(tx?.utime ?? 0) >= cutoff
          && message
          && normalizeAddress(String(message.source ?? "")) === normalizedSender
          && normalizeAddress(String(message.destination ?? RECIPIENT)) === normalizeAddress(RECIPIENT)
          && String(message.value ?? "") === FEE_NANO
          && typeof message.hash === "string"
          && message.hash.length > 20;
      });
      if (!match) {
        return json(202, { verified: false, status: "pending", message: "Pago todavía no aparece confirmado en la blockchain. Inténtalo de nuevo en unos segundos." });
      }

      const transactionHash = String(match.in_msg.hash);
      const { data: existing, error: existingError } = await admin
        .from("referral_payments").select("transaction_hash")
        .eq("transaction_hash", transactionHash).maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        const { data: prior, error: priorError } = await admin
          .from("referral_payments").select("telegram_user_id")
          .eq("transaction_hash", transactionHash).maybeSingle();
        if (priorError) throw priorError;
        if (String(prior?.telegram_user_id) !== telegramId) {
          return json(409, { error: "PAYMENT_ALREADY_USED" });
        }
        return json(200, { verified: true, status: "verified", transaction_hash: transactionHash });
      }

      const { error: insertError } = await admin.from("referral_payments").insert({
        telegram_user_id: telegramId,
        transaction_hash: transactionHash,
        sender_address: sender,
        recipient_address: RECIPIENT,
        amount_nano: FEE_NANO,
      });
      if (insertError) throw insertError;
      return json(200, { verified: true, status: "verified", transaction_hash: transactionHash });
    }

    return json(400, { error: "UNKNOWN_ACTION" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message.startsWith("INVALID_") || message.startsWith("EXPIRED_") ? 401 : 500;
    return json(status, { error: message });
  }
});