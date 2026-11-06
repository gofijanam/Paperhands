import {subscribeMarket} from '../market-stream';
import type {PaperApi,TCoin,TQuote} from './schema';
export const marketRequest=async(action:string,params:Record<string,string>={})=>{
 const r=await fetch(`/api/market?${new URLSearchParams({action,...params})}`,{signal:AbortSignal.timeout(['candles','trades'].includes(action)?20000:15000)});const j:any=await r.json();if(!r.ok)throw new Error(j.error||'Market data unavailable');return j.data;
};
export async function paperRequest(action:string,token?:string|null,body?:any,intent?:string){
 const r=await fetch(`/api/paper/${action}`,{method:body!==undefined?'POST':'GET',headers:{...(token?{authorization:`Bearer ${token}`} :{}),...(body!==undefined?{'content-type':'application/json'}:{}),...(intent?{'idempotency-key':intent}:{})},body:body!==undefined?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});const j:any=await r.json();if(!r.ok)throw Object.assign(new Error(j.error||'Request failed'),{status:r.status});return j;
}
function poll(fn:()=>Promise<void>,ms:number){let busy=false,dead=false;const run=async()=>{if(dead||busy||document.hidden)return;busy=true;try{await fn();}catch{}finally{busy=false;}};void run();const timer=setInterval(run,ms);return()=>{dead=true;clearInterval(timer);};}
export function createMarketApi():PaperApi{return {
 mode:'live',feed:column=>marketRequest('feed',{column}),coin:mint=>marketRequest('coin',{mint}),candles:(mint,tf)=>marketRequest('candles',{mint,tf}),
 search:q=>marketRequest('search',{q}),trades:async mint=>({items:await marketRequest('trades',{mint}),source:'geckoterminal'}),holders:mint=>marketRequest('holders',{mint}),topTraders:mint=>marketRequest('top-traders',{mint}),
 leaderboard:()=>paperRequest('leaderboard'),gate:async wallet=>({wallet,held:0,required:50000,pass:false}),quote:(body,token)=>paperRequest('quote',token,body) as Promise<TQuote>,
 subscribeTicks:(on,mints=[])=>{if(mints.length===1){let lastEvent=0;const stream=subscribeMarket(mints[0],{tick:ts=>{lastEvent=Date.now();on(ts);}});const snapshot=poll(async()=>{if(Date.now()-lastEvent>6000)on(await marketRequest('ticks',{mints:mints[0]}));},5000);return()=>{stream();snapshot();};}return mints.length?poll(async()=>{const chunks=[];for(let i=0;i<mints.length;i+=30)chunks.push(mints.slice(i,i+30));const ts=await Promise.all(chunks.map(ms=>marketRequest('ticks',{mints:ms.join(',')})));on(ts.flat());},15000):()=>{};},
 subscribeTrades:(on,mint)=>{if(!mint)return()=>{};let streaming=false;const stream=subscribeMarket(mint,{trade:on,status:s=>{streaming=s.state==='connected';}});let seeded=false;const snapshot=poll(async()=>{if(seeded&&streaming)return;for(const t of (await marketRequest('trades',{mint})).reverse())on(t);seeded=true;},20000);return()=>{stream();snapshot();};},
 };}
