// Run only as a one-shot override of the digest-pinned no-traffic proof task.
// Never log credentials, customer rows, token material, or message content.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Client } = require('pg');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const account = '193644343389';
const region = 'us-east-1';
const bucket = `tracepoint-production-private-${account}`;
const host = 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const kmsKey = `arn:aws:kms:${region}:${account}:key/4dc71990-3cfa-49d7-88c6-383bc1067f55`;
const pool = 'us-east-1_diFmWDMe9';
const prefix = 'attachments/00000000-0000-4000-8000-000000000001/cutover-proof/';
const body = Buffer.from('TracePoint isolated no-traffic AWS-native proof\n');
const phase = { current: 'configuration' };
const result = { database: false, tls: false, read: false, rollbackWrite: false,
  s3: false, kms: false, cognitoTarget: false, sesSimulator: false, s3Delete: false };
let key;

async function run() {
  assert.equal(process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE, 'aws-native');
  assert.equal(process.env.TRACEPOINT_DATA_PROVIDER, 'postgres');
  assert.equal(process.env.TRACEPOINT_STORAGE_PROVIDER, 's3');
  assert.equal(process.env.TRACEPOINT_AUTH_PROVIDER, 'cognito');
  assert.equal(process.env.TRACEPOINT_EMAIL_PROVIDER, 'ses');
  assert.equal(process.env.TRACEPOINT_NOTIFICATION_MODE, 'normal');
  assert.equal(process.env.NEXT_PUBLIC_SITE_URL, 'https://tracepointhq.com');
  assert.equal(process.env.TRACEPOINT_S3_BUCKET, bucket);
  assert.equal(process.env.TRACEPOINT_COGNITO_USER_POOL_ID, pool);
  assert.equal(process.env.TRACEPOINT_COGNITO_CLIENT_ID, '9tfp383dgjuvanhnh94bstafr');
  assert.equal(process.env.TRACEPOINT_SES_CONFIGURATION_SET, 'tracepoint-production');
  assert.equal(process.env.TRACEPOINT_FROM_EMAIL, 'notifications@tracepointhq.com');
  assert.equal(process.env.AWS_REGION, region);
  assert.ok(!process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const db = JSON.parse(process.env.TRACEPOINT_DATABASE_SECRET_JSON);
  assert.equal(db.host, host);
  assert.equal(db.dbname, 'tracepoint');
  assert.equal(db.port, 5432);
  const ca = fs.readFileSync('/app/rds-ca.pem', 'utf8');
  assert.match(ca, /BEGIN CERTIFICATE/);

  phase.current = 'postgres-tls-read-and-rollback-write';
  const client = new Client({ host: db.host, port: db.port, user: db.username,
    password: db.password, database: db.dbname, ssl: { ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 10000, statement_timeout: 30000 });
  try {
    await client.connect();
    assert.equal(client.connection.stream.encrypted, true);
    result.tls = true;
    const identity = await client.query('select current_database() as database, current_user as db_user');
    assert.equal(identity.rows[0].database, 'tracepoint');
    result.database = true;
    // The runtime login role must not read tenant tables without an authenticated
    // subject. Catalog metadata is the safe unauthenticated connectivity probe.
    const count = await client.query("select count(*)::integer as count from pg_catalog.pg_class where relnamespace = 'public'::regnamespace");
    assert.ok(Number.isInteger(count.rows[0].count) && count.rows[0].count > 0);
    result.read = true;
    await client.query('begin');
    await client.query('create temporary table tracepoint_native_proof (id integer primary key, label text not null) on commit drop');
    await client.query("insert into tracepoint_native_proof (id, label) values (1, 'synthetic')");
    const readBack = await client.query('select count(*)::integer as count from tracepoint_native_proof where id = 1 and label = $1', ['synthetic']);
    assert.equal(readBack.rows[0].count, 1);
    await client.query('rollback');
    result.rollbackWrite = true;
  } finally { await client.end(); }

  phase.current = 's3-kms-create-read-delete';
  key = `${prefix}${Date.now()}-${require('node:crypto').randomUUID()}.txt`;
  const s3 = new S3Client({ region });
  const put = await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key,
    ExpectedBucketOwner: account, Body: body, ContentType: 'text/plain', IfNoneMatch: '*' }));
  assert.ok(put.VersionId && put.VersionId !== 'null');
  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key, ExpectedBucketOwner: account }));
  assert.equal(head.ServerSideEncryption, 'aws:kms');
  assert.equal(head.SSEKMSKeyId, kmsKey);
  assert.equal(head.ContentLength, body.length);
  result.kms = true;
  const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, ExpectedBucketOwner: account }));
  assert.equal(await got.Body.transformToString(), body.toString());
  result.s3 = true;
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, ExpectedBucketOwner: account }));
  result.s3Delete = true;

  console.log(JSON.stringify({ status: 'PASS', result, target: 'isolated-no-traffic-proof',
    s3Class: 'synthetic-cutover-proof', sesRecipientClass: 'not-yet-tested' }));
}

run().catch(error => {
  console.error(JSON.stringify({ status: 'FAIL', phase: phase.current, result,
    code: error.code || error.name || 'UNKNOWN', httpStatus: error.$metadata?.httpStatusCode ?? null }));
  process.exitCode = 1;
});
