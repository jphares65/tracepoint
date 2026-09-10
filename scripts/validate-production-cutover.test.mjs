import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCutover} from './validate-production-cutover.mjs';
const gates=Object.fromEntries(['accountIdentityVerified','certificateIssued','secretValidated','imageScanPassed','authenticatedAcceptancePassed','alarmsDelivered','backupRestoreRehearsed','rollbackRehearsed','costApproved','dnsRecordsCaptured','agencyApproval','schemaCompatibilityVerified','productionClientBuildVerified'].map(k=>[k,true]));
const valid={account:'222222222222',region:'us-east-1',roleArn:'arn:aws:iam::222222222222:role/TracePointMigrationProduction',imageDigest:'sha256:'+'a'.repeat(64),rollbackImageDigest:'sha256:'+'b'.repeat(64),hostname:'tracepointhq.com',certificateArn:'arn:aws:acm:us-east-1:222222222222:certificate/example',dataMode:'retain-production-providers',gates};
test('retired hybrid production cutover always fails closed',()=>{
 assert.throws(()=>validateCutover(valid),/hybrid cutover validator is retired/);
});
