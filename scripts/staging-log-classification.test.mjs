import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classifyStagingLogs} from './staging-log-classification.mjs';
test('log diagnostics preserve counts and times without recording messages',()=>{
 const now=Date.now(),report=classifyStagingLogs([{message:'Error: Failed to find Server Action "synthetic"',timestamp:now-7200000},{message:'Error: EACCES synthetic',timestamp:now},{message:'unrecognized sensitive fixture',timestamp:now}],now);
 assert.equal(report.total,3);assert.equal(report.recent60Minutes,2);assert.equal(report.categories['server-action-request-rejected'],1);assert.equal(report.categories.filesystem,1);assert.equal(report.categories.unclassified,1);assert.match(report.unknownFingerprints[0],/^[0-9a-f]{64}$/);assert.equal(JSON.stringify(report).includes('sensitive'),false);
});
test('authorization, configuration, database and network failures remain distinct',()=>{
 const report=classifyStagingLogs(['AccessDenied','configuration missing','PGRST database error','JWT invalid','fetch failed','heap limit','NEXT_REDIRECT'].map(message=>({message,timestamp:Date.now()})));
 for(const category of ['aws-authorization','configuration','database-or-connection','authentication','network','memory','next-control-flow'])assert.equal(report.categories[category],1);
});
test('unknown error features contain only fixed technical terms',()=>{
 const report=classifyStagingLogs([{message:'TypeError: undefined workers sensitive fixture',timestamp:Date.now()}]);assert.deepEqual(report.unknownFeatures[0].features,['TypeError','undefined','workers']);assert.equal(JSON.stringify(report).includes('sensitive'),false);
});
test('transport diagnostics tolerate capitalization without exposing message content',()=>{
 const report=classifyStagingLogs([{message:'Error: Connection CLOSED sensitive fixture',timestamp:Date.now()}]);assert.deepEqual(report.unknownFeatures[0].features,['connection','closed']);assert.equal(JSON.stringify(report).includes('sensitive'),false);
});
