import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function validateTelegramInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("Missing Telegram hash");
  params.delete("hash");
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > 86400) {
    throw new Error("Expired Telegram initData");
  }
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value)
    .join("\n");
  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    "raw", encoder.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const secret = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(botToken));
  const signingKey = await crypto.subtle.importKey(
    "raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", signingKey, encoder.encode(dataCheckString)));
  const calculated = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (calculated !== hash) throw new Error("Invalid Telegram initData signature");
  const userRaw = params.get("user");
  if (!userRaw) throw new Error("Missing Telegram user");
  const user = JSON.parse(userRaw);
  const id = Number(user.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid Telegram user id");
  return id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: cors });
  try {
    const body = await req.json();
    const adminSecret = Deno.env.get("ARNOLD_ANALYTICS_ADMIN_SECRET");
    if (body?.action === "stats") {
      if (!adminSecret || req.headers.get("x-arnold-analytics-admin") !== adminSecret) {
        return Response.json({ error: "Unauthorized" }, { status: 401, headers: cors });
      }
      const url = Deno.env.get("SUPABASE_URL");
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !key) throw new Error("Analytics service is not configured");
      const db = createClient(url, key, { auth: { persistSession: false } });
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const [eventsResult, profilesResult, walletsResult] = await Promise.all([
        db.from("arnold_analytics_events").select("telegram_user_id,event_type,event_day,event_count").gte("event_day", since.slice(0, 10)).limit(10000),
        db.schema("arnold").from("user_profiles").select("telegram_user_id", { count: "exact", head: true }),
        db.from("telegram_wallet_links").select("telegram_user_id", { count: "exact", head: true }).not("verified_at", "is", null),
      ]);
      if (eventsResult.error) throw eventsResult.error;
      if (profilesResult.error) throw profilesResult.error;
      if (walletsResult.error) throw walletsResult.error;
      const events = eventsResult.data || [];
      const unique = (type: string) => new Set(events.filter((e: any) => e.event_type === type).map((e: any) => String(e.telegram_user_id))).size;
      const dayMap = new Map<string, { bot_starts: number; mini_app_opens: number; unique_users: Set<string> }>();
      for (const event of events as any[]) {
        const day = String(event.event_day);
        if (!dayMap.has(day)) dayMap.set(day, { bot_starts: 0, mini_app_opens: 0, unique_users: new Set() });
        const bucket = dayMap.get(day)!;
        if (event.event_type === "bot_start") bucket.bot_starts += Number(event.event_count || 1);
        if (event.event_type === "mini_app_open") bucket.mini_app_opens += Number(event.event_count || 1);
        bucket.unique_users.add(String(event.telegram_user_id));
      }
      const userDays = new Map<string, Set<string>>();
      for (const event of events as any[]) {
        const id = String(event.telegram_user_id);
        if (!userDays.has(id)) userDays.set(id, new Set());
        userDays.get(id)!.add(String(event.event_day));
      }
      return Response.json({
        period_days: 30,
        bot_start_users: unique("bot_start"),
        mini_app_users: unique("mini_app_open"),
        unique_users_seen: new Set(events.map((e: any) => String(e.telegram_user_id))).size,
        returning_users: [...userDays.values()].filter(days => days.size > 1).length,
        registrations_total: profilesResult.count ?? 0,
        verified_wallets_total: walletsResult.count ?? 0,
        daily: [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({
          date, bot_starts: value.bot_starts, mini_app_opens: value.mini_app_opens, unique_users: value.unique_users.size
        }))
      }, { headers: cors });
    }
    const eventType = body?.eventType;
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!supabaseUrl || !serviceKey || !botToken) throw new Error("Analytics service is not configured");

    let telegramUserId: number;
    if (eventType === "mini_app_open") {
      telegramUserId = await validateTelegramInitData(String(body.initData || ""), botToken);
    } else if (eventType === "bot_start") {
      const expected = Deno.env.get("ARNOLD_ANALYTICS_WEBHOOK_SECRET");
      const supplied = req.headers.get("x-arnold-analytics-secret");
      if (!expected || !supplied || supplied !== expected) {
        return Response.json({ error: "Unauthorized" }, { status: 401, headers: cors });
      }
      telegramUserId = Number(body.telegramUserId);
      if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) throw new Error("Invalid Telegram user id");
    } else {
      return Response.json({ error: "Unsupported event type" }, { status: 400, headers: cors });
    }

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { error } = await supabase.rpc("record_arnold_analytics_event", {
      p_telegram_user_id: telegramUserId,
      p_event_type: eventType,
    });
    if (error) throw error;
    return Response.json({ ok: true }, { headers: cors });
  } catch (error) {
    console.error("ARNOLD analytics error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Analytics error" }, { status: 400, headers: cors });
  }
});
