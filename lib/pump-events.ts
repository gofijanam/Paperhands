import type {TTrade} from './api/schema';
export const PUMP_AMM='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const PUMP='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const BUY=[103,244,82,31,44,245,119,119],SELL=[62,47,55,10,165,3,220,42],CURVE=[189,219,127,211,78,230,97,238];
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function encode58(bytes:Uint8Array){let n=0n;for(const b of bytes)n=n*256n+BigInt(b);let s='';while(n){s=alphabet[Number(n%58n)]+s;n/=58n;}for(const b of bytes){if(b)break;s='1'+s;}return s;}
export type EventMarket={mint:string;pool:string;symbol:string;decimals:number;solUsd:number;program:string};
/** Verified program logs only. Prefix layouts from pump-fun/pump-public-docs IDLs (2026-11-06).
 * Execution price = actual event quote amount / tokens; no reserve/virtual-reserve approximation.
 */
export function decodePumpLogs(logs:string[],signature:string,c:EventMarket):TTrade[]{
 const stack:string[]=[],trades:TTrade[]=[];let eventIndex=0;
 for(const line of logs){
  const invoke=line.match(/^Program (\w+) invoke \[(\d+)\]/);if(invoke){stack.length=Number(invoke[2])-1;stack.push(invoke[1]);continue;}
  if(/^Program \w+ (success|failed)/.test(line)){stack.pop();continue;}
  if(!line.startsWith('Program data: ')||stack.at(-1)!==c.program)continue;
  try{
   const b=Uint8Array.from(atob(line.slice(14)),s=>s.charCodeAt(0)),v=new DataView(b.buffer);
   const match=(d:number[])=>d.every((x,i)=>x===b[i]);const n=(i:number)=>Number(v.getBigUint64(i,true));
   let buy=false,tokens=0,sol=0,user='',ts=0;
   if(c.program===PUMP_AMM&&(match(BUY)||match(SELL))){if(b.length<184)continue;buy=match(BUY);if(encode58(b.slice(120,152))!==c.pool)continue;tokens=n(16)/10**c.decimals;sol=n(64)/1e9;user=encode58(b.slice(152,184));ts=n(8)*1000;}
   else if(c.program===PUMP&&match(CURVE)){if(b.length<129||encode58(b.slice(8,40))!==c.mint)continue;sol=n(40)/1e9;tokens=n(48)/10**c.decimals;buy=b[56]===1;user=encode58(b.slice(57,89));ts=n(89)*1000;}
   else continue;
   if(!(tokens>0&&sol>0&&ts>0&&c.solUsd>0))continue;
   trades.push({id:`${signature}:${eventIndex++}`,mint:c.mint,symbol:c.symbol,trader:user,side:buy?'buy':'sell',sol,tokens,priceUsd:sol/tokens*c.solUsd,ts});
  }catch{/* Unknown/truncated events are skipped, never guessed. */}
 }
 return trades;
}
