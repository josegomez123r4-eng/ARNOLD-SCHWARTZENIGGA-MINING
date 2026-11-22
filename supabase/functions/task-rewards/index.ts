import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? KEYS.default ?? "";
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
function hex(bytes: Uint8Array) { return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""); }
async function verifyInitData(initData: string): Promise<{ id: number; raw: Record<string, unknown> }> {
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN_MISSING");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("INVALID_TELEGRAM_DATA");
  params.delete("hash");
  const check = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + "=" + v).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), BOT_TOKEN);
  const actual = hex(await hmac(secret, check));
  if (actual.length !== hash.length) throw new Error("INVALID_TELEGRAM_SIGNATURE");
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ hash.charCodeAt(i);
  if (diff) throw new Error("INVALID_TELEGRAM_SIGNATURE");
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 86400) throw new Error("EXPIRED_TELEGRAM_DATA");
  const raw = JSON.parse(params.get("user") ?? "{}");
  if (!raw?.id || !/^\d+$/.test(String(raw.id))) throw new Error("TELEGRAM_USER_MISSING");
  return { id: Number(raw.id), raw };
}
async function ensureProfile(id: number, user: Record<string, unknown>) {
  const username = String(user.username ?? "").trim().replace(/^@/, "");
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  const { error } = await db.schema("arnold").from("user_profiles").upsert({
    user_id: crypto.randomUUID(), telegram_user_id: id,
    ...(username ? { telegram_username: username } : {}),
    ...(displayName ? { display_name: displayName } : {}),
    updated_at: new Date().toISOString(),
  }, { onConflict: "telegram_user_id", ignoreDuplicates: true });
  if (error) throw error;
}
async function channelMembership(id: number): Promise<boolean> {
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN_MISSING");
  const response = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/getChatMember", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHANNEL, user_id: id }),
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) throw new Error("TELEGRAM_MEMBERSHIP_CHECK_FAILED");
  const status = data.result?.status;
  return status === "creator" || status === "administrator" || status === "member" ||
    (status === "restricted" && data.result?.is_member === true);
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
  try {
    if (!SERVICE_KEY || !SUPABASE_URL) return json(503, { error: "BACKEND_NOT_CONFIGURED" });
    const body = await req.json();
    const { id, raw } = await verifyInitData(String(body.initData ?? ""));
    await ensureProfile(id, raw);
    const action = String(body.action ?? "");
    if (action === "status") {
      const [{ data: status, error }, member] = await Promise.all([
        db.schema("arnold").rpc("get_task_rewards_status", { p_telegram_user_id: id }),
        channelMembership(id),
      ]);
      if (error) throw error;
      return json(200, { ...status, channel_member: member, channel_url: "https://t.me/arnoldschwartzenigganews" });
    }
    if (action === "claim_channel") {
      if (!await channelMembership(id)) return json(403, { error: "CHANNEL_MEMBERSHIP_REQUIRED" });
      const { data, error } = await db.schema("arnold").rpc("claim_channel_task", { p_telegram_user_id: id });
      if (error) throw error;
      return json(200, data);
    }
    if (action === "claim_checkin") {
      const { data, error } = await db.schema("arnold").rpc("claim_daily_checkin", { p_telegram_user_id: id });
      if (error) throw error;
      return json(200, data);
    }
    return json(400, { error: "UNKNOWN_ACTION" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message.startsWith("INVALID_") || message.startsWith("EXPIRED_") ? 401 : 500;
    return json(status, { error: message });
  }
});
