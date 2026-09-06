import assert from 'node:assert/strict';
import {test} from 'node:test';
import {operationsEvidence} from './staging-operations-evidence.mjs';
test('only whitelisted runtime and cost evidence survives raw workflow logs',()=>{
 const runtime={account:'559054714699',region:'us-east-1',imageTag:'a'.repeat(40),ecs:{running:1,revision:18,completed:true},logs:{matchingErrors:0,message:'sensitive'},public:[{route:'/login',status:200,passed:true,token:'sensitive'}],alarms:[{name:'tracepoint-staging-cpu',state:'OK'}],passed:true,secret:'sensitive'};
 const cost={account:'559054714699',region:'us-east-1',queriedAtUTC:'2026-09-06T12:00:00.000Z',budgetActualUSD:2,budgetLimitUSD:75,withinCeiling:true,costExplorer:{available:false,reason:'sensitive'}};
 const reports=operationsEvidence('raw sensitive text\n'+JSON.stringify(runtime,null,2)+'\n'+JSON.stringify(cost,null,2));assert.equal(reports.length,2);assert.equal(reports[0].ecs.revision,18);assert.equal(reports[1].costExplorer.available,false);assert.equal(JSON.stringify(reports).includes('sensitive'),false);
});
test('unrecognized and foreign-account objects cannot become staging evidence',()=>{
 assert.deepEqual(operationsEvidence(JSON.stringify({account:'265544358665',region:'us-east-1',ecs:{running:1}},null,2)),[]);
 assert.deepEqual(operationsEvidence('{\n invalid JSON\n}\n'+JSON.stringify({secret:'sensitive'},null,2)),[]);
});
