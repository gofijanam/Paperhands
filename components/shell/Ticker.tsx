'use client';
import {useEffect,useState} from 'react';
import {getApi,type TCoin} from '@/lib/api';
import {pct,price} from '@/lib/format';
import Link from '@/components/SiteLink';
export function Ticker(){const [rows,setRows]=useState<TCoin[]>([]),[error,setError]=useState(false);useEffect(()=>{let on=true;const load=()=>getApi().feed('trending').then(r=>{if(on){setRows(r.slice(0,12));setError(false);}}).catch(()=>on&&setError(true));void load();const id=setInterval(()=>{if(!document.hidden)void load();},30000);return()=>{on=false;clearInterval(id);};},[]);return <section className="market-ticker scroll-thin" aria-label="Solana market prices"><span className="ticker-label">{error?'Feed unavailable':'Trending'}</span>{rows.map(c=><Link href={`/coin/${c.mint}`} className="ticker-coin" key={c.mint}><b>{c.symbol}</b><span className="num text-muted">{price(c.priceUsd)}</span><span className={`num ${c.change24hPct>=0?'text-up':'text-down'}`}>{pct(c.change24hPct,1)}</span></Link>)}</section>;}
