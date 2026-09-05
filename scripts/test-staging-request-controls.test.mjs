import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRequestControlProof} from './test-staging-request-controls.mjs';
test('enforcement requires recent isolated count evidence and redaction proof',()=>{const p={account:'559054714699',region:'us-east-1',origin:'https://staging.tracepointhq.com',mode:'count',loggingRedactionVerified:true,probeAllowed:true,countedRequests:10,normalRoutesHealthy:true,completedAt:new Date().toISOString()};validateRequestControlProof(p);for(const change of [{account:'265544358665'},{mode:'enforce'},{countedRequests:0},{loggingRedactionVerified:false},{normalRoutesHealthy:false},{completedAt:'2020-01-01'}])assert.throws(()=>validateRequestControlProof({...p,...change}));});
