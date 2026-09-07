import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evaluateProductionLiveReadiness} from './production-live-readiness-core.mjs';

const now = Date.parse('2026-09-06T00:00:00.000Z');
const account = '222222222222';
const certificateArn = `arn:aws:acm:us-east-1:${account}:certificate/00000000-0000-4000-8000-000000000000`;
function valid() {
  return {
    account,
    region:'us-east-1',
    certificateArn,
    identity:{Account:account, Arn:`arn:aws:sts::${account}:assumed-role/TracePointMigrationProduction/readiness`},
    availabilityZones:[
      {ZoneName:'us-east-1a', RegionName:'us-east-1', State:'available'},
      {ZoneName:'us-east-1b', RegionName:'us-east-1', State:'available'},
    ],
    certificate:{CertificateArn:certificateArn, DomainName:'tracepointhq.com', Status:'ISSUED', KeyAlgorithm:'RSA_2048', NotAfter:'2027-09-06T00:00:00.000Z', DomainValidationOptions:[{ValidationStatus:'SUCCESS'}]},
    secretMetadata:{Name:'tracepoint/production/application', KmsKeyId:`arn:aws:kms:us-east-1:${account}:key/00000000-0000-4000-8000-000000000000`},
    cloudTrails:[{IsLogging:true}],
    configurationRecorders:[{recording:true}],
    guardDutyDetectors:[{Status:'ENABLED'}],
    securityHubEnabled:true,
    effectiveGuardrailsAuthorized:true,
    attachedScpCount:2,
    budgets:[{BudgetName:'tracepoint-production-monthly', BudgetType:'COST', BudgetLimit:{Amount:'150', Unit:'USD'}}],
  };
}

test('accepts only a complete read-only production account baseline', () => {
  const report = evaluateProductionLiveReadiness(valid(), now);
  assert.equal(report.passed, true);
  assert.equal(report.secretValueRead, false);
  assert.equal(report.mutationsPerformed, false);
});

test('reports each absent live capability without granting partial completion', () => {
  for (const change of [
    {identity:null},
    {availabilityZones:[]},
    {certificate:{}},
    {secretMetadata:{}},
    {cloudTrails:[]},
    {configurationRecorders:[]},
    {guardDutyDetectors:[]},
    {securityHubEnabled:false},
    {effectiveGuardrailsAuthorized:false},
    {budgets:[]},
  ]) assert.equal(evaluateProductionLiveReadiness({...valid(), ...change}, now).passed, false);
});

test('rejects management, staging, wrong-region and expired certificate targets', () => {
  for (const change of [{account:'265544358665'}, {account:'559054714699'}, {region:'us-west-2'}]) {
    assert.throws(() => evaluateProductionLiveReadiness({...valid(), ...change}, now));
  }
  const input = valid();
  input.certificate.NotAfter = '2026-09-20T00:00:00.000Z';
  assert.equal(evaluateProductionLiveReadiness(input, now).certificateVerified, false);
});
