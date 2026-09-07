import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {validateProductionTarget, type ProductionTarget} from '../infra/lib/production-target.ts';
import {evaluateProductionLiveReadiness} from './production-live-readiness-core.mjs';

const args = process.argv.slice(2);
const configIndex = args.indexOf('--config');
assert.ok(configIndex >= 0 && args[configIndex + 1], 'Reviewed non-secret production target file required');
const target: ProductionTarget = validateProductionTarget(
  JSON.parse(readFileSync(args[configIndex + 1], 'utf8').replace(/^\uFEFF/, '')),
  {offline: true},
);
const region = 'us-east-1';
const env = {...process.env, AWS_REGION:region, AWS_DEFAULT_REGION:region, AWS_CLI_OUTPUT_ENCODING:'UTF-8'};
function aws(commandArgs: string[]) {
  return JSON.parse(execFileSync(process.platform === 'win32' ? 'aws.exe' : 'aws', [...commandArgs, '--region', region, '--output', 'json'], {
    env,
    encoding:'utf8',
    stdio:['ignore', 'pipe', 'ignore'],
    maxBuffer:8 * 1024 * 1024,
  }));
}
function optional(commandArgs: string[], fallback: unknown) {
  try { return aws(commandArgs); } catch { return fallback; }
}

const identity = aws(['sts', 'get-caller-identity']);
const availabilityZones = aws(['ec2', 'describe-availability-zones', '--zone-names', 'us-east-1a', 'us-east-1b']).AvailabilityZones;
const certificate = optional(['acm', 'describe-certificate', '--certificate-arn', target.certificateArn], {}).Certificate;
const secretMetadata = optional(['secretsmanager', 'describe-secret', '--secret-id', 'tracepoint/production/application'], {});
const trailList = optional(['cloudtrail', 'describe-trails', '--include-shadow-trails', 'false'], {trailList:[]}).trailList ?? [];
const cloudTrails = trailList.map((trail: {TrailARN?: string}) => ({
  IsLogging: trail.TrailARN ? optional(['cloudtrail', 'get-trail-status', '--name', trail.TrailARN], {}).IsLogging === true : false,
}));
const recorderStatus = optional(['configservice', 'describe-configuration-recorder-status'], {ConfigurationRecordersStatus:[]}).ConfigurationRecordersStatus ?? [];
const configurationRecorders = recorderStatus.map((recorder: {recording?: boolean}) => ({recording: recorder.recording === true}));
const detectorIds = optional(['guardduty', 'list-detectors'], {DetectorIds:[]}).DetectorIds ?? [];
const guardDutyDetectors = detectorIds.map((detectorId: string) => ({
  Status: optional(['guardduty', 'get-detector', '--detector-id', detectorId], {}).Status,
}));
const securityHubEnabled = Boolean(optional(['securityhub', 'describe-hub'], {}).HubArn);
const policies = optional(['organizations', 'list-policies-for-target', '--target-id', target.account, '--filter', 'SERVICE_CONTROL_POLICY'], null);
const budgetResponse = optional(['budgets', 'describe-budgets', '--account-id', target.account, '--max-results', '100'], {Budgets:[]});

const report = evaluateProductionLiveReadiness({
  account:target.account,
  region,
  certificateArn:target.certificateArn,
  identity,
  availabilityZones,
  certificate,
  secretMetadata,
  cloudTrails,
  configurationRecorders,
  guardDutyDetectors,
  securityHubEnabled,
  effectiveGuardrailsAuthorized:policies !== null,
  attachedScpCount:policies?.Policies?.length ?? null,
  budgets:budgetResponse.Budgets ?? [],
});
console.log(JSON.stringify({...report, checkedAt:new Date().toISOString()}, null, 2));
if (!report.passed) process.exitCode = 1;
