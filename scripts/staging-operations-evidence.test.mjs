import assert from 'node:assert/strict';
import {test} from 'node:test';
import {operationsEvidence} from './staging-operations-evidence.mjs';
test('only whitelisted runtime and cost evidence survives raw workflow logs',()=>{
 const runtime={account:'559054714699',region:'us-east-1',imageTag:'a'.repeat(40),ecs:{running:1,revision:18,completed:true},logs:{matchingErrors:3,recentMatchingErrors:0,evaluationWindowMinutes:60,filesystemPermissionErrors:0,message:'sensitive'},public:[{route:'/login',status:200,passed:true,token:'sensitive'}],alarms:[{name:'tracepoint-staging-cpu',state:'OK'}],passed:true,secret:'sensitive'};
 const cost={account:'559054714699',region:'us-east-1',queriedAtUTC:'2026-09-06T12:00:00.000Z',budgetActualUSD:2,budgetLimitUSD:75,withinCeiling:true,costExplorer:{available:false,reason:'sensitive'}};
 const reports=operationsEvidence('raw sensitive text\n'+JSON.stringify(runtime,null,2)+'\n'+JSON.stringify(cost,null,2));assert.equal(reports.length,2);assert.equal(reports[0].ecs.revision,18);assert.deepEqual(reports[0].logs,{matchingErrors:3,recentMatchingErrors:0,evaluationWindowMinutes:60,filesystemPermissionErrors:0,currentTaskOnly:false});assert.equal(reports[1].costExplorer.available,false);assert.equal(JSON.stringify(reports).includes('sensitive'),false);
});
test('unrecognized and foreign-account objects cannot become staging evidence',()=>{
 assert.deepEqual(operationsEvidence(JSON.stringify({account:'265544358665',region:'us-east-1',ecs:{running:1}},null,2)),[]);
 assert.deepEqual(operationsEvidence('{\n invalid JSON\n}\n'+JSON.stringify({secret:'sensitive'},null,2)),[]);
});
test('log diagnostics retain only approved categories and fingerprints',()=>{
 const value={account:'559054714699',region:'us-east-1',kind:'log-diagnostics',revision:18,messagesPrinted:false,classification:{total:1,recent60Minutes:0,categories:{'server-action-request-rejected':1,sensitive:2},unknownFingerprints:['a'.repeat(64),'sensitive'],unknownFeatures:[{fingerprint:'a'.repeat(64),features:['TypeError','sensitive']}],message:'sensitive'}};
 const reports=operationsEvidence(JSON.stringify(value,null,2));assert.equal(reports.length,1);assert.equal(reports[0].classification.total,1);assert.equal(JSON.stringify(reports).includes('sensitive'),false);
});
test('classification embedded in the runtime report is extracted without another AWS read',()=>{
 const value={account:'559054714699',region:'us-east-1',imageTag:'a'.repeat(40),ecs:{revision:18},logClassification:{total:10,recent60Minutes:0,categories:{'server-action-request-rejected':10},unknownFingerprints:[]}};
 const reports=operationsEvidence(JSON.stringify(value,null,2));assert.equal(reports.length,2);assert.equal(reports[1].kind,'log-diagnostics');assert.equal(reports[1].classification.total,10);
});
test('historical correlation keeps only timing, counts and fingerprints',()=>{
 const value={account:'559054714699',region:'us-east-1',kind:'historical-log-correlation',windowStart:'2026-09-06T12:06:35.000Z',windowEnd:'2026-09-06T12:06:55.000Z',application:{total:2,categories:{unclassified:2,sensitive:1},unknownFingerprints:['a'.repeat(64),'sensitive'],firstAt:'2026-09-06T12:06:43.605Z',lastAt:'2026-09-06T12:06:45.833Z'},waf:{total:10,requestActions:{ALLOW:10,sensitive:1},requestsWithNextActionHeader:8},unknownCorrelation:[{fingerprint:'a'.repeat(64),nearestWafRequestMilliseconds:5},{fingerprint:'sensitive',nearestWafRequestMilliseconds:1}],messagesPrinted:false,raw:'sensitive'};
 const reports=operationsEvidence(JSON.stringify(value,null,2));assert.equal(reports.length,1);assert.equal(reports[0].waf.total,10);assert.deepEqual(reports[0].unknownCorrelation,[{fingerprint:'a'.repeat(64),nearestWafRequestMilliseconds:5}]);assert.equal(JSON.stringify(reports).includes('sensitive'),false);
});
