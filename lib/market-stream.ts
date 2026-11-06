import type {TTrade,Tick} from './api/schema';
type State={state:'connecting'|'connected'|'reconnecting'|'snapshot';lastEvent:number};
type Listener={tick?:(t:Tick[])=>void;trade?:(t:TTrade)=>void;status?:(s:State)=>void};
const streams=new Map<string,{listeners:Set<Listener>;stop:()=>void;state:State}>();
export function subscribeMarket(mint:string,listener:Listener){
 let entry=streams.get(mint);
 if(!entry){
  const listeners=new Set<Listener>();
  let source:EventSource|null=null,dead=false,retry:ReturnType<typeof setTimeout>|undefined,watchdog:ReturnType<typeof setTimeout>|undefined,attempts=0;
  const next={listeners,stop:()=>{},state:{state:'connecting',lastEvent:0} as State};
  const status=(state:State['state'])=>{next.state={...next.state,state};for(const l of listeners)l.status?.(next.state);};
  const disconnect=()=>{clearTimeout(watchdog);source?.close();source=null;};
  const reconnect=()=>{if(dead)return;disconnect();clearTimeout(retry);status(document.hidden?'snapshot':'reconnecting');if(!document.hidden)retry=setTimeout(open,Math.min(60000,5000*2**attempts++));};
  // An open HTTP connection alone does not prove the feed is alive.
  const alive=()=>{clearTimeout(watchdog);watchdog=setTimeout(reconnect,45000);};
  const open=()=>{
   if(dead||document.hidden)return;
   disconnect();clearTimeout(retry);status('connecting');
   const current=new EventSource(`/api/market/stream?mint=${encodeURIComponent(mint)}`);source=current;alive();
   const receive=(event:string,fn:(data:any)=>void)=>current.addEventListener(event,e=>{if(dead||source!==current)return;try{const data=JSON.parse((e as MessageEvent).data);fn(data);alive();}catch{/* Ignore malformed frames without marking them as healthy. */}});
   receive('status',j=>{if(j.state==='connected'){attempts=0;status('connected');}else if(j.state==='reconnecting'||j.state==='unavailable'){status('reconnecting');}else if(j.state==='connecting')status('connecting');});
   receive('heartbeat',()=>{});
   receive('tick',t=>{if(t.mint!==mint||![t.priceUsd,t.priceSol,t.observedAt].every(Number.isFinite)||t.priceUsd<=0||t.priceSol<=0)return;next.state.lastEvent=Date.now();for(const l of listeners)l.tick?.([t]);status('connected');});
   receive('trade',t=>{if(t.mint===mint)for(const l of listeners)l.trade?.(t);});
   current.onerror=()=>{if(source===current)reconnect();};
  };
  const visibility=()=>{clearTimeout(retry);if(document.hidden){disconnect();status('snapshot');}else{attempts=0;open();}};
  next.stop=()=>{dead=true;clearTimeout(retry);disconnect();document.removeEventListener('visibilitychange',visibility);};
  streams.set(mint,next);entry=next;document.addEventListener('visibilitychange',visibility);open();
 }
 entry.listeners.add(listener);listener.status?.(entry.state);
 return ()=>{entry!.listeners.delete(listener);if(!entry!.listeners.size){entry!.stop();streams.delete(mint);}};
}
