'use client';
import Link from '@/components/SiteLink';
import {useEffect,useMemo,useState} from 'react';
import type {TCoin} from '@/lib/api';
import {marketRequest} from '@/lib/api/market-client';
import {useLiveCoins,useNow} from '@/lib/live';
import {usePaper} from '@/lib/store';
import {compact,pct,sol,usd} from '@/lib/format';
import {positionMark} from '@/lib/portfolio-values';
import {CoinAvatar} from '@/components/CoinAvatar';
import {EquityChart} from '@/components/EquityChart';
import {GateScreen} from '@/components/GateScreen';
import {MarkBadge} from '@/components/MarkBadge';

function usePortfolioMarkets(mints:string[]){
 const key=[...new Set(mints)].sort().join(','),[coins,setCoins]=useState<TCoin[]>([]),[fx,setFx]=useState<{priceUsd:number;observedAt:number}|null>(null);
 useEffect(()=>{let active=true,busy=false;setCoins([]);const load=async()=>{if(busy||document.hidden)return;busy=true;
  const list=key.split(',').filter(Boolean),batches=[];for(let i=0;i<list.length;i+=30)batches.push(list.slice(i,i+30));
  const [price,metadata]=await Promise.allSettled([marketRequest('sol-price'),Promise.all(batches.map(ms=>marketRequest('metadata',{mints:ms.join(',')})))]);
  if(active){if(price.status==='fulfilled'&&price.value?.priceUsd>0)setFx(price.value);if(metadata.status==='fulfilled')setCoins(metadata.value.flat());}busy=false;
 };void load();const timer=setInterval(load,30000);return()=>{active=false;clearInterval(timer);};},[key]);
 return {coins:useLiveCoins(coins).coins,fx};
}
export default function PortfolioPage(){
 const p=usePaper(),now=useNow(10000)??Date.now();
 const {coins,fx}=usePortfolioMarkets([...p.positions.map(x=>x.mint),...p.fills.slice(0,100).map(x=>x.mint)]);
 const by=useMemo(()=>new Map(coins.map(c=>[c.mint,c])),[coins]);
 const rows=p.positions.map(x=>{const c=by.get(x.mint),mark=positionMark(x,c,now);return {...x,c,value:mark.value,markStatus:mark.status,pnl:mark.value===null?null:mark.value-x.costSol};});
 const missing=rows.some(r=>r.value===null),estimated=rows.some(r=>r.markStatus!=='fresh');
 const open=rows.reduce((sum,r)=>sum+(r.value??0),0),equity=missing?NaN:p.balance+open,pnl=equity-p.bankroll;
 const realized=p.fills.reduce((sum,f)=>sum+(f.pnlSol??0),0),rate=fx&&now-fx.observedAt<120000?fx.priceUsd:null;
 const dollars=(value:number)=>rate&&Number.isFinite(value)?usd(value*rate,false):'—';
 const first=p.equity[0]?.t??p.fills.at(-1)?.ts??now;
 const curve=[{t:Math.min(first,p.fills.at(-1)?.ts??first)-1000,v:p.bankroll},...p.equity,...(Number.isFinite(equity)?[{t:now,v:equity}]:[])];
 if(!p.ready)return <div className="p-4"><div className="panel h-[60vh] animate-pulse" aria-busy="true"/></div>;
 if(!p.passes)return <div className="px-3 py-8 md:py-14"><GateScreen compact/></div>;
 return <div className="portfolio-page mx-auto max-w-[1400px] space-y-4 p-3 md:p-5">
  <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-[26px] font-semibold tracking-[-0.03em]">Portfolio</h1><p className="mt-1 text-[13px] text-muted">{p.practice?'Practice account':'Holder account'} · current UTC cycle · virtual funds</p></div><div className="text-right text-xs text-muted">{rate?<><span className="num text-soft">1 SOL = {usd(rate,false)}</span><span className="block mt-1">USD equivalents use the current rate</span></>:<span>USD conversion temporarily unavailable</span>}</div></header>
  <section aria-label="Account" className="portfolio-stats panel">
   {[{label:'Equity',value:equity,note:missing?'Some positions could not be valued':estimated?'Includes last known prices':'Cash + open positions'},{label:'Cash',value:p.balance,note:'Available to paper trade'},{label:'Cycle PnL',value:pnl,note:Number.isFinite(pnl)?pct(pnl/p.bankroll*100)+' return':'Awaiting position prices',tone:pnl>=0?'text-up':'text-down'},{label:'Realized PnL',value:realized,note:'From closed paper trades',tone:realized>=0?'text-up':'text-down'}].map(s=><div className="portfolio-stat" key={s.label}><h2>{s.label}</h2><p className={`num portfolio-stat-value ${s.tone??''}`}>{sol(s.value,4)}</p><p className={`num portfolio-stat-usd ${s.tone??'text-soft'}`}>{dollars(s.value)} <span className="text-muted text-xs">USD</span></p><p className="mt-2 text-xs text-muted">{s.note}</p></div>)}
  </section>
  {missing&&<p role="status" className="text-sm text-muted">One or more position prices are unavailable. Equity stays unknown until they recover; missing prices are never counted as zero.</p>}
  <EquityChart points={curve} base={p.bankroll} solUsd={rate} estimated={estimated}/>
  <section aria-label="Open positions" className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">Open positions <span className="num ml-2 text-muted">{rows.length}</span></h2><span className="text-xs text-muted">{rows.length&&!missing?`${sol(open,4)} · ${dollars(open)}`:'Real market prices'}</span></div>
   {rows.length===0?<p className="p-5 text-sm text-muted">No open positions. <Link href="/" className="text-accent hover:underline">Find a coin</Link> and place a paper trade.</p>:<div className="overflow-x-auto"><table className="portfolio-table"><thead><tr><th>Token</th><th>Position</th><th>Cost</th><th>Value</th><th>Unrealized PnL</th></tr></thead><tbody>{rows.map(r=><tr key={r.mint}><td><Link href={`/coin/${r.mint}`} className="flex items-center gap-3"><CoinAvatar mint={r.mint} imageUrl={r.c?.imageUrl} label={`${r.symbol} logo`} size={36}/><span><b className="block text-sm">${r.symbol}</b><span className="block max-w-44 truncate text-xs text-muted">{r.c?.name??r.mint.slice(0,6)+'…'+r.mint.slice(-4)}</span></span></Link></td><td className="num">{compact(r.tokens)}<span className="block text-xs text-muted">tokens</span></td><td className="num">{sol(r.costSol,4)}<span className="block text-xs text-muted">{dollars(r.costSol)}</span></td><td className="num">{sol(r.value??NaN,4)}<span className="block text-xs text-muted">{dollars(r.value??NaN)}</span><MarkBadge status={r.markStatus} asOf={r.markAsOf}/></td><td className={`num ${(r.pnl??0)>=0?'text-up':'text-down'}`}>{sol(r.pnl??NaN,4)}<span className="block text-xs">{r.pnl===null?'—':pct(r.pnl/r.costSol*100)} · {dollars(r.pnl??NaN)}</span></td></tr>)}</tbody></table></div>}
  </section>
  <section aria-label="Trade history" className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">Trade history <span className="num ml-2 text-muted">{p.fills.length}</span></h2><span className="text-xs text-muted">Simulated fills</span></div>
   {!p.fills.length?<p className="p-5 text-sm text-muted">Your completed paper trades will appear here.</p>:<div className="scroll-thin max-h-[420px] overflow-auto" tabIndex={0} role="region" aria-label="Fills"><table className="portfolio-table"><thead><tr><th>Token</th><th>Side</th><th>Amount</th><th>Realized PnL</th><th>Fee</th><th>Time</th></tr></thead><tbody>{p.fills.map(f=><tr key={f.id}><td><Link href={`/coin/${f.mint}`} className="flex items-center gap-2"><CoinAvatar mint={f.mint} imageUrl={by.get(f.mint)?.imageUrl} label={`${f.symbol} logo`} size={28}/><b>${f.symbol}</b></Link></td><td className={f.side==='buy'?'text-up':'text-down'}>{f.side==='buy'?'Buy':'Sell'}</td><td className="num">{sol(f.sol,4)}<span className="block text-xs text-muted">{dollars(f.sol)}</span></td><td className={`num ${(f.pnlSol??0)>=0?'text-up':'text-down'}`}>{f.pnlSol==null?'—':sol(f.pnlSol,4)}</td><td className="num text-muted">{sol(f.feeSol,5)}</td><td className="num text-muted">{new Date(f.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</td></tr>)}</tbody></table></div>}
  </section>
  {p.practice&&<button onClick={p.reset} disabled={p.busy} className="btn btn-ghost h-10 px-4 text-[13px]">Reset practice account</button>}
 </div>;
}
