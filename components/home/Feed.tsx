'use client';
import {useEffect,useMemo,useState} from 'react';
import {getApi,type TCoin,type TFeedColumn} from '@/lib/api';
import {useLiveCoins,useNow} from '@/lib/live';
import {useWatchlist} from '@/lib/watchlist';
import {CoinRow} from './CoinRow';
import {LeaderColumn} from './LeaderColumn';
import {Activity,Search,SlidersHorizontal,Star,Pause,Play,RefreshCw,ArrowUpRight} from 'lucide-react';
const cols=[{id:'trending',title:'Trending',hint:'Volume · tracked Solana pairs'},{id:'new',title:'New pairs',hint:'New launches · GMGN'},{id:'graduating',title:'Migrated',hint:'Completed launchpad pairs'},{id:'leaders',title:'Leaderboard',hint:'Verified wallets'}] as const;
function MarketList({data,filter,sort,watchOnly,paused}:{data:TCoin[];filter:number;sort:string;watchOnly:boolean;paused:boolean}){
 const coins=data;const watch=useWatchlist();const [held,setHeld]=useState<TCoin[]>(data);
 useEffect(()=>{if(!paused)setHeld(coins);},[coins,paused]);
 const rows=useMemo(()=>held.filter(c=>c.liquidityUsd>=filter&&(!watchOnly||watch.list.includes(c.mint))).sort((a,b)=>sort==='volume'?b.vol24hUsd-a.vol24hUsd:sort==='gainers'?b.change24hPct-a.change24hPct:sort==='newest'?a.ageSec-b.ageSec:0),[held,filter,sort,watchOnly,watch.list]);
 return <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto" aria-live="off">{rows.map(c=><CoinRow key={c.mint} c={c} />)}{!rows.length&&<li className="p-8 text-center text-[13px] text-muted">{watchOnly?'Star coins to build your watchlist.':'No pairs match these filters.'}</li>}</ul>;
}
export function Feed(){
 const now=useNow(1000);
 const [data,setData]=useState<Record<TFeedColumn,TCoin[]>>({trending:[],new:[],graduating:[]}),[errors,setErrors]=useState<Record<string,string>>({}),[loading,setLoading]=useState(true),[updated,setUpdated]=useState(0),[paused,setPaused]=useState(false),[filter,setFilter]=useState(0),[sort,setSort]=useState('default'),[watchOnly,setWatchOnly]=useState(false),[tab,setTab]=useState('trending'),[settings,setSettings]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{let alive=true,busy=false;const load=async()=>{if(busy||paused||document.hidden)return;busy=true;const result=await Promise.allSettled((['trending','new','graduating'] as const).map(c=>getApi().feed(c)));if(alive){const names=['trending','new','graduating'];result.forEach((r,i)=>{const k=names[i];if(r.status==='fulfilled'){setData(d=>({...d,[k]:r.value}));setErrors(e=>({...e,[k]:''}));setUpdated(u=>Math.max(u,...r.value.map(c=>c.observedAt||0)));}else setErrors(e=>({...e,[k]:r.reason?.message||'Market data unavailable'}));});setLoading(false);}busy=false;};void load();const id=setInterval(load,5000);return()=>{alive=false;clearInterval(id);};},[paused,retry]);
 const stale=updated>0&&(now??updated)-updated>45000;
 return <div className="market-screen">
 <div className="market-toolbar"><div className="flex items-center gap-3"><h1 className="text-[20px] font-semibold tracking-tight">Markets</h1><span className="network-tag"><Activity size={12}/>Solana</span><span className="hidden text-[12px] text-muted xl:inline">Real markets. Paper money.</span></div>
 <div className="flex items-center gap-2"><button className={`tool-button ${watchOnly?'active':''}`} aria-pressed={watchOnly} onClick={()=>setWatchOnly(x=>!x)}><Star size={14}/>Watchlist</button><button className={`tool-button ${settings?'active':''}`} aria-expanded={settings} onClick={()=>setSettings(x=>!x)}><SlidersHorizontal size={14}/>Filters</button><button className="icon-button" onClick={()=>setPaused(x=>!x)} aria-label={paused?'Resume feed':'Pause feed'} title={paused?'Resume feed':'Pause feed'}>{paused?<Play size={15}/>:<Pause size={15}/>}</button><button className="icon-button" onClick={()=>setRetry(x=>x+1)} aria-label="Refresh markets"><RefreshCw size={15}/></button></div></div>
 {settings&&<div className="filter-bar"><label>Minimum liquidity <select value={filter} onChange={e=>setFilter(+e.target.value)}><option value={0}>Any</option><option value={10000}>$10,000</option><option value={50000}>$50,000</option><option value={100000}>$100,000</option></select></label><label>Sort by <select value={sort} onChange={e=>setSort(e.target.value)}><option value="default">Provider ranking</option><option value="volume">24h volume</option><option value="gainers">24h gain</option><option value="newest">Newest</option></select></label><button className="text-[12px] text-accent" onClick={()=>{setFilter(0);setSort('default');setWatchOnly(false);}}>Reset filters</button></div>}
 <div className="feed-mobile-tabs" role="tablist" aria-label="Market views">{cols.map(c=><button role="tab" aria-selected={tab===c.id} className="chip" key={c.id} onClick={()=>setTab(c.id)}>{c.title}</button>)}</div>
 <div className="market-grid">{cols.map((c,i)=><section key={c.id} className={`market-column ${tab===c.id?'selected':''}`} aria-label={c.title}>
 <header className="column-heading"><div><h2>{c.title}{c.id!=='leaders'&&<span className="count">{data[c.id].length}</span>}</h2><p>{c.hint}</p></div>{c.id==='leaders'?<a href="/leaderboard" className="icon-button" aria-label="Full leaderboard"><ArrowUpRight size={16}/></a>:<span className={`status-light ${errors[c.id]?'offline':''}`} title={errors[c.id]?'Feed unavailable':paused?'Paused':'Real market data'}/>}</header>
 {c.id==='leaders'?<LeaderColumn/>:loading?<div className="space-y-2 p-3" aria-busy="true">{Array.from({length:8},(_,i)=><div key={i} className="h-20 animate-pulse rounded bg-panel-2"/>)}</div>:<>{errors[c.id]&&<div role="status" className="market-error">{errors[c.id]}{data[c.id].length>0?' Last received values shown.':''}<button onClick={()=>setRetry(x=>x+1)}>Retry</button></div>}<MarketList data={data[c.id]} filter={filter} sort={sort} watchOnly={watchOnly} paused={paused}/></>}
 </section>)}</div>
 <footer className="terminal-status"><span className="flex items-center gap-2"><span className={`status-light ${Object.values(errors).some(Boolean)?'offline':''}`}/>{paused?'Feed paused':Object.values(errors).some(Boolean)?'Some feeds unavailable':stale?'Last received market data':'Real market feed'}</span><span>Discovery 5s · token pages stream trades{updated?` · Updated ${new Date(updated).toLocaleTimeString()}`:''}</span><span className="hidden sm:inline">Virtual SOL · no wallet transactions</span></footer>
 </div>;
}
