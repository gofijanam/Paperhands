import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDexAnalytics,recentWalletActivity,safePublicUrl} from '../lib/dex-analytics.ts';
const mint='HsprHxBRgiVaQdRf3TnKNuZZtaX9JUSPgMFdAkk6pump';
const pool='So11111111111111111111111111111111111111112';
const pair={chainId:'solana',pairAddress:pool,dexId:'pumpswap',baseToken:{address:mint,symbol:'GATO'},quoteToken:{address:pool,symbol:'SOL'},priceUsd:'0.012',liquidity:{usd:300000,base:1,quote:2},txns:{m5:{buys:0,sells:2}},volume:{m5:0},priceChange:{m5:-2.1},fdv:12000000};
test('unknown market fields remain unknown while observed zero counts are preserved',()=>{
 const d=normalizeDexAnalytics([pair],mint,1234),p=d.pools[0];assert.equal(d.observedAt,1234);assert.equal(p.windows.m5.buys,0);assert.equal(p.windows.m5.volume,0);assert.equal(p.windows.h24.buys,null);assert.equal(p.marketCap,null);assert.equal(p.fdv,12000000);assert.equal(p.createdAt,null);
});
test('rejects wrong chain and quote-side prices and deduplicates pool addresses',()=>{
 const d=normalizeDexAnalytics([pair,pair,{...pair,chainId:'ethereum'},{...pair,baseToken:{address:pool},quoteToken:{address:mint}}],mint,1234);assert.equal(d.pools.length,1);
});
test('retains quote currency without treating native USDC as SOL and sanitizes URLs',()=>{
 const d=normalizeDexAnalytics([{...pair,quoteToken:{symbol:'USDC',address:mint},priceNative:'0.012',info:{websites:[{url:'javascript:alert(1)'},{url:'https://example.com'}]}}],mint,1234);assert.equal(d.pools[0].quote,'USDC');assert.equal(d.pools[0].links.length,1);assert.equal(safePublicUrl('https://user:pass@example.com'),null);
});
test('recent wallets count unique real trade IDs, not shortened addresses or profit',()=>{
 const t={id:'a',trader:mint,side:'buy',sol:2,ts:100};const rows=recentWalletActivity([t,t,{...t,id:'b',side:'sell',sol:1},{...t,id:'c',trader:'Hspr…pump'}]);assert.equal(rows.length,1);assert.equal(rows[0].buys,1);assert.equal(rows[0].sells,1);assert.equal(rows[0].boughtSol,2);assert.equal(rows[0].soldSol,1);assert.equal('pnl' in rows[0],false);
});
