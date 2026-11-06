import test from 'node:test';
import assert from 'node:assert/strict';
import {positionMark,equityPoints} from '../lib/portfolio-values.ts';
test('stale positions retain their last value instead of dropping equity to zero',()=>{
 assert.deepEqual(positionMark({tokens:10,costSol:2,valueSol:1.5,markStatus:'stale'}),{value:1.5,status:'stale'});
 assert.deepEqual(positionMark({tokens:10,costSol:2}),{value:null,status:'unknown'});
});
test('a fresh market observation replaces old account marks',()=>{
 assert.deepEqual(positionMark({tokens:10,costSol:2,valueSol:1.5,markStatus:'stale'},{priceSol:.3,observedAt:9990},10000),{value:3,status:'fresh'});
});
test('equity history excludes invalid values, orders observations and deduplicates seconds',()=>{
 assert.deepEqual(equityPoints([{t:3000,v:12},{t:1100,v:10},{t:1900,v:11},{t:4000,v:NaN}]),[{t:1000,v:11},{t:3000,v:12}]);
});
