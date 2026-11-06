'use client';
import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {paperRequest} from './api/market-client';
export type MarkStatus='fresh'|'stale'|'rugged'|'unknown';
export type Position={mint:string;symbol:string;tokens:number;costSol:number;openedAt:number;valueSol?:number;markStatus?:MarkStatus;markAsOf?:number|null};
export type Fill={id:string;mint:string;symbol:string;side:'buy'|'sell';sol:number;tokens:number;priceSol:number;feeSol:number;pnlSol?:number|null;ts:number};
export type TradeInput={mint:string;symbol:string;side:'buy'|'sell';sol?:number;fraction?:number;priceSol:number;venue:string;impactPct:number;quoteId?:string;intentKey?:string};
type State={cycle?:number;version?:number;accountId?:string;wallet:string|null;practice:boolean;paperHeld:number;minHold:number;demoPass:boolean;balance:number;bankroll:number;positions:Position[];fills:Fill[];equity:{t:number;v:number}[];token:string|null;source:'live'|'local';passes:boolean;gateConfigured:boolean};
const initial:State={wallet:null,practice:false,paperHeld:0,minHold:50000,demoPass:false,balance:10,bankroll:10,positions:[],fills:[],equity:[],token:null,source:'live',passes:false,gateConfigured:false};
type Ctx=State&{ready:boolean;busy:boolean;error:string|null;connect():Promise<void>;startPractice():Promise<void>;disconnect():void;setDemoPass(v:boolean):void;trade(t:TradeInput):Promise<Fill|string>;refreshHold():Promise<void>;reset():void;};
const C=createContext<Ctx|null>(null);const KEY='paperhands.session.v1';
export const feeBps=(_venue:string)=>30;
export function PaperProvider({children}:{children:React.ReactNode}){
 const [s,setS]=useState(initial),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);const ref=useRef(s),tradeLock=useRef(false),generation=useRef(0);ref.current=s;
 const commit=(j:any,token=ref.current.token)=>{if(token===ref.current.token&&j.accountId===ref.current.accountId&&(j.version??-1)<(ref.current.version??-1))return;const next={...initial,...j,token};ref.current=next;setS(next);if(token)localStorage.setItem(KEY,token);};
 const sync=async(token=ref.current.token)=>{const g=generation.current;if(token){const j=await paperRequest('account',token);if(g===generation.current)commit(j,token);}};
 useEffect(()=>{const token=localStorage.getItem(KEY);if(token)sync(token).catch(e=>{setError(e.message);if(e.status===401)localStorage.removeItem(KEY);}).finally(()=>setReady(true));else setReady(true);},[]);
 useEffect(()=>{if(!s.token)return;const id=setInterval(()=>{if(!document.hidden)sync().catch(e=>setError(e.message));},30000);return()=>clearInterval(id);},[s.token]);
 // Preserve the server token returned on session creation.
 const begin=async()=>{generation.current++;setBusy(true);setError(null);try{const j=await paperRequest('practice',null,{});commit(j,j.token);}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 const connect=async()=>{
 generation.current++;setBusy(true);setError(null);try{
 const w=window as any;const provider=w.phantom?.solana??w.solflare??w.solana;
 if(!provider?.connect||!provider?.signMessage)throw new Error('Open this site in Phantom or Solflare, or install their wallet extension. You can also start practice.');
 const connected=await provider.connect();const wallet=connected.publicKey?.toString()??provider.publicKey?.toString();
 const nonce=await paperRequest('nonce',null,{wallet});const signed=await provider.signMessage(new TextEncoder().encode(nonce.message),'utf8');
 const bytes=signed.signature??signed;const signature=btoa(String.fromCharCode(...new Uint8Array(bytes)));
 const j=await paperRequest('verify',null,{id:nonce.id,signature});commit(j,j.token);
 }catch(e:any){setError(e.code===4001?'Sign-in cancelled. Your wallet was not changed.':e.message);}finally{setBusy(false);}};
 const disconnect=()=>{generation.current++;if(s.token)paperRequest('logout',s.token,{}).catch(()=>{});localStorage.removeItem(KEY);setS(initial);ref.current=initial;setError(null);};
 return <C.Provider value={{...s,ready,busy,error,connect,startPractice:begin,disconnect,setDemoPass:()=>{},
 async trade(t){if(!ref.current.token||!t.quoteId)return 'Request a server quote first.';if(tradeLock.current)return 'An order is already processing.';tradeLock.current=true;setBusy(true);setError(null);const token=ref.current.token,g=generation.current;try{
 const send=()=>paperRequest('trade',token,{quoteId:t.quoteId},t.intentKey??t.quoteId);
 let j;try{j=await send();}catch(e:any){if(e.status)throw e;j=await send();} // Same intent after a transport timeout: server deduplicates.
 if(g===generation.current&&ref.current.token===token){if(j.account)commit({...ref.current,...j.account,fills:[j.fill,...ref.current.fills.filter(f=>f.id!==j.fill.id)]},token);void sync(token).catch(()=>{});}return j.fill;
 }catch(e:any){return e.message;}finally{tradeLock.current=false;setBusy(false);}},
 async refreshHold(){setBusy(true);setError(null);try{await sync();}catch(e:any){setError(e.message);}finally{setBusy(false);}},
 reset(){if(!s.practice||!s.token)return;setBusy(true);paperRequest('reset',s.token,{}).then(j=>commit(j)).catch(e=>setError(e.message)).finally(()=>setBusy(false));}
 }}>{children}</C.Provider>;
}
export function usePaper(){const c=useContext(C);if(!c)throw new Error('PaperProvider missing');return c;}
export function friendlyError(e:Error,_side?:string){return e.message||'Order failed. Please try again.';}
