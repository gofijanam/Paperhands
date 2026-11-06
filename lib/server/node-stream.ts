import {decodePumpLogs,PUMP,type EventMarket} from '../pump-events';
import type {TTrade} from '../api/schema';
type Listener=(event:string,data:any)=>void;
type Hub={clients:Set<Listener>;ws:WebSocket|null;state:string;retry:ReturnType<typeof setTimeout>|null;heartbeat:ReturnType<typeof setInterval>|null;closed:boolean;seen:Set<string>;trades:TTrade[];attempt:number;lastMessage:number;};
const hubs=new Map<string,Hub>();
export function recentStreamTrades(mint:string){return hubs.get(mint)?.trades.slice()||[];}
/** One upstream connection per viewed mint; all viewers share its verified events. */
export function sharedHeliusStream(req:Request,c:EventMarket,wsUrl:string){
 if(!wsUrl)throw new Error('Live provider is not configured');
 let hub=hubs.get(c.mint);
 if(!hub){
  if(hubs.size>=32)throw new Error('Live pool capacity reached');
  hub={clients:new Set(),ws:null,state:'connecting',retry:null,heartbeat:null,closed:false,seen:new Set(),trades:[],attempt:0,lastMessage:Date.now()};hubs.set(c.mint,hub);
  const h=hub;
  const broadcast=(event:string,data:any)=>{for(const listener of h.clients)listener(event,data);};
  const connect=()=>{
   if(h.closed)return;h.lastMessage=Date.now();const ws=new WebSocket(wsUrl);h.ws=ws;
   ws.addEventListener('open',()=>{ws.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'logsSubscribe',params:[{mentions:[c.program===PUMP?c.mint:c.pool]},{commitment:'confirmed'}]}));ws.send(JSON.stringify({jsonrpc:'2.0',id:2,method:'slotSubscribe'}));});
   ws.addEventListener('message',event=>{if(h.closed||h.ws!==ws)return;h.lastMessage=Date.now();try{
    const j=JSON.parse(String(event.data));if(j.error){ws.close();return;}
    if(j.id===1&&j.result){h.state='connected';h.attempt=0;broadcast('status',{state:'connected',source:'Helius',mode:'events'});return;}
    const v=j.params?.result?.value;if(!v||v.err||!v.signature||h.seen.has(v.signature))return;
    h.seen.add(v.signature);if(h.seen.size>1500)h.seen.delete(h.seen.values().next().value!);
    const trades=decodePumpLogs(v.logs||[],v.signature,c);h.trades=[...trades.reverse(),...h.trades].slice(0,100);
    for(const trade of trades)broadcast('trade',trade);
    const t=trades[0];if(t)broadcast('tick',{mint:c.mint,priceUsd:t.priceUsd,priceSol:t.sol/t.tokens,observedAt:Date.now(),source:'helius-trade',slot:j.params.result.context.slot});
   }catch{}});
   ws.addEventListener('error',()=>ws.close());
   ws.addEventListener('close',()=>{if(h.closed||h.ws!==ws)return;h.state='reconnecting';broadcast('status',{state:h.state,source:'Helius'});h.retry=setTimeout(connect,Math.min(60000,3000*2**Math.min(h.attempt++,5)));});
  };
  connect();h.heartbeat=setInterval(()=>{broadcast('heartbeat',{at:Date.now()});if(Date.now()-h.lastMessage>45000)h.ws?.close();},15000);
 }
 const h=hub,enc=new TextEncoder();let controller:ReadableStreamDefaultController<Uint8Array>|undefined,closed=false;
 const listener:Listener=(event,data)=>{if(!closed)try{controller?.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));}catch{close();}};
 const close=()=>{if(closed)return;closed=true;h.clients.delete(listener);req.signal.removeEventListener('abort',close);try{controller?.close();}catch{}
  if(!h.clients.size){h.closed=true;if(h.retry)clearTimeout(h.retry);if(h.heartbeat)clearInterval(h.heartbeat);h.ws?.close();hubs.delete(c.mint);}
 };
 const body=new ReadableStream<Uint8Array>({start(ctrl){controller=ctrl;h.clients.add(listener);listener('status',{state:h.state,source:'Helius',mode:'events'});for(const trade of [...h.trades].reverse())listener('trade',trade);req.signal.addEventListener('abort',close,{once:true});if(req.signal.aborted)close();},cancel:close});
 return new Response(body,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'}});
}
