import {sharedHeliusStream} from './node-stream';
import {env} from '@/lib/server/runtime';
import {gmgnInfo} from './gmgn';
import {decodePumpLogs,encode58,PUMP,PUMP_AMM,type EventMarket} from '../pump-events';
import type {TTrade} from '../api/schema';
const cfg=(k:string)=>(env as any)[k]||process.env[k]||'';
const SOL='So11111111111111111111111111111111111111112';
const marketContexts=new Map<string,{at:number;value:EventMarket|null}>();
const contextRequests=new Map<string,Promise<EventMarket|null>>();
export async function streamMarket(mint:string):Promise<EventMarket|null>{
 const hit=marketContexts.get(mint);if(hit&&Date.now()-hit.at<60000)return hit.value;
 if(contextRequests.has(mint))return contextRequests.get(mint)!;
 const task=resolveStreamMarket(mint).then(value=>{marketContexts.set(mint,{at:Date.now(),value});if(marketContexts.size>100)marketContexts.delete(marketContexts.keys().next().value!);return value;}).finally(()=>contextRequests.delete(mint));contextRequests.set(mint,task);return task;
}
async function resolveStreamMarket(mint:string):Promise<EventMarket|null>{
 try{
 const j=await gmgnInfo(mint);const c=j.data,p=c.pool;
 if(!cfg('SOLANA_WS_URL')||!p||p.quote_address!==SOL)return null;
 const program=p.exchange==='pump_amm'?PUMP_AMM:p.exchange==='pump'?PUMP:null;if(!program)return null;
 const solUsd=Number(p.quote_reserve_value)/Number(p.quote_reserve);
 if(!(solUsd>0)||!Number.isInteger(c.decimals)||!p.pool_address)return null;
 return {mint,pool:p.pool_address,symbol:c.symbol,decimals:c.decimals,solUsd,program};
 }catch{
  // Public price fallback is usable only after checking the pool's actual program and mint accounts.
  const {marketCoin}=await import('./market');const c=await marketCoin(mint);if(!c?.pool||!(c.priceSol>0))return null;
  const r=await rpc('getMultipleAccounts',[[c.pool,mint],{encoding:'base64',commitment:'confirmed'}]);
  const [pool,token]=r?.value||[];if(pool?.owner!==PUMP_AMM||!token?.data?.[0])return null;
  const bytes=Uint8Array.from(atob(pool.data[0]),x=>x.charCodeAt(0)),tb=Uint8Array.from(atob(token.data[0]),x=>x.charCodeAt(0));
  if(bytes.length<107||tb.length<45||![241,154,109,4,17,177,109,188].every((v,i)=>bytes[i]===v)||encode58(bytes.slice(43,75))!==mint||encode58(bytes.slice(75,107))!==SOL)return null;
  return {mint,pool:c.pool,symbol:c.symbol,decimals:tb[44],solUsd:c.priceUsd/c.priceSol,program:PUMP_AMM};
 }
}

async function rpc(method:string,params:any[]){const url=cfg('SOLANA_RPC_URL');if(!url)throw new Error('On-chain feed unavailable');const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(7000)});const j:any=await r.json();if(!r.ok||j.error)throw new Error('On-chain provider is temporarily unavailable');return j.result;}
export async function recentPumpTrades(mint:string):Promise<TTrade[]>{
 const key='helius-tape:'+mint,saved=await env.DB?.prepare('SELECT data,expires FROM market_cache WHERE key=?').bind(key).first<any>();if(saved?.expires>Date.now())return JSON.parse(saved.data);
 const c=await streamMarket(mint);if(!c)return [];
 const sigs=await rpc('getSignaturesForAddress',[c.program===PUMP?mint:c.pool,{limit:6,commitment:'confirmed'}]);
 const trades:TTrade[]=[];
 // Bounded RPC work: 2 transactions at a time, at most 6, never an entire-chain scan.
 for(let i=0;i<sigs.length;i+=2){const group=await Promise.all(sigs.slice(i,i+2).filter((x:any)=>!x.err).map(async(x:any)=>{try{const tx=await rpc('getTransaction',[x.signature,{maxSupportedTransactionVersion:0,commitment:'confirmed'}]);return tx?.meta&&!tx.meta.err?decodePumpLogs(tx.meta.logMessages||[],x.signature,c):[];}catch{return [];}}));trades.push(...group.flat());}
 trades.sort((a,b)=>b.ts-a.ts);await env.DB?.prepare('INSERT INTO market_cache(key,data,fetched,expires) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched=excluded.fetched,expires=excluded.expires').bind(key,JSON.stringify(trades),Date.now(),Date.now()+20000).run();return trades;
}
export async function heliusStream(req:Request,mint:string){
 if(cfg('MARKET_GATEWAY_URL')){const u=new URL('/stream',cfg('MARKET_GATEWAY_URL'));u.searchParams.set('mint',mint);const r=await fetch(u,{headers:{Authorization:'Bearer '+cfg('MARKET_GATEWAY_TOKEN')},signal:req.signal});return new Response(r.body,{status:r.status,headers:{'Content-Type':r.headers.get('Content-Type')||'application/json','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'}});}
 const c=await streamMarket(mint);if(!c)return Response.json({error:'Instant tape supports SOL-quoted Pump.fun / PumpSwap pools. Other pools use market snapshots.'},{status:422});
 return sharedHeliusStream(req,c,cfg('SOLANA_WS_URL'));
}

/** Largest token accounts from RPC; this is not a total holder count or a full holder index. */
export async function rpcHolders(mint:string){
 const key='helius-holders:'+mint;const saved=await env.DB?.prepare('SELECT data,expires FROM market_cache WHERE key=?').bind(key).first<any>();if(saved?.expires>Date.now())return JSON.parse(saved.data);
 const [accounts,supply]=await Promise.all([rpc('getTokenLargestAccounts',[mint,{commitment:'confirmed'}]),rpc('getTokenSupply',[mint,{commitment:'confirmed'}])]);
 const total=Number(supply?.value?.amount);if(!(total>0))return [];
 const largest=accounts?.value||[];
 if(!largest.length)return [];
 const resolved=await rpc('getMultipleAccounts',[largest.map((a:any)=>a.address),{encoding:'jsonParsed',commitment:'confirmed'}]);
 const grouped=new Map<string,{owner:string;label:string;tokens:number;pct:number}>();
 largest.forEach((a:any,i:number)=>{const wallet=resolved?.value?.[i]?.data?.parsed?.info?.owner;const owner=wallet||a.address;const row=grouped.get(owner)||{owner,label:wallet?'RPC owner':'RPC token account',tokens:0,pct:0};row.tokens+=Number(a.amount)/10**a.decimals;row.pct+=Number(a.amount)/total*100;grouped.set(owner,row);});
 const rows=[...grouped.values()].sort((a,b)=>b.pct-a.pct);
 await env.DB?.prepare('INSERT INTO market_cache(key,data,fetched,expires) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched=excluded.fetched,expires=excluded.expires').bind(key,JSON.stringify(rows),Date.now(),Date.now()+60000).run();return rows;
}
