'use client';
import {useEffect,useState} from 'react';
import {marketRequest} from '@/lib/api/market-client';
import {WINDOWS,type DexAnalytics,type MarketWindow} from '@/lib/dex-analytics';
import {age,compact,pct,price,short,usd} from '@/lib/format';
import {useNow} from '@/lib/live';
const label={m5:'5m',h1:'1h',h6:'6h',h24:'24h'};
const amount=(v:number|null|undefined,format:(v:number)=>string=compact)=>v==null?'—':format(v);
export function useMarketDetails(mint:string){
 const [state,setState]=useState<{data:DexAnalytics|null;error:string;busy:boolean}>({data:null,error:'',busy:true});
 useEffect(()=>{let active=true,busy=false;setState({data:null,error:'',busy:true});
 const load=async()=>{if(busy||document.hidden)return;busy=true;try{const data=await marketRequest('analytics',{mint}) as DexAnalytics;if(active)setState({data,error:'',busy:false});}catch{if(active)setState(s=>({...s,error:'Pool statistics are temporarily unavailable.',busy:false}));}finally{busy=false;}};
 void load();const id=setInterval(load,10000);document.addEventListener('visibilitychange',load);return()=>{active=false;clearInterval(id);document.removeEventListener('visibilitychange',load);};},[mint]);
 return state;
}
type Props=ReturnType<typeof useMarketDetails>;
export function MarketActivity({data,error,busy}:Props){
 const [window,setWindow]=useState<MarketWindow>('h24'),now=useNow(5000),pool=data?.pools[0],stats=pool?.windows[window];
 const total=stats?.buys!=null&&stats.sells!=null?stats.buys+stats.sells:null;
 const share=total&&stats?.buys!=null?stats.buys/total*100:null;
 const elapsed=data&&now?Math.max(0,Math.floor((now-data.observedAt)/1000)):null;
 return <section aria-label="Market activity" className="panel p-3">
  <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-[14px] font-semibold">Market activity</h2><span className="text-[11px] text-muted">DEX Screener</span></div>
  <div className="grid grid-cols-4 gap-1" role="group" aria-label="Activity period">{WINDOWS.map(w=><button key={w} aria-pressed={window===w} onClick={()=>setWindow(w)} className="chip min-h-11 cursor-pointer px-1 text-center"><span className="block text-[12px]">{label[w]}</span><span className={`num block text-[11px] ${pool?.windows[w].change==null?'text-muted':pool.windows[w].change!>=0?'text-up':'text-down'}`}>{amount(pool?.windows[w].change,pct)}</span></button>)}</div>
  {!pool?<p className="py-5 text-[12px] text-muted" role="status">{busy?'Loading pool statistics…':error||'No DEX pool statistics returned for this token.'}</p>:<>
   <dl className="num grid grid-cols-2 gap-x-4 gap-y-3 py-4 text-[13px]"><Metric title={`${label[window]} volume`}>{amount(stats?.volume,usd)}</Metric><Metric title="Transactions">{amount(total)}</Metric><Metric title="Buys"><span className="text-up">{amount(stats?.buys)}</span></Metric><Metric title="Sells"><span className="text-down">{amount(stats?.sells)}</span></Metric></dl>
   {share!==null&&<><div className="flex h-1.5 overflow-hidden rounded bg-down" role="img" aria-label={`${share.toFixed(1)} percent buy transactions`}><span className="bg-up" style={{width:`${share}%`}}/></div><div className="mt-1.5 flex justify-between text-[11px] text-muted"><span>{share.toFixed(1)}% buys</span><span>{(100-share).toFixed(1)}% sells</span></div></>}
   <div className="mt-3 border-t border-line pt-3 text-[12px]"><div className="flex justify-between gap-2"><span className="text-muted">Most liquid pool</span><a href={pool.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{pool.dex} · {pool.quote}</a></div><dl className="num mt-3 grid grid-cols-2 gap-3"><Metric title="Liquidity">{amount(pool.liquidityUsd,usd)}</Metric><Metric title="FDV">{amount(pool.fdv,usd)}</Metric><Metric title="Market cap">{amount(pool.marketCap,usd)}</Metric><Metric title="Active boosts">{amount(pool.boosts)}</Metric></dl></div>
   <p className="mt-3 text-[11px] leading-relaxed text-muted">Counts are transactions, not unique wallets. Boosts are paid promotion.</p>
  </>}
  {data&&<p className={`mt-2 text-[11px] ${error||(elapsed??0)>30?'text-down':'text-muted'}`} role="status">{error?`${error} Showing last observation.`:elapsed!==null?`Snapshot ${elapsed}s ago${elapsed>30?' · delayed':''}`:'Market snapshot'}</p>}
 </section>;
}
function Metric({title,children}:{title:string;children:React.ReactNode}){return <div><dt className="mb-1 font-sans text-[11px] text-muted">{title}</dt><dd>{children}</dd></div>;}
export function PoolMarkets({data,error,busy}:Props){
 const now=useNow(30000);
 if(!data?.pools.length)return <p className="p-5 text-[13px] text-muted" role="status">{busy?'Loading token pools…':error||'No tracked pools found.'}</p>;
 return <><p className="px-3 py-2 text-[12px] text-muted">{data.pools.length} tracked pools · sorted by liquidity · DEX Screener</p><div className="overflow-x-auto"><table className="num w-full text-[12px]"><thead className="text-left text-muted"><tr><th className="px-3 py-2 font-normal">Pool</th><th className="px-3 text-right font-normal">Price</th><th className="px-3 text-right font-normal">Liquidity</th><th className="px-3 text-right font-normal">24h volume</th><th className="px-3 text-right font-normal">Age</th></tr></thead><tbody>{data.pools.map(p=><tr key={p.address} className="row border-t border-line/60"><td className="px-3 py-3"><a href={p.url} target="_blank" rel="noreferrer" className="block whitespace-nowrap text-accent hover:underline">{p.dex} · {p.base}/{p.quote}</a><span className="text-[11px] text-muted">{short(p.address)}</span></td><td className="whitespace-nowrap px-3 text-right">{amount(p.priceUsd,price)}</td><td className="px-3 text-right">{amount(p.liquidityUsd,usd)}</td><td className="px-3 text-right">{amount(p.windows.h24.volume,usd)}</td><td className="whitespace-nowrap px-3 text-right text-muted">{p.createdAt&&now?age(Math.max(0,(now-p.createdAt)/1000)):'—'}</td></tr>)}</tbody></table></div>{error&&<p className="p-3 text-[12px] text-down">{error} Showing the last snapshot.</p>}</>;
}
