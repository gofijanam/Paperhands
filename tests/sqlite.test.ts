import test from 'node:test';import assert from 'node:assert/strict';
import {createDatabase} from '../lib/server/sqlite.ts';
test('ledger transactions roll back all writes when a later statement fails',async()=>{
 const db=createDatabase(':memory:');
 await assert.rejects(db.batch([db.prepare("INSERT INTO paper_limits VALUES('test',1,0)"),db.prepare("INSERT INTO paper_limits VALUES('test',2,0)")]));
 assert.equal(await db.prepare("SELECT * FROM paper_limits WHERE key='test'").first(),null);
 const results=await db.batch([db.prepare("INSERT INTO paper_limits VALUES('test',1,0)"),db.prepare("UPDATE paper_limits SET count=count+1 WHERE key='test'")]);assert.equal(results[0].meta.changes,1);assert.equal((await db.prepare("SELECT count FROM paper_limits WHERE key='test'").first<any>())?.count,2);db.close();
});
