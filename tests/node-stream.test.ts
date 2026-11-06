import test from 'node:test';import assert from 'node:assert/strict';
import {sharedHeliusStream} from '../lib/server/node-stream.ts';
import {PUMP_AMM} from '../lib/pump-events.ts';
test('multiple viewers share one upstream and only the final disconnect closes it',async()=>{
 const Native=globalThis.WebSocket;let opened=0,closed=0;
 class Fake extends EventTarget{static OPEN=1;readyState=1;constructor(_url:string){super();opened++;}send(_data:string){}close(){closed++;}}
 globalThis.WebSocket=Fake as any;
 try{const c={mint:'test-mint',pool:'pool',symbol:'TEST',decimals:6,solUsd:100,program:PUMP_AMM};
 const one=sharedHeliusStream(new Request('http://localhost'),c,'wss://example.test');const two=sharedHeliusStream(new Request('http://localhost'),c,'wss://example.test');
 assert.equal(opened,1);await one.body!.cancel();assert.equal(closed,0);await two.body!.cancel();assert.equal(closed,1);
 }finally{globalThis.WebSocket=Native;}
});
