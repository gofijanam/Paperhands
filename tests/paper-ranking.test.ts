import test from 'node:test';import assert from 'node:assert/strict';
import {rankPaperTraders} from '../lib/paper-ranking.ts';
test('ranks only the selected token using stored realized PnL, including losses',()=>{
 const row=(wallet:string,mint:string,side:string,sol:number,pnlSol:number|null)=>({wallet,data:JSON.stringify({mint,side,sol,pnlSol})});
 const result=rankPaperTraders([row('winner','coin','buy',1,null),row('winner','coin','sell',1.2,.2),row('loser','coin','sell',.8,-.2),row('outsider','other','sell',100,90)],'coin');
 assert.equal(result.length,2);assert.equal(result[0].wallet,'winner');assert.equal(result[0].realizedSol,.2);assert.equal(result[0].volumeSol,2.2);assert.equal(result[0].trades,2);assert.equal(result[1].realizedSol,-.2);
});
test('empty accounts produce an empty real leaderboard',()=>assert.deepEqual(rankPaperTraders([],'coin'),[]));
test('a buy-only viewer appears with zero realized profit then updates after a partial sell',()=>{
 const buy={wallet:'you',data:JSON.stringify({mint:'coin',side:'buy',sol:1,pnlSol:null})};
 assert.deepEqual(rankPaperTraders([buy],'coin'),[{wallet:'you',realizedSol:0,volumeSol:1,buys:1,sells:0,trades:1}]);
 const sell={wallet:'you',data:JSON.stringify({mint:'coin',side:'sell',sol:.4,pnlSol:-.1})};
 const t=rankPaperTraders([buy,sell],'coin')[0];assert.equal(t.buys,1);assert.equal(t.sells,1);assert.equal(t.realizedSol,-.1);assert.equal(t.volumeSol,1.4);
});
