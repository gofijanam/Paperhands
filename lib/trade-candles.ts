import type {TCandle,TTrade} from './api/schema';
/** Aggregate observed trades only. Missing time buckets stay absent. */
export function tradeCandles(trades:TTrade[],seconds:number):TCandle[]{
 const buckets=new Map<number,TCandle>();
 const seen=new Set<string>();
 for(const t of [...trades].sort((a,b)=>a.ts-b.ts)){
  if(seen.has(t.id)||!(t.priceUsd>0)||!(t.tokens>0)||!Number.isFinite(t.ts))continue;seen.add(t.id);
  const time=Math.floor(t.ts/1000/seconds)*seconds,price=t.priceUsd,old=buckets.get(time);
  if(old){old.high=Math.max(old.high,price);old.low=Math.min(old.low,price);old.close=price;old.volume+=price*t.tokens;}
  else buckets.set(time,{time,open:price,high:price,low:price,close:price,volume:price*t.tokens,source:'observed-trades'});
 }
 return [...buckets.values()];
}
