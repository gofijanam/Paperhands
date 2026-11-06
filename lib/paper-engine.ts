export const LAMPORTS=1e9, BANKROLL=10*LAMPORTS, DAY=86400000;
export const cycleAt=(now=Date.now())=>Math.floor(now/DAY);
export type Holding={mint:string;symbol:string;tokens:number;costLamports:number;openedAt:number;lastPriceSol?:number;markAt?:number};
export type Ledger={cash:number;positions:Holding[];volume:number;trades:number;firstTrade:number;eligible:boolean;equity:{t:number;v:number}[]};
export const newLedger=():Ledger=>({cash:BANKROLL,positions:[],volume:0,trades:0,firstTrade:0,eligible:true,equity:[]});
export type Order={mint:string;symbol:string;side:'buy'|'sell';tokens:number;debit:number;credit:number;fee:number;priceSol:number;impactPct:number;slippageBps:number;spot:number;issued:number;expires:number};
export function quoteOrder(s:Ledger,c:{mint:string;symbol:string;priceSol:number;priceUsd:number;liquidityUsd:number;status:string},side:string,amount:number,slippage:number,now=Date.now()):Order{
 if(![amount,slippage,c.priceSol,c.priceUsd,c.liquidityUsd].every(Number.isFinite)||amount<=0||slippage<1||slippage>5000||!['buy','sell'].includes(side))throw new Error('Invalid order amount or slippage.');
 if(c.status!=='tradeable'||c.priceSol<=0||c.priceUsd<=0||c.liquidityUsd<1000)throw new Error('Insufficient verified liquidity for a paper fill.');
 const p=s.positions.find(p=>p.mint===c.mint),notional=side==='buy'?amount:amount*c.priceSol;
 if(notional<0.01)throw new Error('Minimum trade is 0.01 paper SOL.');
 if(side==='sell'&&(!p||amount>p.tokens*(1+1e-10)))throw new Error('Not enough tokens to sell.');
 const reserve=c.liquidityUsd/2/(c.priceUsd/c.priceSol),impact=notional/(reserve+notional);
 if(impact>.05||impact*10000>slippage)throw new Error('Price impact exceeds your slippage limit. Reduce the order.');
 const price=c.priceSol*(side==='buy'?1+impact:1-impact),venueFee=0.003,priority=100000;
 const debit=side==='buy'?Math.ceil(amount*LAMPORTS)+priority:0;
 const fee=Math.ceil(notional*venueFee*LAMPORTS)+priority;
 const tokens=side==='buy'?(amount*(1-venueFee))/price:amount;
 const credit=side==='sell'?Math.floor(amount*price*(1-venueFee)*LAMPORTS)-priority:0;
 if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit)||!Number.isFinite(tokens)||tokens<=0)throw new Error('Order exceeds supported precision.');
 if(debit>s.cash)throw new Error('Not enough paper SOL.');
 if(side==='buy'&&(p?.costLamports||0)+debit>BANKROLL*.25)throw new Error('Maximum 25% of the starting bankroll per coin.');
 if(side==='sell'&&credit<=0)throw new Error('Order is smaller than its simulated fees.');
 return {mint:c.mint,symbol:c.symbol,side:side as 'buy'|'sell',tokens,debit,credit,fee,priceSol:price,impactPct:impact*100,slippageBps:slippage,spot:c.priceSol,issued:now,expires:Math.min(now+10000,(cycleAt(now)+1)*DAY)};
}
export function applyOrder(s:Ledger,q:Order,now=Date.now()){
 if(now>=q.expires||now<q.issued)throw new Error('Quote expired. Request a new quote.');
 const p=s.positions.find(p=>p.mint===q.mint);let pnl:number|null=null;
 const next=structuredClone(s);
 if(q.side==='buy'){
 if(q.debit>s.cash||(p?.costLamports||0)+q.debit>BANKROLL*.25)throw new Error('Balance or exposure changed. Request a new quote.');
 next.cash-=q.debit; const row=next.positions.find(p=>p.mint===q.mint);
 if(row){row.tokens+=q.tokens;row.costLamports+=q.debit;}else next.positions.push({mint:q.mint,symbol:q.symbol,tokens:q.tokens,costLamports:q.debit,openedAt:now});
 }else{
 if(!p||q.tokens>p.tokens*(1+1e-10))throw new Error('Position changed. Request a new quote.');
 const fraction=Math.min(1,q.tokens/p.tokens),cost=Math.round(p.costLamports*fraction);pnl=(q.credit-cost)/LAMPORTS;
 next.cash+=q.credit;next.positions=next.positions.flatMap(x=>x.mint!==q.mint?[x]:fraction>0.99999999?[]:[{...x,tokens:x.tokens-q.tokens,costLamports:x.costLamports-cost}]);
 }
 next.volume+=q.side==='buy'?q.debit:q.credit;next.trades++;next.firstTrade ||= now;
 return {next,pnl};
}
export function rewardShares(pool:number,count:number){
 if(!Number.isSafeInteger(pool)||pool<0)throw new Error('Invalid reward pool');
 const net=Math.floor(pool*.9),weights=Array.from({length:Math.min(count,25)},(_,i)=>i===0?.3:i===1?.18:i===2?.12:i<10?.25/7:.15/15);
 return weights.map(w=>Math.floor(net*w)); // unallocated places and rounding stay in reserve; never over-distribute
}
