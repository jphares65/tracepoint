import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {correlateHistoricalLogs} from './historical-log-correlation-core.mjs';

const account = '559054714699', region = 'us-east-1';
const start = Date.parse('2026-09-06T12:06:35.000Z'), end = Date.parse('2026-09-06T12:06:55.000Z');
const env = {...process.env, AWS_REGION:region, AWS_DEFAULT_REGION:region, AWS_CLI_OUTPUT_ENCODING:'UTF-8'};
function aws(args) {
  return JSON.parse(execFileSync(process.platform === 'win32' ? 'aws.exe' : 'aws', [...args, '--region', region, '--output', 'json'], {env, encoding:'utf8', stdio:['ignore', 'pipe', 'ignore'], maxBuffer:8 * 1024 * 1024}));
}
const identity = aws(['sts', 'get-caller-identity']);
assert.equal(identity.Account, account);
assert.match(identity.Arn, /^arn:aws:sts::559054714699:assumed-role\/[^/]*TracePointMigrationStaging[^/]*\//);
const windowArgs = ['--start-time', String(start), '--end-time', String(end)];
const application = aws(['logs', 'filter-log-events', '--log-group-name', '/tracepoint/staging/application', ...windowArgs, '--filter-pattern', '?ERROR ?Error ?Unauthorized ?AccessDenied ?Exception']).events.map(event => ({
  timestamp:Number(event.timestamp),
  message:event.message,
  fingerprint:createHash('sha256').update(String(event.message ?? '')).digest('hex'),
}));
let wafEvents = [], wafEvidenceAuthorized = true;
try { wafEvents = aws(['logs', 'filter-log-events', '--log-group-name', 'aws-waf-logs-tracepoint-staging-requests', ...windowArgs]).events; }
catch { wafEvidenceAuthorized = false; }
const waf = wafEvents.map(event => {
  try { return JSON.parse(event.message); } catch { return null; }
}).filter(Boolean);
const result = correlateHistoricalLogs(application, waf, {wafEvidenceAuthorized});
console.log(JSON.stringify({account, region, kind:'historical-log-correlation', windowStart:new Date(start).toISOString(), windowEnd:new Date(end).toISOString(), ...result}, null, 2));
