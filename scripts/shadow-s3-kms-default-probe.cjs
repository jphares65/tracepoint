// Fixed synthetic-only S3 proof for the isolated Phase 3B task role.
// Register as node -e in a one-shot task; never use the public task role.
const assert = require('node:assert/strict');
const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const region = 'us-east-1';
const owner = '193644343389';
const bucket = 'tracepoint-production-private-193644343389';
const key = 'attachments/d44d06e0-5010-48ce-ab94-944b9016ab3b/cutover-proof/20260926-kms-default-probe.txt';
const expectedKey = 'arn:aws:kms:us-east-1:193644343389:key/4dc71990-3cfa-49d7-88c6-383bc1067f55';
const body = Buffer.from('TracePoint isolated shadow KMS-default proof\n');
const client = new S3Client({ region });
let phase = 'create-only-put';

(async () => {
  const put = await client.send(new PutObjectCommand({
    Bucket: bucket, Key: key, ExpectedBucketOwner: owner,
    Body: body, ContentType: 'text/plain', IfNoneMatch: '*',
  }));
  assert.ok(put.VersionId && put.VersionId !== 'null');
  phase = 'head-after';
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key, ExpectedBucketOwner: owner }));
  assert.equal(head.ServerSideEncryption, 'aws:kms');
  assert.equal(head.SSEKMSKeyId, expectedKey);
  assert.equal(head.ContentLength, body.length);
  phase = 'read-back';
  const get = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, ExpectedBucketOwner: owner }));
  assert.equal(await get.Body.transformToString(), body.toString());
  console.log(JSON.stringify({ result: 'SHADOW_S3_KMS_DEFAULT_PASS', keyClass: 'synthetic-shadow-only',
    versionId: put.VersionId, kmsKeyMatched: true, sizeMatched: true, readBackMatched: true }));
})().catch(error => {
  console.error(JSON.stringify({ result: 'SHADOW_S3_KMS_DEFAULT_FAIL', phase,
    code: error.code || error.name || 'UNKNOWN', httpStatus: error.$metadata?.httpStatusCode ?? null }));
  process.exitCode = 1;
});
