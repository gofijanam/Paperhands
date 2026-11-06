import test from 'node:test';
import assert from 'node:assert/strict';
import {publicRequestOrigin,matchesRequestOrigin} from '../lib/server/request-origin.ts';
const internal='http://localhost:3000/api/paper/practice';
const external='https://paperhands-web-production.up.railway.app';
test('Railway TLS termination uses configured public origin',()=>{
 assert.equal(publicRequestOrigin(internal,external),external);
 assert.equal(matchesRequestOrigin(external,internal,external),true);
});
test('origin guard rejects foreign origins including suffix lookalikes',()=>{
 assert.equal(matchesRequestOrigin('https://evil.example',internal,external),false);
 assert.equal(matchesRequestOrigin(external+'.evil.example',internal,external),false);
 assert.equal(matchesRequestOrigin('null',internal,external),false);
});
test('local development origin and non-browser bearer requests remain supported',()=>{
 assert.equal(matchesRequestOrigin('http://localhost:3000',internal),true);
 assert.equal(matchesRequestOrigin(null,internal,external),true);
});
