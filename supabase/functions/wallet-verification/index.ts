import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Address, Cell } from "npm:@ton/core@0.63.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? SECRET_KEYS.default ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TONCENTER_API_KEY = Deno.env.get("TONCENTER_API_KEY") ?? "";
const TREASURY = "UQDuU4KpCx7KsjwXJa4N9XizHF9k1s7pfyfzCvftFwofEgGk";
const FEE_NANO = "100000000";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
function json(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers: cors }); }
function rawAddress(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try { return Address.parse(value).toRawString(); } catch { return null; }
}
async function verifyTelegram(initData: string): Promise<string> {
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN_MISSING");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("INVALID_TELEGRAM_DATA");
  params.delete("hash");
  const check = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => k+"="+v).join("\n");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const secret = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(BOT_TOKEN)));
  const hkey = await crypto.subtle.importKey("raw", secret, {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const actual = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", hkey, enc.encode(check))), b=>b.toString(16).padStart(2,"0")).join("");
  if (actual.length !== hash.length) throw new Error("INVALID_TELEGRAM_SIGNATURE");
  let diff=0; for(let i=0;i<actual.length;i++) diff |= actual.charCodeAt(i)^hash.charCodeAt(i);
  if(diff) throw new Error("INVALID_TELEGRAM_SIGNATURE");
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Math.abs(Date.now()/1000-authDate)>86400) throw new Error("EXPIRED_TELEGRAM_DATA");
  const user = JSON.parse(params.get("user") ?? "{}");
  if (!user.id) throw new Error("TELEGRAM_USER_MISSING");
  return String(user.id);
}
function decodeComment(msg: any): string | null {
  const decoded = msg?.message_content?.decoded ?? msg?.decoded ?? {};
  if (typeof decoded.comment === "string") return decoded.comment;
  const body = msg?.message_content?.body ?? msg?.msg_data?.body;
  if (typeof body !== "string") return null;
  try {
    const slice = Cell.fromBase64(body).beginParse();
    if (slice.remainingBits < 32 || slice.loadUint(32)!==0) return null;
    return slice.loadStringTail();
  } catch { return null; }
}
async function findPayment(wallet: string, memo: string, createdAt: string): Promise<string|null> {
  const treasuryRaw = rawAddress(TREASURY), walletRaw = rawAddress(wallet);
  if (!treasuryRaw || !walletRaw) throw new Error("INVALID_TON_ADDRESS");
  const url = new URL("https://toncenter.com/api/v3/transactions");
  url.searchParams.set("account", treasuryRaw); url.searchParams.set("limit","100"); url.searchParams.set("sort","desc");
  url.searchParams.set("start_utime", String(Math.floor(new Date(createdAt).getTime()/1000)));
  url.searchParams.set("end_utime", String(Math.floor(Date.now()/1000)));
  const headers:Record<string,string>={accept:"application/json"};
  if(TONCENTER_API_KEY) headers["X-API-Key"]=TONCENTER_API_KEY;
  const res=await fetch(url,{headers,signal:AbortSignal.timeout(9000)});
  if(!res.ok) throw new Error("TON_TRANSACTION_LOOKUP_UNAVAILABLE");
  const data=await res.json();
  for(const tx of data?.transactions??[]){
    const msg=tx?.in_msg;
    if(!msg || msg.bounced===true) continue;
    if(rawAddress(msg.source)!==walletRaw || rawAddress(msg.destination)!==treasuryRaw) continue;
    if(String(msg.value??"")!==FEE_NANO || decodeComment(msg)!==memo) continue;
    if(Number(tx.mc_block_seqno??0)<=0) continue;
    if(!tx.description || tx.description.aborted!==false) continue;
    if(tx.description.compute_ph?.success===false || tx.description.action?.success===false) continue;
    if(typeof tx.hash==="string" && tx.hash.length>20) return tx.hash;
  }
  return null;
}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json(405,{error:"METHOD_NOT_ALLOWED"});
  try{
    if(!SUPABASE_URL||!SERVICE_KEY) return json(503,{error:"BACKEND_NOT_CONFIGURED"});
    const body=await req.json(); const telegramId=await verifyTelegram(String(body.initData??""));
    const action=String(body.action??"");
    if(action==="status"){
      const {data,error}=await admin.from("telegram_wallet_links").select("wallet_address,verified_at").eq("telegram_user_id",telegramId).maybeSingle();
      if(error) throw error;
      const {data:pending,error:pendingError}=await admin.from("telegram_wallet_verification_intents").select("id,memo,wallet_address,expires_at,created_at").eq("telegram_user_id",telegramId).is("used_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(pendingError) throw pendingError;
      return json(200,{verified:!!data,wallet_address:data?.wallet_address??null,verified_at:data?.verified_at??null,pending_intent:pending?{intent_id:pending.id,memo:pending.memo,wallet_address:pending.wallet_address,recipient:TREASURY,amount_nano:FEE_NANO,expires_at:pending.expires_at}:null});
    }
    if(action==="create_intent"){
      const wallet=String(body.walletAddress??"");
      if(!rawAddress(wallet)) return json(400,{error:"INVALID_WALLET_ADDRESS"});
      const {data:existing,error:existingError}=await admin.from("telegram_wallet_links").select("wallet_address,verified_at").eq("telegram_user_id",telegramId).maybeSingle();
      if(existingError) throw existingError;
      if(existing && rawAddress(existing.wallet_address)===rawAddress(wallet)) return json(200,{verified:true,wallet_address:existing.wallet_address});
      const {data:pending,error:pendingError}=await admin.from("telegram_wallet_verification_intents").select("id,memo,expires_at").eq("telegram_user_id",telegramId).eq("wallet_address",wallet).is("used_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(pendingError) throw pendingError;
      if(pending) return json(200,{intent_id:pending.id,memo:pending.memo,recipient:TREASURY,amount_nano:FEE_NANO,expires_at:pending.expires_at,reused:true});
      const id=crypto.randomUUID();
      const memo="ARNOLD-WALLET:"+id;
      const expiresAt=new Date(Date.now()+15*60_000).toISOString();
      const {error}=await admin.from("telegram_wallet_verification_intents").insert({id,telegram_user_id:telegramId,wallet_address:wallet,memo,expires_at:expiresAt});
      if(error) throw error;
      return json(201,{intent_id:id,memo,recipient:TREASURY,amount_nano:FEE_NANO,expires_at:expiresAt});
    }
    if(action==="verify_payment"){
      const id=String(body.intentId??"");
      const {data:intent,error}=await admin.from("telegram_wallet_verification_intents").select("*").eq("id",id).eq("telegram_user_id",telegramId).maybeSingle();
      if(error) throw error;
      if(!intent) return json(404,{error:"VERIFICATION_INTENT_NOT_FOUND"});
      if(intent.used_at) {
        const {data:link}=await admin.from("telegram_wallet_links").select("wallet_address,verified_at").eq("telegram_user_id",telegramId).maybeSingle();
        return json(200,{verified:!!link,wallet_address:link?.wallet_address??null});
      }
      const txHash=await findPayment(intent.wallet_address,intent.memo,intent.created_at);
      if(!txHash) return json(202,{verified:false,status:"pending",message:"Todavía no aparece la transferencia confirmada. Vuelve a comprobar en unos segundos."});
      const {data:used,error:usedError}=await admin.from("telegram_wallet_links").select("telegram_user_id").eq("payment_tx_hash",txHash).maybeSingle();
      if(usedError) throw usedError;
      if(used && used.telegram_user_id!==telegramId) return json(409,{error:"PAYMENT_ALREADY_USED"});
      const {data:profile,error:profileError}=await admin.schema("arnold").from("user_profiles").upsert({
        user_id:crypto.randomUUID(),telegram_user_id:telegramId,updated_at:new Date().toISOString()
      },{onConflict:"telegram_user_id",ignoreDuplicates:true}).select("user_id").maybeSingle();
      if(profileError) throw profileError;
      let userId=profile?.user_id;
      if(!userId){
        const {data:existingProfile,error:fetchProfileError}=await admin.schema("arnold").from("user_profiles").select("user_id").eq("telegram_user_id",telegramId).single();
        if(fetchProfileError) throw fetchProfileError; userId=existingProfile.user_id;
      }
      const {data:walletOwner,error:walletOwnerError}=await admin.schema("arnold").from("wallet_links").select("user_id").eq("network","TON").eq("wallet_address",intent.wallet_address).maybeSingle();
      if(walletOwnerError) throw walletOwnerError;
      if(walletOwner && walletOwner.user_id!==userId) return json(409,{error:"WALLET_ALREADY_LINKED_TO_ANOTHER_ACCOUNT"});
      const {data:telegramWalletOwner,error:telegramWalletOwnerError}=await admin.from("telegram_wallet_links").select("telegram_user_id").eq("wallet_address",intent.wallet_address).maybeSingle();
      if(telegramWalletOwnerError) throw telegramWalletOwnerError;
      if(telegramWalletOwner && telegramWalletOwner.telegram_user_id!==telegramId) return json(409,{error:"WALLET_ALREADY_LINKED_TO_ANOTHER_TELEGRAM_USER"});
      const {error:walletError}=await admin.schema("arnold").from("wallet_links").upsert({
        user_id:userId,network:"TON",wallet_address:intent.wallet_address,is_verified:true,verified_at:new Date().toISOString(),is_primary:true
      },{onConflict:"network,wallet_address"});
      if(walletError) throw walletError;
      const {error:linkError}=await admin.from("telegram_wallet_links").upsert({
        telegram_user_id:telegramId,wallet_address:intent.wallet_address,payment_tx_hash:txHash,verified_at:new Date().toISOString()
      },{onConflict:"telegram_user_id"});
      if(linkError) throw linkError;
      const {error:markError}=await admin.from("telegram_wallet_verification_intents").update({used_at:new Date().toISOString()}).eq("id",id).is("used_at",null);
      if(markError) throw markError;
      return json(200,{verified:true,wallet_address:intent.wallet_address,transaction_hash:txHash});
    }
    return json(400,{error:"UNKNOWN_ACTION"});
  }catch(error){
    const message=error instanceof Error?error.message:"UNKNOWN_ERROR";
    const status=message.startsWith("INVALID_")||message.startsWith("EXPIRED_")?401:500;
    return json(status,{error:message});
  }
});
