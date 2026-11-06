import test from 'node:test';
import assert from 'node:assert/strict';
import {subscribeMarket} from '../lib/market-stream.ts';

function setup(t:any){
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
 const doc=new EventTarget() as EventTarget&{hidden:boolean};doc.hidden=false;
 class Feed extends EventTarget{
  static all:Feed[]=[];closed=false;onerror:(()=>void)|null=null;
  url:string;constructor(url:string){super();this.url=url;Feed.all.push(this);}
  close(){this.closed=true;}
  emit(type:string,data:any){this.dispatchEvent(new MessageEvent(type,{data:JSON.stringify(data)}));}
 }
 const oldDoc=Object.getOwnPropertyDescriptor(globalThis,'document'),oldFeed=Object.getOwnPropertyDescriptor(globalThis,'EventSource');
 Object.defineProperty(globalThis,'document',{value:doc,configurable:true});Object.defineProperty(globalThis,'EventSource',{value:Feed,configurable:true});
 const cleanup:Array<()=>void>=[];t.after(()=>{for(const stop of cleanup)stop();for(const [name,old] of [['document',oldDoc],['EventSource',oldFeed]] as const){if(old)Object.defineProperty(globalThis,name,old);else Reflect.deleteProperty(globalThis,name);}});
 return {doc,Feed,cleanup};
}
test('shares one connection and closes only after the last subscriber',t=>{
 const {Feed}=setup(t),a=subscribeMarket('shared',{}),b=subscribeMarket('shared',{});
 assert.equal(Feed.all.length,1);a();assert.equal(Feed.all[0].closed,false);b();assert.equal(Feed.all[0].closed,true);
 t.mock.timers.tick(120000);assert.equal(Feed.all.length,1);
});
test('server reconnect status and network errors stop reporting a live feed',t=>{
 const {Feed,cleanup}=setup(t),states:string[]=[];const stop=subscribeMarket('recover',{status:s=>states.push(s.state)});cleanup.push(stop);
 const first=Feed.all[0];first.emit('status',{state:'connected'});first.emit('status',{state:'reconnecting'});assert.equal(states.at(-1),'reconnecting');
 first.onerror!();t.mock.timers.tick(5000);assert.equal(Feed.all.length,2);assert.equal(first.closed,true);
 first.emit('status',{state:'connected'});assert.equal(states.at(-1),'connecting');
 Feed.all[1].emit('status',{state:'connected'});assert.equal(states.at(-1),'connected');
});
test('heartbeats keep a quiet market open; silent connections reconnect',t=>{
 const {Feed,cleanup}=setup(t),stop=subscribeMarket('quiet',{});cleanup.push(stop);
 const first=Feed.all[0];first.emit('status',{state:'connected'});
 for(let i=0;i<5;i++){t.mock.timers.tick(15000);first.emit('heartbeat',{at:Date.now()});}
 assert.equal(first.closed,false);t.mock.timers.tick(45000);assert.equal(first.closed,true);t.mock.timers.tick(5000);assert.equal(Feed.all.length,2);
});
test('hidden tabs close and never reconnect until visible',t=>{
 const {Feed,doc,cleanup}=setup(t),stop=subscribeMarket('visibility',{});cleanup.push(stop);
 doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));t.mock.timers.tick(120000);assert.equal(Feed.all.length,1);assert.equal(Feed.all[0].closed,true);
 doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(Feed.all.length,2);
});
