import http from 'node:http';
import {timingSafeEqual,createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {decodePumpLogs,PUMP,PUMP_AMM} from './pump-events.mjs';
const SOL='So11111111111111111111111111111111111111112';
const allowed=new Set(['/v1/token/info','/v1/market/token_top_holders','/v1/market/token_top_traders','/v1/market/token_kline','/v1/market/rank','/v1/market/search','/v1/trenches']);
const mintOK=s=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function createProvider({apiKey,fetcher=fetch,spacing=1250,now=Date.now,wait=sleep,notBefore=0}){
 const cache=new Map(),pending=new Map();let tail=Promise.resolve(),next=0,retryAt=notBefore,queued=0,lastError=null;
 const status=()=>({configured:!!apiKey,retryAt,queued,lastError});
 async function request(path,params={},ttl=10000,body){
  if(!allowed.has(path))throw Object.assign(new Error('Unsupported read-only market route'),{status:400});
  if(!apiKey)throw Object.assign(new Error('Market key missing'),{status:503});
  if(path!='/v1/trenches'&&body)throw Object.assign(new Error('Unexpected request body'),{status:400});
  const key=JSON.stringify([path,params,body]),hit=cache.get(key);
  if(hit&&now()-hit.at<ttl)return hit;
  if(pending.has(key))return pending.get(key);
  if(queued>=16)throw Object.assign(new Error('Market queue full'),{status:503});
  const task=(async()=>{
   queued++;
   const previous=tail;let unlock;tail=new Promise(r=>{unlock=r;});
   try{
    await previous;
    if(now()<retryAt)throw Object.assign(new Error('Provider cooldown'),{status:429,retryAt});
    if(next>now())await wait(next-now());
    const query=new URLSearchParams({...params,chain:'sol',timestamp:String(Math.floor(now()/1000)),client_id:randomUUID()});
    const r=await fetcher('https://openapi.gmgn.ai'+path+'?'+query,{method:body?'POST':'GET',headers:{'X-APIKEY':apiKey,'Content-Type':'application/json','User-Agent':'Paperhands/1.0'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(8000)});
    const raw=await r.json();
    if(r.status===429){retryAt=Math.max(now()+10000,Number(r.headers.get('x-ratelimit-reset')||raw.reset_at||0)*1000+2000);lastError={status:429,reason:raw.error||'rate_limit',at:now()};throw Object.assign(new Error('Provider cooldown'),{status:429,retryAt});}
    if(!r.ok||raw.code!==0){lastError={status:r.status,reason:raw.error||'provider_error',at:now()};throw Object.assign(new Error('Market provider unavailable'),{status:503});}
    let data=raw;for(let i=0;i<4&&data&&'code' in data;i++){if(data.code!==0)throw new Error('Invalid provider result');data=data.data;}
    const value={data,at:now()};cache.set(key,value);if(cache.size>500)cache.delete(cache.keys().next().value);lastError=null;return value;
   }catch(e){if(hit&&now()-hit.at<120000)return {...hit,stale:true};throw e;}
   finally{next=now()+spacing;queued--;unlock();}
  })().finally(()=>pending.delete(key));pending.set(key,task);return task;
 }
 return {request,status};
}
function authorized(req,secret){if(!secret)return false;const a=createHash('sha256').update(req.headers.authorization||'').digest(),b=createHash('sha256').update('Bearer '+secret).digest();return timingSafeEqual(a,b);}
export function createGateway(config={}){
 const secret=config.token??process.env.MARKET_GATEWAY_TOKEN,provider=config.provider??createProvider({apiKey:process.env.GMGN_API_KEY,notBefore:Number(process.env.GMGN_NOT_BEFORE||0)}),hubs=new Map();
 const wsUrl=config.wsUrl??process.env.SOLANA_WS_URL;
 const send=(res,event,data)=>{if(!res.destroyed)res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);};
 async function subscribe(mint,res){
  let hub=hubs.get(mint);
  if(!hub){
   if(hubs.size>=10)throw Object.assign(new Error('Live pool capacity reached'),{status:503});
   const j=await provider.request('/v1/token/info',{address:mint},8000),r=j.data,p=r.pool;
   if(!p||p.quote_address!==SOL||!['pump','pump_amm'].includes(p.exchange)||!wsUrl)throw Object.assign(new Error('Instant tape is unavailable for this pool'),{status:422});
   if(hubs.has(mint))return subscribe(mint,res);
   const c={mint,pool:p.pool_address,symbol:r.symbol,decimals:r.decimals,solUsd:Number(p.quote_reserve_value)/Number(p.quote_reserve),program:p.exchange==='pump'?PUMP:PUMP_AMM};
   if(!(c.solUsd>0))throw new Error('SOL conversion unavailable');
   hub={clients:new Set(),state:'connecting',ws:null,retry:null,heartbeat:null,seen:new Set(),closed:false,attempt:0};
   hubs.set(mint,hub);
   const broadcast=(event,data)=>{for(const client of hub.clients)send(client,event,data);};
   const connect=()=>{if(hub.closed)return;const ws=new WebSocket(wsUrl);hub.ws=ws;
    ws.addEventListener('open',()=>ws.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'logsSubscribe',params:[{mentions:[c.program===PUMP?mint:c.pool]},{commitment:'confirmed'}]})));
    ws.addEventListener('message',e=>{try{const j=JSON.parse(String(e.data));if(j.error){ws.close();return;}if(j.id===1){hub.state='connected';hub.attempt=0;broadcast('status',{state:'connected',source:'Helius'});return;}const v=j.params?.result?.value;if(!v||v.err||hub.seen.has(v.signature))return;hub.seen.add(v.signature);if(hub.seen.size>1000)hub.seen.delete(hub.seen.values().next().value);const trades=decodePumpLogs(v.logs||[],v.signature,c);for(const trade of trades)broadcast('trade',trade);const t=trades.at(-1);if(t)broadcast('tick',{mint,priceUsd:t.priceUsd,priceSol:t.sol/t.tokens,observedAt:Date.now(),source:'helius-trade',slot:j.params.result.context.slot});}catch{}});
    ws.addEventListener('error',()=>ws.close());ws.addEventListener('close',()=>{if(hub.closed)return;hub.state='reconnecting';broadcast('status',{state:'reconnecting',source:'Helius'});hub.retry=setTimeout(connect,Math.min(60000,3000*2**hub.attempt++));});
   };connect();hub.heartbeat=setInterval(()=>broadcast('heartbeat',{at:Date.now()}),15000);
  }
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});hub.clients.add(res);send(res,'status',{state:hub.state,source:'Helius'});
  res.on('close',()=>{hub.clients.delete(res);if(!hub.clients.size){hub.closed=true;clearInterval(hub.heartbeat);clearTimeout(hub.retry);hub.ws?.close();hubs.delete(mint);}});
 }
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/healthz')return json(res,200,{ok:true,service:'paperhands-market',providerConfigured:provider.status().configured});
  if(!authorized(req,secret))return json(res,401,{error:'Unauthorized'});
  try{
   if(req.method==='GET'&&u.pathname==='/status')return json(res,200,{...provider.status(),livePools:hubs.size});
   if(req.method==='GET'&&u.pathname==='/stream'){const mint=u.searchParams.get('mint')||'';if(!mintOK(mint))return json(res,400,{error:'Invalid mint'});return await subscribe(mint,res);}
   if(req.method!=='POST'||u.pathname!=='/gmgn')return json(res,404,{error:'Not found'});
   let body='';for await(const part of req){body+=part;if(body.length>32768)return json(res,413,{error:'Request too large'});}
   const b=JSON.parse(body);if(typeof b.path!=='string'||!b.params||typeof b.params!=='object'||Array.isArray(b.params))return json(res,400,{error:'Invalid request'});
   const result=await provider.request(b.path,b.params,Math.max(2000,Math.min(60000,Number(b.ttl)||10000)),b.body);json(res,200,result);
  }catch(e){if(!res.headersSent)json(res,e.status||503,{error:e.message||'Market unavailable',retryAt:e.retryAt});else res.end();}
 });
 server.on('close',()=>{for(const hub of hubs.values()){hub.closed=true;clearInterval(hub.heartbeat);clearTimeout(hub.retry);hub.ws?.close();}});
 return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.env.MARKET_GATEWAY_TOKEN||!process.env.GMGN_API_KEY)throw new Error('Configure MARKET_GATEWAY_TOKEN and GMGN_API_KEY as runtime secrets.');
 const server=createGateway();server.listen(Number(process.env.PORT)||10000,'0.0.0.0',()=>console.log('Paperhands market gateway ready'));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
}
