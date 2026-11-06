import test from 'node:test';
import assert from 'node:assert/strict';
import {tradeCandles} from '../lib/trade-candles.ts';
const t=(id:string,ts:number,priceUsd:number)=>({id,ts,priceUsd,mint:'mint',symbol:'C',trader:'wallet',side:'buy' as const,sol:1,tokens:2});
test('observed candles preserve gaps, deduplicate trades and compute real OHLC/volume',()=>{
 const rows=tradeCandles([t('a',61000,2),t('b',65000,4),t('a',61000,2),t('c',240000,3)],60);
 assert.deepEqual(rows,[{time:60,open:2,high:4,low:2,close:4,volume:12,source:'observed-trades'},{time:240,open:3,high:3,low:3,close:3,volume:6,source:'observed-trades'}]);
});
