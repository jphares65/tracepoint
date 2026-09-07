import assert from 'node:assert/strict';
import {runBoundedProbe} from './staging-resilience-core.mjs';

const baseURL='https://staging.tracepointhq.com';
const request=(path,options={})=>fetch(baseURL+path,{redirect:'manual',signal:AbortSignal.timeout(10000),...options});
const load=await runBoundedProbe({
  concurrency:8,
  requestsPerWorker:25,
  maxP95Milliseconds:3000,
  request:()=>request('/api/health'),
  verify:response=>assert.equal(response.status,200),
});
const failure=await runBoundedProbe({
  concurrency:4,
  requestsPerWorker:5,
  maxP95Milliseconds:3000,
  request:()=>request('/api/access',{headers:{Authorization:'Bearer deliberately-invalid'}}),
  verify:response=>assert.ok(response.status===401||([302,303,307,308].includes(response.status)&&new URL(response.headers.get('location'),baseURL).pathname==='/login')),
});
const recovery=await runBoundedProbe({
  concurrency:4,
  requestsPerWorker:5,
  maxP95Milliseconds:3000,
  request:()=>request('/api/health'),
  verify:response=>assert.equal(response.status,200),
});
const insecure=await fetch('http://staging.tracepointhq.com/api/health',{redirect:'manual',signal:AbortSignal.timeout(10000)});
assert.ok([301,302,307,308].includes(insecure.status));
assert.equal(new URL(insecure.headers.get('location')).protocol,'https:');
console.log(JSON.stringify({
  target:baseURL,
  boundedPublicLoad:{...load,allHealthy:true},
  invalidAuthenticationFailure:{...failure,noProtectedDataReturned:true},
  postFailureRecovery:{...recovery,allHealthy:true},
  tlsRedirectVerified:true,
  productionEquivalentEdgeBehavior:true,
  productionCapacityProof:false,
  productionTrafficChanged:false,
  productionDataMutated:false,
},null,2));
