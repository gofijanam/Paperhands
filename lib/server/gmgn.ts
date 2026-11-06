import {env} from '@/lib/server/runtime';
import {mapGmgnCoin, unwrapGmgn, mapGmgnCandles, mapGmgnHolders, mapGmgnTraders} from '../market-normalize';
import type {TFeedColumn,TTimeframe} from '../api/schema';
const SOL='So11111111111111111111111111111111111111112';
const cfg=(key:string)=>(env as any)[key]||process.env[key]||'';
export const gmgnEnabled=()=>!!cfg('MARKET_GATEWAY_URL')||!!cfg('GMGN_API_KEY')&&cfg('GMGN_DIRECT_PAUSED')!=='1';
const memo=new Map<string,{value:any;at:number;until:number}>(), pending=new Map<string,Promise<any>>();
let retryAt=0;
// Shared D1 cache + request coalescing. Credentials never enter URLs or cached payloads.
export async function gmgn(path:string,params:Record<string,string|number>={},ttl=10000,body?:any):Promise<{data:any;at:number}>{
 const key='gmgn:'+path+':'+JSON.stringify(params)+':'+(body?JSON.stringify(body):'');
 const m=memo.get(key);if(m&&m.until>Date.now())return {data:m.value,at:m.at};
 if(pending.has(key))return pending.get(key)!;
 const task=(async()=>{
  let saved:any;try{saved=await env.DB?.prepare('SELECT data,fetched,expires FROM market_cache WHERE key=?').bind(key).first();}catch{}
  const now=Date.now();
  if(saved?.expires>now){const data=JSON.parse(saved.data);memo.set(key,{value:data,at:saved.fetched,until:saved.expires});return {data,at:saved.fetched};}
  try{
   if(!gmgnEnabled())throw new Error('GMGN requires the dedicated market service. Its current server IP is rate-limited.');
   if(cfg('MARKET_GATEWAY_URL')){
    const url=new URL('/gmgn',cfg('MARKET_GATEWAY_URL'));if(url.protocol!=='https:')throw new Error('Market service must use HTTPS');
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+cfg('MARKET_GATEWAY_TOKEN')},body:JSON.stringify({path,params,ttl,body}),signal:AbortSignal.timeout(10000)});
    const j:any=await r.json();if(!r.ok)throw new Error(j.error||'Market service unavailable');if(!Number.isFinite(j.at)||!j.data)throw new Error('Invalid market observation');
    await env.DB?.prepare('INSERT INTO market_cache(key,data,fetched,expires) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched=excluded.fetched,expires=excluded.expires').bind(key,JSON.stringify(j.data),j.at,j.at+ttl).run();memo.set(key,{value:j.data,at:j.at,until:j.at+ttl});return {data:j.data,at:j.at};
   }
   const globalBackoff=await env.DB?.prepare("SELECT expires FROM paper_limits WHERE key='gmgn-backoff'").first<{expires:number}>();
   retryAt=Math.max(retryAt,globalBackoff?.expires||0);
   if(now<retryAt)throw new Error('Market provider rate limit. Retrying shortly.');
   // A D1 lease serializes upstream requests across Worker isolates. A full
   // bucket (5 units for holders/traders) can drain before the next request.
   const lease=crypto.randomUUID(),deadline=Date.now()+4500;
   let acquired=false;
   while(Date.now()<deadline){
    const now=Date.now();const row=await env.DB?.prepare("INSERT INTO market_cache(key,data,fetched,expires) VALUES('gmgn-lease',?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched=excluded.fetched,expires=excluded.expires WHERE expires<=? RETURNING data").bind(lease,now,now+9000,now).first<{data:string}>();
    if(row?.data===lease){acquired=true;break;}
    await new Promise(r=>setTimeout(r,250));
   }
   if(!acquired)throw new Error('Market feed busy. Cached observations remain visible.');
   let r:Response;
   try{
   const cooldown=await env.DB?.prepare("SELECT expires FROM paper_limits WHERE key='gmgn-backoff'").first<{expires:number}>();
   if((cooldown?.expires||0)>Date.now())throw new Error('Market provider cooling down. Cached observations remain visible.');
   const query=new URLSearchParams({chain:'sol',...Object.fromEntries(Object.entries(params).map(([k,v])=>[k,String(v)])),timestamp:String(Math.floor(Date.now()/1000)),client_id:crypto.randomUUID()});
   r=await fetch('https://openapi.gmgn.ai'+path+'?'+query,{method:body?'POST':'GET',headers:{'X-APIKEY':(env as any).GMGN_API_KEY||process.env.GMGN_API_KEY,'Content-Type':'application/json','User-Agent':'Paperhands/1.0'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(6500)});
   if(r.status===429){const error:any=await r.clone().json().catch(()=>({}));retryAt=Math.max(Date.now()+10000,Number(r.headers.get('x-ratelimit-reset')||error.reset_at||0)*1000+1500);await env.DB?.prepare("INSERT INTO paper_limits(key,count,expires) VALUES('gmgn-backoff',0,?) ON CONFLICT(key) DO UPDATE SET expires=max(expires,excluded.expires)").bind(retryAt).run();}
   if(!r.ok){const error:any=await r.json().catch(()=>({}));await env.DB?.prepare('INSERT INTO market_cache(key,data,fetched,expires) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched=excluded.fetched,expires=excluded.expires').bind('gmgn-diagnostic',JSON.stringify({status:r.status,reason:error.error||error.reason||'upstream',message:String(error.message||'').slice(0,240),path,at:Date.now(),retryAt}),Date.now(),Date.now()+600000).run();throw new Error(`Market provider unavailable (${r.status}).`);}
   }finally{await env.DB?.prepare("UPDATE market_cache SET expires=? WHERE key='gmgn-lease' AND data=?").bind(Date.now()+1250,lease).run();}
   const data=unwrapGmgn(await r.json()),at=Date.now();
   await env.DB?.prepare('INSERT INTO market_cache(key,data,fetched,expires) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched=excluded.fetched,expires=excluded.expires').bind(key,JSON.stringify(data),at,at+ttl).run();
   if(memo.size>400)memo.delete(memo.keys().next().value!);memo.set(key,{value:data,at,until:at+ttl});return {data,at};
  }catch(e){if(saved&&now-saved.fetched<120000)return {data:JSON.parse(saved.data),at:saved.fetched};throw e;}
 })().finally(()=>pending.delete(key));pending.set(key,task);return task;
}
export const gmgnInfo=(mint:string,fresh=false)=>gmgn('/v1/token/info',{address:mint},fresh?2000:8000);
async function solPrice(){const j=await gmgn('/v1/token/info',{address:SOL},10000);const v=Number(j.data.price?.price??j.data.price);if(!(v>0))throw new Error('SOL price unavailable');return {value:v,at:j.at};}
export async function gmgnCoin(mint:string,fresh=false){const [j,sol]=await Promise.all([gmgnInfo(mint,fresh),solPrice()]);return mapGmgnCoin(j.data,sol.value,Math.min(j.at,sol.at));}
export async function gmgnFeed(col:TFeedColumn){
 const j=col==='trending'?await gmgn('/v1/market/rank',{interval:'24h',limit:30},5000):await gmgn('/v1/trenches',{},5000,{version:'v2',new_creation:{filters:['offchain','onchain'],launchpad_platform_v2:true,limit:30},completed:{filters:['offchain','onchain'],launchpad_platform_v2:true,limit:30}});
 const sol=await solPrice();const rows=col==='trending'?j.data.rank:j.data[col==='new'?'new_creation':'completed'];
 const list=Array.isArray(rows)?rows:rows?.list??rows?.tokens??[];
 return list.map((r:any)=>mapGmgnCoin(r,sol.value,Math.min(j.at,sol.at))).filter(Boolean).slice(0,30);
}
export async function gmgnSearch(q:string){const [j,sol]=await Promise.all([gmgn('/v1/market/search',{q:q.slice(0,80)},20000),solPrice()]);const rows=Array.isArray(j.data)?j.data:j.data.coins??j.data.tokens??j.data.token??j.data.list??[];return rows.filter((r:any)=>!r.chain||r.chain==='sol').map((r:any)=>mapGmgnCoin(r,sol.value,Math.min(j.at,sol.at))).filter(Boolean).slice(0,20);}
export async function gmgnCandles(mint:string,tf:TTimeframe){const secs:Record<TTimeframe,number>={'1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400};const end=Math.floor(Date.now()/15000)*15000;const j=await gmgn('/v1/market/token_kline',{address:mint,resolution:tf,from:end-(secs[tf]??300)*300*1000,to:end},15000);return mapGmgnCandles(j.data);}
export async function gmgnHolders(mint:string){const j=await gmgn('/v1/market/token_top_holders',{address:mint,limit:100},30000);return mapGmgnHolders(j.data);}
export async function gmgnTraders(mint:string){const j=await gmgn('/v1/market/token_top_traders',{address:mint,limit:100,order_by:'profit',direction:'desc'},30000);return mapGmgnTraders(j.data);}
