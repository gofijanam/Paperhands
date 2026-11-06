import test from 'node:test';
import assert from 'node:assert/strict';
import {enhancedTrades} from '../lib/enhanced-trades.ts';
const c={mint:'MINT',symbol:'COIN',solUsd:100};
const token={mint:'MINT',userAccount:'wallet',rawTokenAmount:{tokenAmount:'2500000',decimals:6}};
const tx={type:'SWAP',transactionError:null,signature:'signature',timestamp:123,events:{swap:{nativeInput:{account:'wallet',amount:'100000000'},tokenOutputs:[token],tokenInputs:[]}}};
test('only verified swap legs produce token buy and sell prints',()=>{
 const buy=enhancedTrades([tx],c)[0];assert.equal(buy.side,'buy');assert.equal(buy.tokens,2.5);assert.equal(buy.sol,.1);assert.equal(buy.priceUsd,4);
 const sell=enhancedTrades([{...tx,events:{swap:{nativeOutput:{amount:'200000000'},tokenInputs:[token],tokenOutputs:[]}}}],c)[0];assert.equal(sell.side,'sell');assert.equal(sell.priceUsd,8);
});
test('reject failed swaps, transfers, wrong tokens and ambiguous round trips',()=>{
 assert.equal(enhancedTrades([{...tx,transactionError:{}},{...tx,type:'TRANSFER'},{...tx,events:{swap:{...tx.events.swap,tokenInputs:[token]}}}],c).length,0);
 assert.equal(enhancedTrades([tx],{...c,mint:'OTHER'}).length,0);
});
