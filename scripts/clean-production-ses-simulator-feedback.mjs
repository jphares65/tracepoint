import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const queue = 'https://sqs.us-east-1.amazonaws.com/193644343389/tracepoint-production-full-aws-ses-FeedbackDeadLetters07994F3B-ZeZ2FiIQ7uXv';
const expectedMessageId = '010001a0df40798a-4908b0ad-7b79-4e9e-861b-0e8836792046-000000';
const expectedTopic = 'arn:aws:sns:us-east-1:193644343389:tracepoint-production-ses-feedback';
const base = ['--profile', 'tracepoint-production', '--region', 'us-east-1', '--output', 'json'];
const aws = args => JSON.parse(execFileSync('aws', [...args, ...base], { encoding: 'utf8', maxBuffer: 5_000_000 }));
const apply = process.argv[2] === '--apply';
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && apply));
const before = aws(['sqs', 'get-queue-attributes', '--queue-url', queue,
  '--attribute-names', 'ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']).Attributes;
assert.equal(before.ApproximateNumberOfMessages, '1');
assert.equal(before.ApproximateNumberOfMessagesNotVisible, '0');
const messages = aws(['sqs', 'receive-message', '--queue-url', queue,
  '--max-number-of-messages', '1', '--wait-time-seconds', '1',
  '--visibility-timeout', apply ? '30' : '5']).Messages ?? [];
assert.equal(messages.length, 1);
const message = messages[0];
const sns = JSON.parse(message.Body);
assert.equal(sns.TopicArn, expectedTopic);
const ses = JSON.parse(sns.Message);
assert.equal(ses.mail?.messageId, expectedMessageId);
assert.equal(ses.eventType, 'Delivery');
assert.deepEqual(ses.mail?.destination, ['success@simulator.amazonses.com']);
assert.deepEqual(ses.delivery?.recipients, ['success@simulator.amazonses.com']);
const evidence = { status: apply ? 'SYNTHETIC_EVENT_DELETED' : 'EXACT_SYNTHETIC_EVENT_VERIFIED',
  eventType: ses.eventType, destinationClass: 'aws-ses-simulator-only',
  messageIdSha256: createHash('sha256').update(expectedMessageId).digest('hex'),
  snsTopicMatched: true, queueDepthBefore: 1 };
if (apply) aws(['sqs', 'delete-message', '--queue-url', queue, '--receipt-handle', message.ReceiptHandle]);
console.log(JSON.stringify(evidence));
