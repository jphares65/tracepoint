import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const account = '193644343389';
const region = 'us-east-1';
const queue = `https://sqs.${region}.amazonaws.com/${account}/tracepoint-production-isolated-ses-proof-feedback`;
const topic = `arn:aws:sns:${region}:${account}:tracepoint-production-isolated-ses-proof-feedback`;
const worker = 'tracepoint-production-isolated-ses--Worker11F36D0F-NpSP0A9Gws4J';
const setName = 'tracepoint-production-isolated-ses-proof-20260926';
const expectedMessageId = process.env.TRACEPOINT_ISOLATED_SES_MESSAGE_ID;
const expectedMode = process.env.TRACEPOINT_ISOLATED_SES_PROOF_MODE;
const recipients = {
  success: 'success@simulator.amazonses.com',
  bounce: 'bounce@simulator.amazonses.com',
  complaint: 'complaint@simulator.amazonses.com',
};
const eventTypes = { success: 'Delivery', bounce: 'Bounce', complaint: 'Complaint' };

if (process.env.TRACEPOINT_ISOLATED_SES_FEEDBACK_PROCESS !== '20260926' ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(expectedMessageId ?? '') ||
    !Object.hasOwn(recipients, expectedMode)) {
  throw new Error('Exact isolated SES feedback processing guard required');
}

function aws(service, operation, args = []) {
  const output = execFileSync('aws', [service, operation, ...args,
    '--profile', 'tracepoint-production', '--region', region, '--output', 'json'],
  { encoding: 'utf8', maxBuffer: 2_000_000 });
  return output.trim() ? JSON.parse(output) : {};
}

const caller = aws('sts', 'get-caller-identity');
assert.equal(caller.Account, account);
const lambda = aws('lambda', 'get-function-configuration', ['--function-name', worker]);
assert.equal(lambda.State, 'Active');
assert.equal(lambda.Environment.Variables.TRACEPOINT_FEEDBACK_DATABASE_AUTHORITY, 'rehearsal');
assert.equal(lambda.Environment.Variables.TRACEPOINT_SES_FEEDBACK_TOPIC_ARN, topic);
assert.equal(lambda.Environment.Variables.TRACEPOINT_DATABASE_SECRET_ARN,
  `arn:aws:secretsmanager:${region}:${account}:secret:tracepoint/production/rehearsal/database-runtime-4272874f-uDq389`);

let processed = 0;
let validationNotices = 0;
for (let poll = 0; poll < 12 && processed === 0; poll += 1) {
  const response = aws('sqs', 'receive-message', [
    '--queue-url', queue, '--max-number-of-messages', '10',
    '--wait-time-seconds', '2', '--visibility-timeout', '45',
  ]);
  for (const item of response.Messages ?? []) {
    const sns = JSON.parse(item.Body);
    assert.equal(sns.Type, 'Notification');
    assert.equal(sns.TopicArn, topic);
    if (sns.Message === 'Successfully validated SNS topic for Amazon SES event publishing.') {
      aws('sqs', 'delete-message', ['--queue-url', queue, '--receipt-handle', item.ReceiptHandle]);
      validationNotices += 1;
      continue;
    }
    let ses;
    try { ses = JSON.parse(sns.Message); }
    catch { throw new Error('Unexpected proof-topic notification; left in queue'); }
    assert.equal(ses.mail?.messageId, expectedMessageId, 'Unexpected SES MessageId; left in queue');
    assert.equal(ses.eventType, eventTypes[expectedMode], 'Unexpected SES event type; left in queue');
    assert.deepEqual(ses.mail?.destination, [recipients[expectedMode]], 'Unexpected destination; left in queue');
    assert.deepEqual(ses.mail?.tags?.['ses:configuration-set'], [setName], 'Unexpected SES set; left in queue');

    const outputDirectory = mkdtempSync(join(tmpdir(), 'tracepoint-ses-proof-'));
    const outputFile = join(outputDirectory, 'lambda-response.json');
    try {
      const invocation = aws('lambda', 'invoke', [
        '--function-name', worker, '--cli-binary-format', 'raw-in-base64-out',
        '--payload', JSON.stringify({ Records: [{ messageId: item.MessageId, body: item.Body }] }),
        outputFile,
      ]);
      assert.equal(invocation.StatusCode, 200);
      assert(!invocation.FunctionError, 'Isolated worker failed; message left in queue');
      const result = JSON.parse(readFileSync(outputFile, 'utf8'));
      assert.deepEqual(result.batchItemFailures, [], 'Isolated worker rejected event; message left in queue');
    } finally {
      try { unlinkSync(outputFile); } catch { /* Lambda may have failed before writing. */ }
      rmdirSync(outputDirectory);
    }
    aws('sqs', 'delete-message', ['--queue-url', queue, '--receipt-handle', item.ReceiptHandle]);
    processed += 1;
    console.log(JSON.stringify({ event: 'ISOLATED_SES_FEEDBACK_WORKER_PASS',
      sesMessageId: expectedMessageId, eventType: ses.eventType,
      worker, proofQueueOnly: true, rehearsalAuthority: true }));
  }
}
if (processed !== 1) throw new Error(`Expected one exact feedback event; found ${processed}. Validation notices: ${validationNotices}.`);
