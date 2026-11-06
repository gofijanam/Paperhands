'use client';
import {useEffect,useState} from 'react';
import {getApi,type TCoin,type TTrade} from '@/lib/api';
import {CoinView} from './CoinView';
export function CoinLoader({mint}:{mint:string}){
 const [coin,setCoin]=useState<TCoin|null>(null),[trades,setTrades]=useState<TTrade[]>([]),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let alive=true;setCoin(null);setError('');getApi().coin(mint).then(c=>{if(!c)throw new Error('No supported Solana pool found for this mint.');if(alive)setCoin(c);}).catch(e=>alive&&setError(e.message));return()=>{alive=false;};},[mint,retry]);
 if(error)return <div className="m-5 panel p-8"><h1 className="text-xl font-semibold">Market unavailable</h1><p className="my-3 text-muted">{error}</p><button className="btn btn-ghost px-4 py-2" onClick={()=>setRetry(x=>x+1)}>Try again</button><a href="/" className="ml-5 text-accent">Browse markets</a></div>;
 if(!coin)return <div className="grid gap-3 p-3 lg:grid-cols-[1fr_340px]" aria-busy="true"><div className="panel h-[70vh] animate-pulse"/><div className="panel h-96 animate-pulse"/></div>;
 return <CoinView key={coin.mint} initial={coin} trades={trades} holders={[]} source="api" tapeSource="geckoterminal"/>;
}
