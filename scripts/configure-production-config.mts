import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {evaluateProductionConfig, productionConfigDefinition} from './production-config-core.mjs';

const account = '193644343389';
const region = 'us-east-1';
const profileIndex = process.argv.indexOf('--profile');
const profileArgs = profileIndex >= 0 ? ['--profile', process.argv[profileIndex + 1]] : [];
if (profileIndex >= 0) assert.ok(process.argv[profileIndex + 1], '--profile requires a value');
const common = ['--region', region, ...profileArgs];
function aws(args: string[], json = true) {
  const output = execFileSync(process.platform === 'win32' ? 'aws.exe' : 'aws', [...args, ...common, ...(json ? ['--output', 'json'] : [])], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024,
  });
  return json ? JSON.parse(output || '{}') : undefined;
}

const identity = aws(['sts', 'get-caller-identity']);
assert.equal(identity.Account, account, 'Exact production account required');
assert.match(identity.Arn, new RegExp(`^arn:aws:sts::${account}:assumed-role/TracePointMigrationProduction/[^/]+$`), 'Exact production role required');
const desired = productionConfigDefinition(account);
aws(['configservice', 'put-configuration-recorder', '--configuration-recorder', JSON.stringify(desired.recorder)], false);
aws(['configservice', 'put-delivery-channel', '--delivery-channel', JSON.stringify(desired.channel)], false);
aws(['configservice', 'start-configuration-recorder', '--configuration-recorder-name', desired.recorder.name], false);

let state = {recorderMatches: false, channelMatches: false, recording: false};
for (let attempt = 0; attempt < 30; attempt += 1) {
  state = evaluateProductionConfig({
    recorders: aws(['configservice', 'describe-configuration-recorders']).ConfigurationRecorders,
    channels: aws(['configservice', 'describe-delivery-channels']).DeliveryChannels,
    statuses: aws(['configservice', 'describe-configuration-recorder-status']).ConfigurationRecordersStatus,
  }, account);
  if (state.recording) break;
  await new Promise(resolve => setTimeout(resolve, 5000));
}
assert.deepEqual(state, {recorderMatches: true, channelMatches: true, recording: true});
console.log(JSON.stringify({...state, account, region, secretValueRead: false}, null, 2));
