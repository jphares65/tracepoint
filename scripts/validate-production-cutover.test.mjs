import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCutover} from './validate-production-cutover.mjs';
const gates=Object.fromEntries(['accountIdentityVerified','certificateIssued','secretValidated','imageScanPassed','authenticatedAcceptancePassed','alarmsDelivered','backupRestoreRehearsed','rollbackRehearsed','costApproved','dnsRecordsCaptured','agencyApproval','schemaCompatibilityVerified','productionClientBuildVerified'].map(k=>[k,true]));
const valid={account:'222222222222',region:'us-east-1',roleArn:'arn:aws:iam::222222222222:role/TracePointMigrationProduction',imageDigest:'sha256:'+'a'.repeat(64),rollbackImageDigest:'sha256:'+'b'.repeat(64),hostname:'tracepointhq.com',certificateArn:'arn:aws:acm:us-east-1:222222222222:certificate/example',dataMode:'retain-production-providers',gates};
test('production preflight requires each gate and never authorizes execution',()=>{
 assert.equal(validateCutover(valid).executionAuthorized,false);
 for(const gate of Object.keys(gates))assert.throws(()=>validateCutover({...valid,gates:{...gates,[gate]:false}}));
});
test('production preflight denies staging, management, placeholders, cross-account roles and data transfer',()=>{
 for(const account of ['265544358665','559054714699','111111111111',''])assert.throws(()=>validateCutover({...valid,account}));
 for(const change of [{region:'us-west-2'},{roleArn:'arn:aws:iam::559054714699:role/TracePointMigrationProduction'},{dataMode:'copy-production'},{imageDigest:'latest'}])assert.throws(()=>validateCutover({...valid,...change}));
});
