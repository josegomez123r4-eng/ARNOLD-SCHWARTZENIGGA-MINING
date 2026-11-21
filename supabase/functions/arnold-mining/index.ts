import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Address } from "npm:@ton/core@0.63.0";

const URL=Deno.env.get("SUPABASE_URL")??"";
const KEYS=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??KEYS.default??"";
const BOT_TOKEN=Deno.env.get("TELEGRAM_BOT_TOKEN")??"";
const TONAPI_KEY=Deno.env.get("TONAPI_KEY")??"";
const MASTER="EQAx1gPnzQHLRWULxJJL0mSb-iB88JEcZCc0f8BA8Kk_pa9w";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const db=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
function json(status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:cors});}
async function telegramId(initData:string){
 if(!BOT_TOKEN)throw new Error("TELEGRAM_BOT_TOKEN_MISSING");
 const p=new URLSearchParams(initData),hash=p.get("hash");if(!hash)throw new Error("INVALID_TELEGRAM_DATA");p.delete("hash");
 const str=Array.from(p.entries()).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n"),enc=new TextEncoder();
 const k=await crypto.subtle.importKey("raw",enc.encode("WebAppData"),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,enc.encode(BOT_TOKEN)));
 const hk=await crypto.subtle.importKey("raw",s,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const actual=Array.from(new Uint8Array(await crypto.subtle.sign("HMAC",hk,enc.encode(str))),b=>b.toString(16).padStart(2,"0")).join("");
 if(actual.length!==hash.length)throw new Error("INVALID_TELEGRAM_SIGNATURE");let d=0;for(let i=0;i<actual.length;i++)d|=actual.charCodeAt(i)^hash.charCodeAt(i);if(d)throw new Error("INVALID_TELEGRAM_SIGNATURE");
 const date=Number(p.get("auth_date")??0);if(!date||Math.abs(Date.now()/1000-date)>86400)throw new Error("EXPIRED_TELEGRAM_DATA");
 const u=JSON.parse(p.get("user")??"{}");if(!u.id)throw new Error("TELEGRAM_USER_MISSING");return String(u.id);
}
async function holdingBalance(wallet:string):Promise<string>{
 const address=Address.parse(wallet).toRawString();
 const headers:Record<string,string>={accept:"application/json"};if(TONAPI_KEY)headers.Authorization="Bearer "+TONAPI_KEY;
 const r=await fetch("https://tonapi.io/v2/accounts/"+encodeURIComponent(address)+"/jettons",{headers,signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw new Error("ARNOLD_BALANCE_LOOKUP_FAILED");
 const data=await r.json(),items=data.balances??[];
 const found=items.find((x:any)=>{try{return Address.parse(x.jetton.address).equals(Address.parse(MASTER));}catch{return false;}});
 if(!found)return "0";
 const decimals=Number(found.jetton?.decimals??9),raw=BigInt(String(found.balance??"0"));
 const whole=raw/(10n**BigInt(decimals)),frac=(raw%(10n**BigInt(decimals))).toString().padStart(decimals,"0").slice(0,9).replace(/0+$/,"");
 return frac?whole.toString()+"."+frac:whole.toString();
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json(405,{error:"METHOD_NOT_ALLOWED"});
 try{
  if(!URL||!SERVICE)return json(503,{error:"BACKEND_NOT_CONFIGURED"});
  const body=await req.json(),tid=await telegramId(String(body.initData??"")),action=String(body.action??"");
  const {data:profile,error:pe}=await db.schema("arnold").from("user_profiles").select("user_id").eq("telegram_user_id",tid).maybeSingle();
  if(pe)throw pe;
  if(action==="status"){
   if(!profile)return json(200,{verified:false,cycle:null,earned:"0",pending:"0"});
   const {data:wallet,error:we}=await db.schema("arnold").from("wallet_links").select("wallet_address,is_verified").eq("user_id",profile.user_id).eq("is_primary",true).maybeSingle();if(we)throw we;
   const {data:cycles,error:ce}=await db.schema("arnold").from("mining_cycles").select("id,status,started_at,ends_at,total_reward,base_reward,holding_bonus,purchase_bonus").eq("user_id",profile.user_id).in("status",["active","claimable"]).order("created_at",{ascending:false}).limit(1);if(ce)throw ce;
   const {data:ledger,error:le}=await db.schema("arnold").from("reward_ledger").select("amount,status").eq("user_id",profile.user_id);if(le)throw le;
   const earned=(ledger??[]).filter((x:any)=>x.status==="claimed").reduce((s:number,x:any)=>s+Number(x.amount),0);
   const pending=(ledger??[]).filter((x:any)=>x.status==="pending").reduce((s:number,x:any)=>s+Number(x.amount),0);
   return json(200,{verified:wallet?.is_verified===true,wallet_address:wallet?.wallet_address??null,cycle:cycles?.[0]??null,earned:String(earned),pending:String(pending)});
  }
  if(!profile)return json(403,{error:"WALLET_VERIFICATION_REQUIRED"});
  const {data:wallet,error:we}=await db.schema("arnold").from("wallet_links").select("wallet_address,is_verified").eq("user_id",profile.user_id).eq("is_primary",true).maybeSingle();if(we)throw we;
  if(!wallet?.is_verified)return json(403,{error:"WALLET_VERIFICATION_REQUIRED"});
  const balance=await holdingBalance(wallet.wallet_address);
  if(action==="start"){
   const {data,error}=await db.rpc("start_arnold_mining",{p_user_id:profile.user_id,p_verified_holding_balance:balance});
   if(error)throw error;return json(200,{cycle:data,holding_balance:balance});
  }
  if(action==="claim"){
   const cycleId=String(body.cycleId??"");if(!/^[0-9a-f-]{36}$/i.test(cycleId))return json(400,{error:"INVALID_CYCLE_ID"});
   const {data,error}=await db.rpc("claim_arnold_mining",{p_user_id:profile.user_id,p_cycle_id:cycleId,p_verified_holding_balance:balance});
   if(error)throw error;return json(200,{claim:data,holding_balance:balance,delivery:"internal_ledger_only"});
  }
  return json(400,{error:"UNKNOWN_ACTION"});
 }catch(e){const message=e instanceof Error?e.message:"UNKNOWN_ERROR";const status=message.startsWith("INVALID_")||message.startsWith("EXPIRED_")?401:message.includes("not verified")?403:500;return json(status,{error:message});}
});
