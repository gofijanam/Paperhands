import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {decodePumpLogs,PUMP_AMM} from '../lib/pump-events.ts';
const c={mint:'HsprHxBRgiVaQdRf3TnKNuZZtaX9JUSPgMFdAkk6pump',symbol:'GATO',pool:'5E3dXLXGwmTDCokA51WYYaKttjFZBwqCoyUHBUi5gt2m',decimals:6,solUsd:90,program:PUMP_AMM};
const event=JSON.parse(readFileSync(new URL('./fixtures/helius-pump-sell.json',import.meta.url),'utf8')).params.result.value;
test('decodes a confirmed mainnet PumpSwap sell from program logs',()=>{const [t]=decodePumpLogs(event.logs,event.signature,c);assert.equal(t.side,'sell');assert.equal(t.tokens,3678.079025);assert.equal(t.sol,0.468674965);assert.equal(t.priceUsd,t.sol/t.tokens*90);assert.equal(t.trader,'6QEN5AjYJrYEkxgS1r88SpLtcxBuKCzQFJUZAA1fXGMe');});
test('rejects another pool and program-spoofed data logs',()=>{assert.deepEqual(decodePumpLogs(event.logs,event.signature,{...c,pool:'wrong'}),[]);assert.deepEqual(decodePumpLogs(event.logs.filter((s:string)=>s.startsWith('Program data: ')),event.signature,c),[]);assert.deepEqual(decodePumpLogs(['Program '+PUMP_AMM+' invoke [1]','Program data: AA=='],'sig',c),[]);});
