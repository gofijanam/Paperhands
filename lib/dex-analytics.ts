export const WINDOWS = ['m5','h1','h6','h24'] as const;
export type MarketWindow = typeof WINDOWS[number];
export type WindowStats = {change:number|null;volume:number|null;buys:number|null;sells:number|null};
export type DexPool = {address:string;dex:string;base:string;quote:string;quoteAddress:string;priceUsd:number|null;liquidityUsd:number|null;baseReserve:number|null;quoteReserve:number|null;marketCap:number|null;fdv:number|null;createdAt:number|null;boosts:number|null;url:string;windows:Record<MarketWindow,WindowStats>;links:{label:string;url:string}[]};
export type DexAnalytics = {mint:string;observedAt:number;source:'DEX Screener';pools:DexPool[]};
const address=(v:unknown)=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const numeric=(v:unknown):number|null=>v===null||v===undefined||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))?null:Number(v);
const nonnegative=(v:unknown)=>{const n=numeric(v);return n!==null&&n>=0?n:null;};
const count=(v:unknown)=>{const n=nonnegative(v);return n!==null&&Number.isSafeInteger(n)?n:null;};
export function safePublicUrl(v:unknown){try{if(typeof v!=='string')return null;const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function normalizeDexAnalytics(raw:unknown,mint:string,observedAt:number):DexAnalytics{
 const seen=new Set<string>(),pools:DexPool[]=[];
 for(const p of Array.isArray(raw)?raw:[]){
  if(p?.chainId!=='solana'||p.baseToken?.address!==mint||!address(p.pairAddress)||seen.has(p.pairAddress))continue;seen.add(p.pairAddress);
  const windows=Object.fromEntries(WINDOWS.map(w=>[w,{change:numeric(p.priceChange?.[w]),volume:nonnegative(p.volume?.[w]),buys:count(p.txns?.[w]?.buys),sells:count(p.txns?.[w]?.sells)}])) as DexPool['windows'];
  const links:{label:string;url:string}[]=[];
  for(const link of [...(Array.isArray(p.info?.websites)?p.info.websites:[]),...(Array.isArray(p.info?.socials)?p.info.socials:[])]){const url=safePublicUrl(link.url);if(url&&!links.some(l=>l.url===url))links.push({label:String(link.label||link.type||link.platform||'Website').slice(0,40),url});}
  pools.push({address:p.pairAddress,dex:String(p.dexId||'Unknown'),base:String(p.baseToken.symbol||'Token'),quote:String(p.quoteToken?.symbol||'Unknown'),quoteAddress:String(p.quoteToken?.address||''),priceUsd:nonnegative(p.priceUsd),liquidityUsd:nonnegative(p.liquidity?.usd),baseReserve:nonnegative(p.liquidity?.base),quoteReserve:nonnegative(p.liquidity?.quote),marketCap:nonnegative(p.marketCap),fdv:nonnegative(p.fdv),createdAt:nonnegative(p.pairCreatedAt),boosts:count(p.boosts?.active),url:`https://dexscreener.com/solana/${p.pairAddress}`,windows,links});
 }
 return {mint,observedAt,source:'DEX Screener',pools:pools.sort((a,b)=>(b.liquidityUsd??-1)-(a.liquidityUsd??-1))};
}
export type WalletActivity={wallet:string;buys:number;sells:number;boughtSol:number;soldSol:number;lastAt:number};
export function recentWalletActivity(trades:ReadonlyArray<{id:string;trader:string;side:string;sol:number;ts:number}>){
 const seen=new Set<string>(),wallets=new Map<string,WalletActivity>();
 for(const t of trades){if(seen.has(t.id)||!address(t.trader)||!['buy','sell'].includes(t.side)||!Number.isFinite(t.sol)||t.sol<0)continue;seen.add(t.id);const w=wallets.get(t.trader)||{wallet:t.trader,buys:0,sells:0,boughtSol:0,soldSol:0,lastAt:0};if(t.side==='buy'){w.buys++;w.boughtSol+=t.sol;}else{w.sells++;w.soldSol+=t.sol;}w.lastAt=Math.max(w.lastAt,t.ts);wallets.set(t.trader,w);}
 return [...wallets.values()].sort((a,b)=>(b.boughtSol+b.soldSol)-(a.boughtSol+a.soldSol));
}
