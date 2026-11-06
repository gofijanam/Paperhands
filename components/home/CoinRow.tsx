'use client';
import Link from '@/components/SiteLink';
import type {TCoin} from '@/lib/api';
import {age,pct,usd} from '@/lib/format';
import {CoinAvatar} from '../CoinAvatar';
import {Flash} from '../Flash';
import {Star,ArrowUpRight} from 'lucide-react';
import {useWatchlist} from '@/lib/watchlist';
export function CoinRow({c}:{c:TCoin}){const watch=useWatchlist();const starred=watch.list.includes(c.mint);return <li className="market-row">
 <button className={`watch-button ${starred?'starred':''}`} aria-pressed={starred} aria-label={`${starred?'Remove':'Add'} ${c.symbol} ${starred?'from':'to'} watchlist`} onClick={()=>watch.toggle(c.mint)}><Star size={12} fill={starred?'currentColor':'none'}/></button>
 <Link href={`/coin/${c.mint}`} className="market-row-main"><CoinAvatar mint={c.mint} imageUrl={c.imageUrl} size={40}/><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="truncate font-semibold text-[14px]">{c.symbol}</span><Flash value={c.change24hPct} className={`num text-[12px] ${c.change24hPct>=0?'text-up':'text-down'}`}>{pct(c.change24hPct,1)}</Flash></div><div className="mt-0.5 flex justify-between gap-2 text-[11px] text-muted"><span className="truncate">{c.name}</span><span className="num shrink-0">{age(c.ageSec)}</span></div><div className="row-metrics"><span>MC <Flash value={c.mcapUsd} className="num text-soft">{usd(c.mcapUsd)}</Flash></span><span>Vol <b>{usd(c.vol24hUsd)}</b></span><span>Liq <b className={c.liquidityUsd<10000?'text-[#ffc457]':''}>{usd(c.liquidityUsd)}</b></span></div></div></Link>
 <Link href={`/coin/${c.mint}`} aria-label={`Open ${c.symbol} trading terminal`} className="row-open"><ArrowUpRight size={14}/></Link>
 </li>;}
