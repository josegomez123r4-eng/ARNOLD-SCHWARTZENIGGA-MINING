import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? SECRET_KEYS.default ?? "";
const CHANNEL = "@arnoldschwartzenigganews";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
async function hmac(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message)));
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
async function verifyInitData(initData: string): Promise<string> {
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN_MISSING");
  const params = new URLSearchParams(initData);
  const suppliedHash = params.get("hash");
  if (!suppliedHash) throw new Error("INVALID_TELEGRAM_DATA");
  params.delete("hash");
  const checkString = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), BOT_TOKEN);
  const calculated = hex(await hmac(secret, checkString));
  if (calculated.length !== suppliedHash.length) throw new Error("INVALID_TELEGRAM_SIGNATURE");
  let difference = 0;
  for (let i = 0; i < calculated.length; i++) difference |= calculated.charCodeAt(i) ^ suppliedHash.charCodeAt(i);
  if (difference !== 0) throw new Error("INVALID_TELEGRAM_SIGNATURE");
  const authDate = Number(params.get("auth_date") ?? 0);
  const nowSeconds = Date.now() / 1000;
  if (!authDate || nowSeconds - authDate > 86400 || authDate > nowSeconds + 60) throw new Error("EXPIRED_TELEGRAM_DATA");
  const rawUser = params.get("user");
  if (!rawUser) throw new Error("TELEGRAM_USER_MISSING");
  const user = JSON.parse(rawUser);
  if (!user?.id || !/^\d{1,20}$/.test(String(user.id))) throw new Error("TELEGRAM_USER_MISSING");
  return String(user.id);
}
async function isChannelMember(telegramUserId: string): Promise<boolean> {
  const response = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/getChatMember", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHANNEL, user_id: Number(telegramUserId) }),
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok !== true) throw new Error("TELEGRAM_MEMBERSHIP_CHECK_FAILED");
  const member = result.result;
  return ["creator", "administrator", "member"].includes(String(member?.status))
    || (member?.status === "restricted" && member?.is_member === true);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return json(503, { error: "BACKEND_NOT_CONFIGURED" });
    if (!BOT_TOKEN) return json(503, { error: "TELEGRAM_BOT_TOKEN_MISSING" });

    const body = await req.json();
    const telegramUserId = await verifyInitData(String(body.initData ?? ""));
    const action = String(body.action ?? "");
    if (!["status", "claim_channel", "claim_checkin"].includes(action)) return json(400, { error: "UNKNOWN_ACTION" });

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();

    const [membership, channelResult, checkinResult] = await Promise.all([
      isChannelMember(telegramUserId),
      db.from("task_reward_claims").select("claimed_at").eq("telegram_user_id", telegramUserId)
        .eq("task_key", "channel_join").order("claimed_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("task_checkin_state").select("current_streak,last_claim_date")
        .eq("telegram_user_id", telegramUserId).maybeSingle(),
    ]);
    if (channelResult.error) throw channelResult.error;
    if (checkinResult.error) throw checkinResult.error;

    const lastChannelClaim = channelResult.data?.claimed_at ? new Date(channelResult.data.claimed_at) : null;
    const nextChannel = lastChannelClaim ? new Date(lastChannelClaim.getTime() + 48 * 60 * 60 * 1000) : null;
    const channelAvailableAt = nextChannel && nextChannel.getTime() > now.getTime() ? nextChannel.toISOString() : null;
    const lastCheckinDate = checkinResult.data?.last_claim_date ?? null;
    const currentStreak = lastCheckinDate === today || lastCheckinDate === yesterday
      ? Number(checkinResult.data?.current_streak ?? 0) : 0;

    if (action === "status") {
      return json(200, {
        channel_member: membership,
        channel_next_available_at: channelAvailableAt,
        checkin_streak: currentStreak,
        checkin_claimed_today: lastCheckinDate === today,
        checkin_next_available_at: tomorrow,
        channel_url: "https://t.me/arnoldschwartzenigganews",
      });
    }

    const taskKey = action === "claim_channel" ? "channel_join" : "daily_checkin";
    if (taskKey === "channel_join" && !membership) return json(403, { error: "CHANNEL_MEMBERSHIP_REQUIRED" });

    const { data, error } = await db.rpc("claim_arnold_task_reward", {
      p_telegram_user_id: telegramUserId,
      p_task_key: taskKey,
      p_channel_verified: membership,
    });
    if (error) throw error;
    if (!data?.claimed) {
      const status = data?.error === "CHANNEL_MEMBERSHIP_REQUIRED" ? 403
        : ["CHANNEL_COOLDOWN", "CHECKIN_ALREADY_CLAIMED"].includes(data?.error) ? 409 : 400;
      return json(status, data);
    }
    return json(200, data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message.startsWith("INVALID_") || message.startsWith("EXPIRED_") ? 401
      : message === "TELEGRAM_MEMBERSHIP_CHECK_FAILED" ? 503 : 500;
    return json(status, { error: message });
  }
});
