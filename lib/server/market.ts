import {recentStreamTrades} from './node-stream';
import {normalizeDexAnalytics} from '../dex-analytics';
import {env} from '@/lib/server/runtime';
import {gmgnEnabled,gmgnFeed,gmgnCoin,gmgnSearch,gmgnCandles} from './gmgn';
import type { TCoin, TCandle, TTrade, TFeedColumn, TTimeframe } from '../api/schema';
const GT = 'https://api.geckoterminal.com/api/v2';
const DX = 'https://api.dexscreener.com';
export const SOL = 'So11111111111111111111111111111111111111112';
export const validMint = (x: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
export type MarketCoin = TCoin & { pool: string; dex: string; observedAt: number; change5mPct?: number; change1hPct?: number; buys24h?: number; sells24h?: number; marketCapEstimated?: boolean };
const cache = new Map<string, { until:number; value:any }>();
let geckoRetryAt=0;
const pending = new Map<string, Promise<any>>();
export async function upstream(url:string, ttl=15000):Promise<any> {
  const tag=(value:any,asOf:number)=>{Object.defineProperty(value,'_asOf',{value:asOf,configurable:true});return value;};
  const hit=cache.get(url); if(hit && hit.until>Date.now()) return hit.value;
  if(pending.has(url)) return pending.get(url);
  const task=(async()=>{
    let saved:any=null;
    try {saved=await env.DB?.prepare('SELECT data,fetched,expires FROM market_cache WHERE key=?').bind(url).first();}catch{}
    if(saved&&saved.expires>Date.now()){const v=tag(JSON.parse(saved.data),saved.fetched);cache.set(url,{until:saved.expires,value:v});return v;}
    try{
      if(url.startsWith(GT)&&Date.now()<geckoRetryAt)throw new Error('Market provider is busy.');
      const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(7000)});
      if(r.status===429&&url.startsWith(GT))geckoRetryAt=Date.now()+60000;
      if(!r.ok) throw new Error(r.status===429?'Market provider is busy. Try again shortly.':`Market data unavailable (${r.status}).`);
      const value:any=await r.json(), now=Date.now();
      const expires=now+ttl;
      try{await env.DB?.prepare('INSERT INTO market_cache(key,data,fetched,expires) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched=excluded.fetched,expires=excluded.expires').bind(url,JSON.stringify(value),now,expires).run();}catch{}
      tag(value,now);if(cache.size>500)cache.delete(cache.keys().next().value!);cache.set(url,{until:expires,value});return value;
    }catch(e){
      // Last real observation, at most two minutes old. Quotes separately reject stale prices.
      if(saved&&Date.now()-saved.fetched<120000)return tag(JSON.parse(saved.data),saved.fetched);
      throw e;
    }
  })().finally(()=>pending.delete(url));pending.set(url,task);return task;
}
const f=(v:any)=>Number.isFinite(Number(v))&&v!=null?Number(v):0;
const cleanUrl=(s:any)=>typeof s==='string'&&/^https:\/\//i.test(s)?s:null;
function gecko(j:any):MarketCoin[]{
  const inc=new Map((j.included??[]).map((x:any)=>[x.id,x.attributes]));
  const pools=Array.isArray(j.data)?j.data:[j.data];
  return pools.filter(Boolean).map((p:any)=>{
    const a=p.attributes, baseId=p.relationships.base_token.data.id, token:any=inc.get(baseId)||{};
    const mint=baseId.replace(/^solana_/,''), dex=p.relationships.dex?.data?.id??'unknown';
    const pu=f(a.base_token_price_usd),ps=f(a.base_token_price_native_currency),liq=f(a.reserve_in_usd);
    return {mint,symbol:token.symbol||a.name.split(' / ')[0],name:token.name||a.name.split(' / ')[0],imageUrl:cleanUrl(token.image_url),priceUsd:pu,priceSol:ps,mcapUsd:f(a.market_cap_usd)||f(a.fdv_usd),marketCapEstimated:!a.market_cap_usd,vol24hUsd:f(a.volume_usd?.h24),change24hPct:f(a.price_change_percentage?.h24),change5mPct:f(a.price_change_percentage?.m5),change1hPct:f(a.price_change_percentage?.h1),liquidityUsd:liq,holders:NaN,ageSec:Math.max(0,(Date.now()-Date.parse(a.pool_created_at))/1000),venue:'graduated' as const,curvePct:100,athUsd:NaN,status:pu>0&&ps>0&&liq>=1000?'tradeable' as const:'untradeable' as const,decimals:token.decimals??9,pool:a.address,dex,observedAt:j._asOf||Date.now(),riskBadges:liq<10000?['Low liquidity']:[],buys24h:f(a.transactions?.h24?.buys),sells24h:f(a.transactions?.h24?.sells)};
  }).filter((c:MarketCoin)=>validMint(c.mint)&&c.mint!==SOL);
}
const coinCache=new Map<string,MarketCoin>();
function remember(cs:MarketCoin[]){for(const c of cs)coinCache.set(c.mint,c);if(coinCache.size>1000)coinCache.delete(coinCache.keys().next().value!);return cs;}
function unique(cs:MarketCoin[]){const seen=new Set();return cs.filter(c=>!seen.has(c.mint)&&!!seen.add(c.mint));}
export async function marketFeed(col:TFeedColumn){
 if(gmgnEnabled()){try{const cs=await gmgnFeed(col);if(cs.length)return remember(cs as MarketCoin[]);}catch{}}
  const endpoint=col==='new'?'new_pools':col==='graduating'?'dexes/pumpswap/pools':'trending_pools';
  try {const j=await upstream(`${GT}/networks/solana/${endpoint}?include=base_token,quote_token,dex&page=1`,30000);return unique(remember(gecko(j)));} catch { return dexFeed(col); }
}
export async function marketCoin(mint:string, fresh=false):Promise<MarketCoin|null>{
  if(!validMint(mint)) return null;
  if(gmgnEnabled()){try{const c=await gmgnCoin(mint,fresh);if(c){remember([c]);return c;}}catch{}}
  // Executable quotes must not get stuck on an old bulk discovery snapshot.
  // Prefer the fast public token endpoint for fresh quotes when GMGN is unavailable.
  if(fresh){try{const pairs=await upstream(`${DX}/tokens/v1/solana/${mint}`,2000);const c=(await mapDex(pairs)).filter(c=>c.mint===mint&&Date.now()-c.observedAt<10000).sort((a,b)=>b.liquidityUsd-a.liquidityUsd)[0];if(c){remember([c]);return c;}}catch{}}
  // Reuse a recently observed bulk snapshot before spending another public API call.
  try{const rows=await env.DB?.prepare("SELECT data,fetched FROM market_cache WHERE key LIKE 'https://api.dexscreener.com/%' AND fetched>? AND data LIKE ? ORDER BY fetched DESC LIMIT 4").bind(Date.now()-120000,'%'+mint+'%').all<any>();
   for(const row of rows?.results||[]){if(fresh&&Date.now()-row.fetched>10000)continue;const data=JSON.parse(row.data),pairs=Array.isArray(data)?data:data.pairs;if(!Array.isArray(pairs))continue;const selected=pairs.filter((p:any)=>p.baseToken?.address===mint&&p.priceUsd);Object.defineProperty(selected,'_asOf',{value:row.fetched});const c=(await mapDex(selected)).sort((a,b)=>b.liquidityUsd-a.liquidityUsd)[0];if(c){remember([c]);return c;}}
  }catch{}
  const known=coinCache.get(mint);if(!fresh&&known&&Date.now()-known.observedAt<15000)return known;
  try {
  const j=await upstream(`${GT}/networks/solana/tokens/${mint}/pools?include=base_token,quote_token,dex`,fresh?5000:20000);
  const found=gecko(j).filter(c=>c.mint===mint).sort((a,b)=>b.liquidityUsd-a.liquidityUsd)[0];
  if(found){remember([found]);return found;}
  }catch{}
  const pairs=await upstream(`${DX}/tokens/v1/solana/${mint}`,fresh?2000:10000);
  const mapped=await mapDex(pairs);const found=mapped.filter(c=>c.mint===mint).sort((a,b)=>b.liquidityUsd-a.liquidityUsd)[0];if(found){remember([found]);return found;}return null;
}
export async function marketSearch(q:string){
  if(!q.trim()) return [];
  if(validMint(q.trim())){const c=await marketCoin(q.trim());return c?[c]:[];}
  if(gmgnEnabled()){try{const cs=await gmgnSearch(q);if(cs.length)return remember(cs as MarketCoin[]);}catch{}}
  const j=await upstream(`${GT}/search/pools?query=${encodeURIComponent(q.slice(0,80))}&network=solana&include=base_token,quote_token,dex`,20000);
  return unique(remember(gecko(j))).slice(0,12);
}
export async function marketCandles(mint:string,tf:TTimeframe):Promise<TCandle[]>{
 if(gmgnEnabled()){try{const rows=await gmgnCandles(mint,tf);if(rows.length)return rows;}catch{}}
  const c=await marketCoin(mint);if(!c)return [];
  const periods:Record<string,[string,number]>={'1m':['minute',1],'5m':['minute',5],'15m':['minute',15],'1h':['hour',1],'4h':['hour',4],'1d':['day',1]};
  const [frame,aggregate]=periods[tf]??periods['5m'];
  const j=await upstream(`${GT}/networks/solana/pools/${c.pool}/ohlcv/${frame}?aggregate=${aggregate}&limit=300&currency=usd&token=${mint}`,20000);
  return (j.data?.attributes?.ohlcv_list??[]).map((r:number[])=>({time:r[0],open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5]})).filter((r:TCandle)=>[r.time,r.open,r.high,r.low,r.close,r.volume].every(Number.isFinite)).sort((a:TCandle,b:TCandle)=>a.time-b.time);
}
export async function marketTrades(mint:string):Promise<TTrade[]>{
 const live=recentStreamTrades(mint);if(live.length)return live;
 if((env as any).SOLANA_RPC_URL||process.env.SOLANA_RPC_URL){try{const {recentPumpTrades}=await import('./helius');const ts=await recentPumpTrades(mint);if(ts.length)return ts;}catch{}}
  const c=await marketCoin(mint);if(!c)return [];
  const j=await upstream(`${GT}/networks/solana/pools/${c.pool}/trades`,12000);
  const solUsd=c.priceUsd/c.priceSol;
  return (j.data??[]).map((x:any)=>{const a=x.attributes;return {id:x.id,mint,symbol:c.symbol,trader:a.tx_from_address||'Unknown',side:a.kind,sol:f(a.volume_in_usd)/solUsd,tokens:f(a.kind==='buy'?a.to_token_amount:a.from_token_amount),priceUsd:f(a.kind==='buy'?a.price_to_in_usd:a.price_from_in_usd),ts:Date.parse(a.block_timestamp)};}).filter((x:TTrade)=>x.side==='buy'||x.side==='sell');
}
export async function dexFallback(q:string):Promise<MarketCoin[]>{
 const j=await upstream(`${DX}/latest/dex/search?q=${encodeURIComponent(q)}`,20000);
 const pairs=(j.pairs??[]).filter((p:any)=>p.chainId==='solana'&&p.quoteToken?.address===SOL);
 return unique(remember(pairs.map((p:any)=>({mint:p.baseToken.address,symbol:p.baseToken.symbol,name:p.baseToken.name,imageUrl:cleanUrl(p.info?.imageUrl),priceUsd:f(p.priceUsd),priceSol:f(p.priceNative),mcapUsd:f(p.marketCap)||f(p.fdv),marketCapEstimated:!p.marketCap,vol24hUsd:f(p.volume?.h24),change24hPct:f(p.priceChange?.h24),liquidityUsd:f(p.liquidity?.usd),holders:NaN,ageSec:Math.max(0,(Date.now()-(p.pairCreatedAt||Date.now()))/1000),venue:'graduated',curvePct:100,athUsd:NaN,status:f(p.liquidity?.usd)>=1000?'tradeable':'untradeable',pool:p.pairAddress,dex:p.dexId,observedAt:j._asOf||Date.now(),riskBadges:[],decimals:9})))) as MarketCoin[];
}
export async function marketTicks(mints:string[]){
 if(!mints.length)return [];
 if(mints.length===1&&gmgnEnabled()){const c=await marketCoin(mints[0],true);return c?[{mint:c.mint,priceUsd:c.priceUsd,priceSol:c.priceSol,mcapUsd:c.mcapUsd,observedAt:c.observedAt}]:[];}
 const pairs=await upstream(`${DX}/tokens/v1/solana/${mints.slice(0,30).join(',')}`,10000);
 const best=new Map<string,any>();for(const p of pairs){if(!mints.includes(p.baseToken?.address)||!(f(p.priceUsd)>0))continue;const old=best.get(p.baseToken.address);if(!old||f(p.liquidity?.usd)>f(old.liquidity?.usd))best.set(p.baseToken.address,p);}
 const selected=[...best.values()];Object.defineProperty(selected,'_asOf',{value:(pairs as any)._asOf});
 return (await mapDex(selected)).map(c=>({mint:c.mint,priceUsd:c.priceUsd,priceSol:c.priceSol,mcapUsd:c.mcapUsd,change24hPct:c.change24hPct,observedAt:c.observedAt}));
}
export async function closingPriceSol(mint:string,cutoff:number){
 const token=await marketCoin(mint);if(!token)throw new Error('Closing pool unavailable');
 const solPools=await upstream(`${GT}/networks/solana/tokens/${SOL}/pools?include=base_token,quote_token,dex`,60000);
 const sp=(solPools.data??[]).find((p:any)=>p.relationships.base_token.data.id===`solana_${SOL}`);
 if(!sp)throw new Error('Historical SOL conversion unavailable');
 const end=Math.floor(cutoff/1000);
 const candle=async(pool:string,address:string)=>{const j=await upstream(`${GT}/networks/solana/pools/${pool}/ohlcv/minute?aggregate=1&limit=5&currency=usd&token=${address}&before_timestamp=${end}`,60000);const row=(j.data?.attributes?.ohlcv_list??[]).find((r:number[])=>r[0]<end&&r[0]>=end-180);if(!row||!(row[4]>0))throw new Error('Closing market observations unavailable');return row[4] as number;};
 const [usd,sol]=await Promise.all([candle(token.pool,mint),candle(sp.attributes.address,SOL)]);return usd/sol;
}
async function solUsdPrice(){const pairs=await upstream(`${DX}/token-pairs/v1/solana/${SOL}`,30000);const p=pairs.filter((x:any)=>x.baseToken.address===SOL&&f(x.priceUsd)>0).sort((a:any,b:any)=>f(b.liquidity?.usd)-f(a.liquidity?.usd))[0];if(!p)throw new Error('SOL conversion unavailable');return f(p.priceUsd);}
async function mapDex(pairs:any[]):Promise<MarketCoin[]>{
 const relevant=pairs.filter(p=>p.chainId==='solana'&&validMint(p.baseToken?.address)&&p.baseToken.address!==SOL&&f(p.priceUsd)>0);
 const usd=relevant.some(p=>p.quoteToken?.address!==SOL)?await solUsdPrice():0;
 return relevant.map(p=>({mint:p.baseToken.address,symbol:p.baseToken.symbol,name:p.baseToken.name,imageUrl:cleanUrl(p.info?.imageUrl),priceUsd:f(p.priceUsd),priceSol:p.quoteToken?.address===SOL?f(p.priceNative):f(p.priceUsd)/usd,mcapUsd:f(p.marketCap)||f(p.fdv),marketCapEstimated:!p.marketCap,vol24hUsd:f(p.volume?.h24),change24hPct:f(p.priceChange?.h24),change5mPct:f(p.priceChange?.m5),change1hPct:f(p.priceChange?.h1),liquidityUsd:f(p.liquidity?.usd),holders:NaN,ageSec:Math.max(0,(Date.now()-(p.pairCreatedAt||Date.now()))/1000),venue:'graduated' as const,curvePct:100,athUsd:NaN,status:f(p.liquidity?.usd)>=1000?'tradeable' as const:'untradeable' as const,pool:p.pairAddress,dex:p.dexId,observedAt:(pairs as any)._asOf||Date.now(),riskBadges:f(p.liquidity?.usd)<10000?['Low liquidity']:[],decimals:9,socials:{twitter:cleanUrl(p.info?.socials?.find((s:any)=>s.type==='twitter')?.url),telegram:cleanUrl(p.info?.socials?.find((s:any)=>s.type==='telegram')?.url),website:cleanUrl(p.info?.websites?.[0]?.url)}}));
}
async function dexFeed(col:TFeedColumn){
 const url=col==='new'?`${DX}/token-profiles/latest/v1`:`${DX}/token-boosts/top/v1`;
 const profiles=await upstream(url,60000);const mints=[...new Set(profiles.filter((p:any)=>p.chainId==='solana').map((p:any)=>p.tokenAddress))].slice(0,30);
 const raw=mints.length?await upstream(`${DX}/tokens/v1/solana/${mints.join(',')}`,15000):[];
 let cs=unique((await mapDex(raw)).sort((a,b)=>b.liquidityUsd-a.liquidityUsd));
 if(col==='graduating'){cs=cs.filter(c=>c.dex==='pumpswap');}
 cs.sort(col==='new'?(a,b)=>a.ageSec-b.ageSec:(a,b)=>b.vol24hUsd-a.vol24hUsd);
 return remember(cs);
}

export async function marketAnalytics(mint:string){const pairs=await upstream(`${DX}/tokens/v1/solana/${mint}`,10000);return normalizeDexAnalytics(pairs,mint,pairs._asOf);}
