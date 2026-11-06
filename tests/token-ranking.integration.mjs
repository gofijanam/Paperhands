// Run after npm run build: node --experimental-strip-types tests/token-ranking.integration.mjs
// Uses a disposable local database and server, never production accounts.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createDatabase} from '../lib/server/sqlite.ts';
const folder=await mkdtemp(join(tmpdir(),'paper-ranking-')),path=join(folder,'qa.sqlite');
const db=createDatabase(path),cycle=Math.floor(Date.now()/86400000),mint='Ce2gx9KGXJ6C9Mp5b5x1sn9Mg87JwEbrQby4Zqo3pump';
const tokenA=randomUUID(),tokenB=randomUUID();
let child;
try{
 for(const [user,wallet,day,amount,coin] of [['practice:a',null,cycle,1,mint],['practice:b',null,cycle,2,mint],['wallet-owner','wallet-owner',cycle,3,mint],['old-account','old-wallet',cycle-1,4,mint],['another-token','another-wallet',cycle,5,'other']]){
  await db.prepare('INSERT INTO paper_accounts(id,user,wallet,cycle,data) VALUES(?,?,?,?,?)').bind(user,user,wallet,day,'{}').run();
  await db.prepare('INSERT INTO paper_fills(id,account,intent,data,created) VALUES(?,?,?,?,?)').bind(user,user,user,JSON.stringify({mint:coin,side:'buy',sol:amount}),Date.now()).run();
 }
 for(const [token,user] of [[tokenA,'practice:a'],[tokenB,'practice:b']])await db.prepare('INSERT INTO paper_sessions(hash,user,wallet,expires) VALUES(?,?,NULL,?)').bind(createHash('sha256').update(token).digest('hex'),user,Date.now()+60000).run();
 const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>resolve(n));});});
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,DATABASE_PATH:path,PAPER_MIGRATION_BASE64:'',NEXT_TELEMETRY_DISABLED:'1'},stdio:'ignore'});
 const url=`http://127.0.0.1:${port}/api/market?action=top-traders&mint=${mint}`;
 let ready=false;for(let i=0;i<100;i++){try{await fetch(url);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.ok(ready,'local server starts');
 const get=async token=>{const r=await fetch(url,{headers:token?{authorization:`Bearer ${token}`}:{}});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);return (await r.json()).data;};
 const publicRows=await get();assert.deepEqual(publicRows.map(x=>x.wallet),['wallet-owner']);
 const a=await get(tokenA),b=await get(tokenB);
 assert.equal(a.length,2);assert.equal(b.length,2);assert.equal(a.find(x=>x.isYou).volumeSol,1);assert.equal(b.find(x=>x.isYou).volumeSol,2);
 assert.equal(a.find(x=>x.isYou).buys,1);assert.equal(a.find(x=>x.isYou).realizedSol,0);
 assert.ok(!JSON.stringify(a).includes('practice:b'));assert.ok(!JSON.stringify(publicRows).includes('you'));
 const invalid=await fetch(url,{headers:{authorization:'Bearer invalid'}});assert.equal(invalid.status,401);
 console.log('PASS: public/private ranking isolation, buy-only row, current-cycle/token filtering, invalid-session rejection and no-store response.');
}finally{if(child){const stopped=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await stopped;}db.close();await rm(folder,{recursive:true,force:true});}
