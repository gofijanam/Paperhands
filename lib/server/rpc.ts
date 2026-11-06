import {env} from './runtime';
type Queue={tail:Promise<void>;pending:Map<string,Promise<any>>;size:number};
const shared=globalThis as typeof globalThis&{paperhandsRpc?:Queue};
const state=shared.paperhandsRpc??={tail:Promise.resolve(),pending:new Map(),size:0};
/** Coalesce requests and pace the shared free-tier RPC instead of bursting per viewer. */
export function rpc(method:string,params:any[]):Promise<any>{
 const key=JSON.stringify([method,params]);const pending=state.pending.get(key);if(pending)return pending;
 if(state.size>=40)return Promise.reject(new Error('On-chain provider is busy. Please retry shortly.'));
 const start=state.tail;state.size++;state.tail=start.then(()=>new Promise<void>(r=>setTimeout(r,160)));
 const task=(async()=>{await start;const url=String(env.SOLANA_RPC_URL||'');if(!url)throw new Error('On-chain feed unavailable');
 for(let attempt=0;attempt<2;attempt++){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(6500)});
  const j:any=await r.json();if((r.status===429||j.error?.code===429)&&!attempt){await new Promise(r=>setTimeout(r,1100));continue;}
  if(!r.ok||j.error)throw new Error('On-chain provider is temporarily unavailable. Retry shortly.');return j.result;
 }
 })().finally(()=>{state.pending.delete(key);state.size--;});state.pending.set(key,task);return task;
}
