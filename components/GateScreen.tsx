'use client';
import {useEffect,useState} from 'react';
import {usePaper} from '@/lib/store';
import {paperRequest} from '@/lib/api/market-client';
import {num} from '@/lib/format';
import {Wallet,ShieldCheck,ArrowRight,Copy} from 'lucide-react';
export function GateScreen({compact=false}:{compact?:boolean}){const p=usePaper();const [config,setConfig]=useState<any>(null),[copied,setCopied]=useState(false);useEffect(()=>{paperRequest('config').then(setConfig).catch(()=>{});},[]);return <section className="panel mx-auto max-w-[640px] p-6 md:p-8">
<div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-xl bg-accent/10 text-accent"><ShieldCheck size={24}/></span><span className="text-[13px] text-muted">Holder competition</span></div>
<h1 className="mt-5 text-[28px] font-semibold tracking-tight">{p.wallet&&p.passes?'You’re ready to trade.':'Hold 50,000 PAPER. Trade with an edge.'}</h1><p className="mt-3 text-[14px] leading-relaxed text-muted">Connect your Solana wallet and sign a message to verify ownership. Eligible holders receive 10 virtual SOL each 24-hour cycle. No transactions or spending permissions are requested.</p>
<div className="mt-6 border-y border-line py-4"><div className="flex justify-between text-[13px]"><span className="text-muted">Verified PAPER balance</span><span className="num">{p.wallet?num(p.paperHeld):'—'} / 50,000</span></div><div className="bar mt-3"><i style={{width:Math.min(100,p.paperHeld/500)+'%'}}/></div></div>
{config&&!config.mint?<p className="mt-4 text-[13px] text-[#ffc457]">The PAPER token is not configured yet. Holder competition and reward payouts are not active.</p>:config?.mint?<div className="mt-4 flex gap-2"><code className="min-w-0 flex-1 truncate text-[12px] text-muted">{config.mint}</code><button aria-label="Copy PAPER contract" onClick={()=>navigator.clipboard.writeText(config.mint).then(()=>setCopied(true))}><Copy size={14}/>{copied?'Copied':''}</button></div>:null}
<div className="mt-5 flex flex-wrap gap-2">{!p.wallet?<button className="btn btn-accent px-4 h-11" disabled={p.busy} onClick={p.connect}><Wallet size={16}/>{p.busy?'Connecting…':'Connect wallet'}</button>:<button className="btn btn-ghost px-4 h-11" disabled={p.busy} onClick={p.refreshHold}>Re-check balance</button>}{p.passes&&<a href="/" className="btn btn-ghost h-11 px-4">Open markets <ArrowRight size={15}/></a>}</div>
{p.error&&<p role="alert" className="mt-3 text-[13px] text-down">{p.error}</p>}
<div className="mt-6 border-t border-line pt-5"><h2 className="text-[15px] font-medium">Explore the real market first</h2><p className="mt-2 text-[13px] text-muted">Practice with 10 virtual SOL, live token prices and a server-saved portfolio. Practice accounts stay off the holder leaderboard and do not earn rewards.</p><button className="btn btn-ghost mt-4 h-10 px-4 text-[13px]" disabled={p.busy} onClick={p.startPractice}>{p.practice?'Practice account active':'Start practice'}</button></div>
</section>;}
