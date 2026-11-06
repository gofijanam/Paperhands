import {tokenPaperTraders} from '@/lib/server/paper';
import {rpcHolders} from '@/lib/server/helius';
import {env} from '@/lib/server/runtime';
import {gmgnHolders} from '@/lib/server/gmgn';
import { marketAnalytics,marketFeed,marketCoin,marketCandles,marketSearch,marketTrades,dexFallback,validMint,marketTicks } from '@/lib/server/market';
export async function GET(req:Request){
 const u=new URL(req.url), action=u.searchParams.get('action')||'feed', mint=u.searchParams.get('mint')||'';
 try {
 let data:any;
 if(action==='status'){const row=await env.DB?.prepare("SELECT data FROM market_cache WHERE key='gmgn-diagnostic'").first<any>();const backoff=await env.DB?.prepare("SELECT expires FROM paper_limits WHERE key='gmgn-backoff'").first<any>();data={provider:'GMGN',gatewayConfigured:!!(env as any).MARKET_GATEWAY_URL,directPaused:(env as any).GMGN_DIRECT_PAUSED==='1',retryAt:backoff?.expires||0,lastError:row?JSON.parse(row.data):null};}
 else if(action==='feed') {const col=u.searchParams.get('column'); if(!['trending','new','graduating'].includes(col||''))return Response.json({error:'Invalid feed'},{status:400}); data=await marketFeed(col as any);}
 else if(action==='search')data=await marketSearch(u.searchParams.get('q')||'').catch(()=>dexFallback(u.searchParams.get('q')||''));
 else if(action==='ticks'){const ms=(u.searchParams.get('mints')||'').split(',').filter(validMint).slice(0,30);data=await marketTicks(ms);}
 else {if(!validMint(mint))return Response.json({error:'Invalid mint'},{status:400}); if(action==='analytics')data=await marketAnalytics(mint);else if(action==='coin')data=await marketCoin(mint);else if(action==='candles')data=await marketCandles(mint,(u.searchParams.get('tf')||'5m') as any);else if(action==='trades')data=await marketTrades(mint);else if(action==='holders')data=await gmgnHolders(mint).catch(()=>rpcHolders(mint));else if(action==='top-traders')data=await tokenPaperTraders(mint);else return Response.json({error:'Unknown action'},{status:404});}
 return Response.json({data,asOf:Date.now(),source:'public-market'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Market temporarily unavailable',data:null},{status:503,headers:{'Cache-Control':'no-store'}});}
}
