'use client';
import {useState} from 'react';
import Link from '@/components/SiteLink';
import {usePaper} from '@/lib/store';
import {num,short} from '@/lib/format';
import {Search,Wallet,ChevronDown,LogOut} from 'lucide-react';
import {Wordmark} from '../Wordmark';
export function TopBar({onSearch}:{onSearch():void}){const p=usePaper();const [menu,setMenu]=useState(false);return <>
<header className="topbar"><Link href="/" className="md:hidden" aria-label="paperhands home"><Wordmark compact/></Link><button onClick={onSearch} className="search-trigger"><Search size={16}/><span className="hidden sm:inline">Search Solana coins or paste a contract</span><span className="sm:hidden">Search</span><kbd>Ctrl K</kbd></button>
<div className="ml-auto flex items-center gap-2"><Link href="/portfolio" className="balance-pill"><Wallet size={14}/><span className="num">{num(p.balance,2)}</span><span className="hidden lg:inline text-muted">paper SOL</span></Link>
{p.token?<div className="relative"><button className="tool-button" aria-expanded={menu} onClick={()=>setMenu(x=>!x)}><span className="status-light"/>{p.practice?'Practice':short(p.wallet||'')}<ChevronDown size={13}/></button>{menu&&<div className="account-menu"><p>{p.practice?'Server-saved practice account':'Wallet verified by signature'}</p><Link href="/gate">Holder access</Link>{p.practice&&<button onClick={()=>{p.connect();setMenu(false);}}>Connect real wallet</button>}<button onClick={()=>{p.disconnect();setMenu(false);}}><LogOut size={13}/>Disconnect</button></div>}</div>:<><button className="tool-button hidden lg:flex" onClick={p.startPractice} disabled={p.busy}>Try paper trading</button><button className="btn btn-accent h-9 px-3 text-[13px]" onClick={p.connect} disabled={p.busy}>{p.busy?'Connecting…':'Connect wallet'}</button></>}
</div></header>{p.error&&<div className="px-4 py-2 text-[12px] border-b border-line text-[#ffc457]" role="alert">{p.error}</div>}</>;}
