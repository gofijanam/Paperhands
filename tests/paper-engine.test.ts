import {test} from 'node:test';
import assert from 'node:assert/strict';
import {quoteOrder,applyOrder,newLedger,cycleAt,rewardShares,DAY,BANKROLL} from '../lib/paper-engine.ts';
const c={mint:'mint',symbol:'TEST',priceSol:.001,priceUsd:.1,liquidityUsd:1e6,status:'tradeable'};
test('buy and sell deduct fees and keep balance in integer lamports',()=>{const s=newLedger(),q=quoteOrder(s,c,'buy',1,100,1000),b=applyOrder(s,q,1001).next;assert.equal(b.cash,BANKROLL-q.debit);assert.equal(b.positions.length,1);const sell=quoteOrder(b,c,'sell',b.positions[0].tokens,100,1002),r=applyOrder(b,sell,1003);assert.equal(r.next.positions.length,0);assert.ok(r.next.cash<BANKROLL);assert.ok(Number.isSafeInteger(r.next.cash));assert.ok(r.pnl!<0);});
test('reject NaN negative infinity invalid side and slippage',()=>{for(const n of [NaN,Infinity,-1,0])assert.throws(()=>quoteOrder(newLedger(),c,'buy',n,100));assert.throws(()=>quoteOrder(newLedger(),c,'steal',1,100));assert.throws(()=>quoteOrder(newLedger(),c,'buy',1,-20));});
test('enforce 25% cumulative entry exposure and cash',()=>{const s=newLedger();assert.throws(()=>quoteOrder(s,c,'buy',3,100),/25%/);const b=applyOrder(s,quoteOrder(s,c,'buy',2,100));assert.throws(()=>quoteOrder(b.next,c,'buy',1,100),/25%/);s.cash=1;assert.throws(()=>quoteOrder(s,c,'buy',1,100),/Not enough/);});
test('expiry and overselling fail closed',()=>{const q=quoteOrder(newLedger(),c,'buy',1,100,1000);assert.throws(()=>applyOrder(newLedger(),q,11000),/expired/);assert.throws(()=>quoteOrder(newLedger(),c,'sell',100,100),/Not enough/);});
test('thin liquidity and extreme impact reject',()=>{assert.throws(()=>quoteOrder(newLedger(),{...c,liquidityUsd:400},'buy',1,100));assert.throws(()=>quoteOrder(newLedger(),{...c,liquidityUsd:1000},'buy',1,50));});
test('daily boundaries UTC and distributions never exceed funded pool',()=>{assert.equal(cycleAt(DAY-1),0);assert.equal(cycleAt(DAY),1);for(const pool of [0,1,1001,1000000000]){const a=rewardShares(pool,25);assert.ok(a.every(Number.isSafeInteger));assert.ok(a.reduce((x,y)=>x+y,0)<=Math.floor(pool*.9));}});
test('custom token sale preserves the unsold balance and proportional cost',()=>{
 const bought=applyOrder(newLedger(),quoteOrder(newLedger(),c,'buy',1,100,1000),1001).next;
 const before=bought.positions[0],amount=123.456;
 const q=quoteOrder(bought,c,'sell',amount,100,1002),result=applyOrder(bought,q,1003);
 assert.equal(q.tokens,amount);assert.equal(result.next.positions.length,1);
 assert.ok(Math.abs(result.next.positions[0].tokens-(before.tokens-amount))<1e-9);
 assert.equal(result.next.positions[0].costLamports,before.costLamports-Math.round(before.costLamports*amount/before.tokens));
 assert.throws(()=>quoteOrder(result.next,c,'sell',before.tokens,100,1004),/Not enough/);
});
