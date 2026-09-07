import {test} from 'node:test';
import assert from 'node:assert/strict';
import {percentile,runBoundedProbe} from './staging-resilience-core.mjs';
test('percentile is deterministic and does not mutate input',()=>{const values=[4,1,3,2];assert.equal(percentile(values,.95),4);assert.deepEqual(values,[4,1,3,2]);});
test('bounded probe runs the exact requested volume and verifies every response',async()=>{let requests=0,verified=0;const result=await runBoundedProbe({request:async()=>++requests,verify:value=>{assert.ok(value>0);verified++;},concurrency:4,requestsPerWorker:5,maxP95Milliseconds:1000});assert.equal(result.requests,20);assert.equal(requests,20);assert.equal(verified,20);});
test('bounded probe rejects unsafe or invalid volume',async()=>{await assert.rejects(()=>runBoundedProbe({request:async()=>{},concurrency:21,requestsPerWorker:1,maxP95Milliseconds:1000}),/Concurrency/);await assert.rejects(()=>runBoundedProbe({request:async()=>{},concurrency:1,requestsPerWorker:101,maxP95Milliseconds:1000}),/Requests per worker/);});

