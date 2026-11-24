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
    const initData = String(body.initData ?? "");
    const telegramId = await verifyInitData(initData);
    const telegramUserRaw = new URLSearchParams(initData).get("user");
    const telegramUser = telegramUserRaw ? JSON.parse(telegramUserRaw) : {};
    const profileUpdate: Record<string, string> = {};
    const username = String(telegramUser.username ?? "").trim().replace(/^@/, "");
    const displayName = [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(" ").trim();
    if (username) profileUpdate.telegram_username = username;
    if (displayName) profileUpdate.display_name = displayName;
    if (Object.keys(profileUpdate).length) {
      const { error: profileUpdateError } = await admin.schema("arnold").from("user_profiles")
        .update(profileUpdate).eq("telegram_user_id", telegramId);
      if (profileUpdateError) throw profileUpdateError;
    }
    const action = String(body.action ?? "");

    if (action === "sync") {
      // Attribution is accepted ONLY from Telegram's HMAC-verified initData.
      // clientStartParam is a diagnostic hint; it is never used as the inviter ID.
      const signedStartParam = new URLSearchParams(initData).get("start_param") ?? "";
      const clientStartParam = String(body.clientStartParam ?? "");
      if (!signedStartParam) {
        if (clientStartParam.startsWith("ref_")) {
          return json(422, { error: "SIGNED_START_PARAM_MISSING", detail: "Telegram exposed a referral parameter to the client but did not include it in signed initData. No attribution was saved." });
        }
        return json(200, { ok: true, recorded: false, reason: "NO_REFERRAL_CODE" });
      }
      if (!signedStartParam.startsWith("ref_")) {
        return json(200, { ok: true, recorded: false, reason: "NO_REFERRAL_CODE" });
      }
      const referrer = signedStartParam.slice(4);
      if (!/^\d{1,20}$/.test(referrer)) return json(422, { error: "INVALID_SIGNED_REFERRAL_CODE" });
      if (referrer === telegramId) return json(409, { error: "SELF_REFERRAL_NOT_ALLOWED" });

      const ensureProfile = async (id: string, isInvitee = false) => {
        const profileData: Record<string, unknown> = {
          user_id: crypto.randomUUID(),
          telegram_user_id: id,
          updated_at: new Date().toISOString()
        };
        if (isInvitee) Object.assign(profileData, profileUpdate);
        const { data, error: upsertError } = await admin.schema("arnold").from("user_profiles")
          .upsert(profileData, { onConflict: "telegram_user_id", ignoreDuplicates: true })
          .select("user_id").maybeSingle();
        if (upsertError) throw upsertError;
        if (data?.user_id) return String(data.user_id);
        const { data: existing, error: readError } = await admin.schema("arnold").from("user_profiles")
          .select("user_id").eq("telegram_user_id", id).single();
        if (readError) throw readError;
        return String(existing.user_id);
      };

      const referredUserId = await ensureProfile(telegramId, true);
      const referrerUserId = await ensureProfile(referrer);

      // Keep the first valid inviter permanently; retries are idempotent.
      const { error: attributionError } = await admin.from("referral_attributions").upsert(
        { referred_telegram_id: telegramId, referrer_telegram_id: referrer },
        { onConflict: "referred_telegram_id", ignoreDuplicates: true }
      );
      if (attributionError) throw attributionError;

      const { data: attribution, error: attributionReadError } = await admin.from("referral_attributions")
        .select("referrer_telegram_id").eq("referred_telegram_id", telegramId).single();
      if (attributionReadError) throw attributionReadError;
      if (String(attribution.referrer_telegram_id) !== referrer) {
        return json(200, { ok: true, recorded: false, alreadyAttributed: true, reason: "FIRST_REFERRER_PRESERVED" });
      }

      let eligible = false;
      const { data: verifiedWallet, error: verifiedWalletError } = await admin.from("telegram_wallet_links")
        .select("telegram_user_id").eq("telegram_user_id", telegramId).maybeSingle();
      if (verifiedWalletError) throw verifiedWalletError;
      if (verifiedWallet) {
        const { error: linkError } = await admin.schema("arnold").from("referral_links").upsert(
          { referred_user_id: referredUserId, referrer_user_id: referrerUserId },
          { onConflict: "referred_user_id", ignoreDuplicates: true }
        );
        if (linkError) throw linkError;
        eligible = true;
      }
      return json(200, { ok: true, recorded: true, alreadyAttributed: false, eligible });
    }

    if (action === "stats") {
      const { data: rows, error } = await admin.from("referral_attributions")
        .select("referred_telegram_id").eq("referrer_telegram_id", telegramId);
      if (error) throw error;
      const ids = (rows ?? []).map((r: { referred_telegram_id: string }) => String(r.referred_telegram_id));
      if (!ids.length) return json(200, { total: 0, eligible: 0, ineligible: 0, referrals: [] });
      const [verifiedResult, profilesResult] = await Promise.all([
        admin.from("telegram_wallet_links").select("telegram_user_id,verified_at").in("telegram_user_id", ids),
        admin.schema("arnold").from("user_profiles").select("telegram_user_id,telegram_username,display_name")
          .in("telegram_user_id", ids.map(Number))
      ]);
      if (verifiedResult.error) throw verifiedResult.error;
      if (profilesResult.error) throw profilesResult.error;
      const verifiedById = new Map((verifiedResult.data ?? []).map((r: any) => [String(r.telegram_user_id), r]));
      const profileById = new Map((profilesResult.data ?? []).map((r: any) => [String(r.telegram_user_id), r]));
      const referrals = ids.map((id: string) => {
        const profile: any = profileById.get(id);
        const wallet: any = verifiedById.get(id);
        const username = String(profile?.telegram_username ?? "").replace(/^@/, "");
        const name = username ? "@" + username : String(profile?.display_name ?? "").trim() || "Usuario de Telegram";
        return { telegram_user_id: id, name: name.slice(0, 32), eligible: !!wallet, status: wallet ? "eligible" : "pending", verified_at: wallet?.verified_at ?? null };
      });
      const eligible = referrals.filter((r: any) => r.eligible).length;
      return json(200, { total: ids.length, eligible, ineligible: ids.length - eligible, referrals });
    }


    if (action === "earnings" || action === "claim") {
      const { data: profile, error: profileError } = await admin.schema("arnold").from("user_profiles")
        .select("user_id").eq("telegram_user_id", telegramId).maybeSingle();
      if (profileError) throw profileError;
      if (!profile?.user_id) return json(200, { available: 0, reserved: 0, paid: 0, lifetime: 0, mining: 0, tasks: 0 });

      if (action === "claim") {
        const { data: claim, error: claimError } = await admin.rpc("credit_arnold_referral_rewards", { p_referrer_user_id: profile.user_id });
        if (claimError) throw claimError;
        const credited = Number(claim?.credited || 0);
        const amount = Number(claim?.amount || 0);
        if (!credited || amount <= 0) return json(409, { error: "NO_REFERRAL_REWARDS_AVAILABLE" });
        return json(200, { credited: true, count: credited, amount, status: "credited" });
      }

      const { data: rows, error: rewardsError } = await admin.schema("arnold").from("referral_rewards")
        .select("amount,status,source_cycle_id,source_earning_id")
        .eq("referrer_user_id", profile.user_id).in("status", ["pending", "reserved", "credited", "paid"]);
      if (rewardsError) throw rewardsError;
      const totals = { available: 0, reserved: 0, credited: 0, paid: 0, mining: 0, tasks: 0 };
      for (const row of rows ?? []) {
        const amount = Number(row.amount) || 0;
        if (row.status === "pending") {
          totals.available += amount;
          if (row.source_cycle_id) totals.mining += amount;
          if (row.source_earning_id) totals.tasks += amount;
        } else if (row.status === "reserved") totals.reserved += amount;
        else if (row.status === "credited") totals.credited += amount;
        else if (row.status === "paid") totals.paid += amount;
      }
      return json(200, {
        available: Number(totals.available.toFixed(6)),
        reserved: Number(totals.reserved.toFixed(6)),
        credited: Number(totals.credited.toFixed(6)),
        paid: Number(totals.paid.toFixed(6)),
        referrals: Number(totals.credited.toFixed(6)),
        lifetime: Number((totals.available + totals.reserved + totals.credited + totals.paid).toFixed(6)),
        mining: Number(totals.mining.toFixed(6)),
        tasks: Number(totals.tasks.toFixed(6))
      });
    }

    if (action === "leaderboard") {
      const { data: profiles, error: profileError } = await admin.schema("arnold").from("user_profiles")
        .select("user_id,telegram_user_id,telegram_username,display_name").not("telegram_user_id", "is", null);
      if (profileError) throw profileError;
      const ids = (profiles ?? []).map((p: any) => p.user_id);
      if (!ids.length) return json(200, { leaderboard: [], my_rank: null });

      const [walletResult, miningResult, taskResult, referralResult] = await Promise.all([
        admin.schema("arnold").from("wallet_links").select("user_id").in("user_id", ids).eq("is_verified", true).eq("is_primary", true),
        admin.schema("arnold").from("reward_ledger").select("user_id,amount,status").in("user_id", ids).eq("status", "claimed"),
        admin.from("user_earnings").select("telegram_user_id,amount,source").in("telegram_user_id", (profiles ?? []).map((p: any) => String(p.telegram_user_id))),
        admin.schema("arnold").from("referral_rewards").select("referrer_user_id,amount,status").in("referrer_user_id", ids).in("status", ["pending", "credited", "paid"])
      ]);
      if (walletResult.error) throw walletResult.error;
      if (miningResult.error) throw miningResult.error;
      if (taskResult.error) throw taskResult.error;
      if (referralResult.error) throw referralResult.error;

      const verifiedIds = new Set((walletResult.data ?? []).map((r: any) => r.user_id));
      const totals = new Map<string, { mining: number; tasks: number; referrals: number }>();
      for (const id of ids) totals.set(id, { mining: 0, tasks: 0, referrals: 0 });
      for (const row of miningResult.data ?? []) {
        const item = totals.get(row.user_id); if (item) item.mining += Number(row.amount) || 0;
      }
      const profileByTelegram = new Map((profiles ?? []).map((p: any) => [String(p.telegram_user_id), p]));
      for (const row of taskResult.data ?? []) {
        const profile: any = profileByTelegram.get(String(row.telegram_user_id));
        const item = profile ? totals.get(profile.user_id) : null;
        const amount = Number(row.amount) || 0;
        if (item && row.source === "task" && amount > 0) item.tasks += amount;
        // Mining entries are read from the canonical claim ledger to avoid double counting.
      }
      for (const row of referralResult.data ?? []) {
        const item = totals.get(row.referrer_user_id);
        if (item) item.referrals += Number(row.amount) || 0;
      }
      const ranked = (profiles ?? []).filter((p: any) => verifiedIds.has(p.user_id)).map((p: any) => {
        const item = totals.get(p.user_id)!;
        const total = item.mining + item.tasks + item.referrals;
        const username = String(p.telegram_username ?? "").replace(/^@/, "");
        const display = String(p.display_name ?? "").trim();
        const safeName = username ? "@" + username : display || "Miner";
        return { telegram_id: String(p.telegram_user_id), name: safeName.slice(0, 24), total, mining: item.mining, tasks: item.tasks, referrals: item.referrals };
      }).filter((p: any) => p.total > 0)
        .sort((a: any, b: any) => b.total - a.total || a.telegram_id.localeCompare(b.telegram_id))
        .slice(0, 100);
      const leaderboard = ranked.map((p: any, index: number) => ({
        rank: index + 1, name: p.name,
        total: Number(p.total.toFixed(6)), mining: Number(p.mining.toFixed(6)),
        tasks: Number(p.tasks.toFixed(6)), referrals: Number(p.referrals.toFixed(6))
      }));
      const myIndex = ranked.findIndex((p: any) => p.telegram_id === telegramId);
      return json(200, { leaderboard, my_rank: myIndex >= 0 ? myIndex + 1 : null });
    }

    if (action === "pay") {
      return json(503, {
        error: "WALLET_PROOF_REQUIRED",
        detail: "The connected wallet must be cryptographically bound to the Telegram user before an on-chain fee can be credited."
      });
    }

    return json(400, { error: "UNKNOWN_ACTION" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message.startsWith("INVALID_") || message.startsWith("EXPIRED_") ? 401 : 500;
    return json(status, { error: message });
  }
});