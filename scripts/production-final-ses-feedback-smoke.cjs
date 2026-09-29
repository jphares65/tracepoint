// Synthetic SES simulator send through the final-RDS application authority.
// The only persisted recipient information is its SHA-256 hash.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readFileSync } = require('node:fs');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
const pg = require('pg');

const ACCOUNT = '193644343389';
const HOST = 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const DEPARTMENT = '1d0e2994-4224-4237-8328-71020ba20027';
const RECIPIENT = 'success@simulator.amazonses.com';
const CONFIGURATION_SET = 'tracepoint-production';
const recipientHash = crypto.createHash('sha256').update(RECIPIENT).digest('hex');
let phase = 'attestation';

async function main() {
  const mode = process.env.TRACEPOINT_FINAL_SES_SMOKE;
  assert.ok(mode === 'send' || mode === 'audit', 'SES_SMOKE_MODE_INVALID');
  assert.equal(process.env.TRACEPOINT_AWS_ACCOUNT_ID, ACCOUNT, 'SES_SMOKE_ACCOUNT_MISMATCH');
  const secret = JSON.parse(process.env.TRACEPOINT_DATABASE_SECRET_JSON ?? 'null');
  assert.equal(secret?.host, HOST, 'SES_SMOKE_RDS_HOST_MISMATCH');
  assert.equal(secret?.dbname, 'tracepoint', 'SES_SMOKE_RDS_DATABASE_MISMATCH');
  assert.equal(Number(secret?.port), 5432, 'SES_SMOKE_RDS_PORT_MISMATCH');
  assert.equal(secret?.username, 'tracepoint_runtime', 'SES_SMOKE_RDS_ROLE_MISMATCH');
  assert.ok(typeof secret?.password === 'string' && secret.password.length >= 20, 'SES_SMOKE_RDS_CREDENTIAL_MISSING');
  const ca = readFileSync('/app/rds-ca.pem', 'utf8');
  const db = new pg.Client({ host: HOST, port: 5432, database: 'tracepoint', user: secret.username,
    password: secret.password, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10000,
    statement_timeout: 30000, application_name: 'tracepoint-production-final-ses-smoke' });
  await db.connect();
  try {
    phase = 'database-identity';
    const identity = (await db.query("select current_database() as database,current_user as role,(select ssl from pg_stat_ssl where pid=pg_backend_pid()) as tls")).rows[0];
    assert.deepEqual(identity, { database: 'tracepoint', role: 'tracepoint_runtime', tls: true }, 'SES_SMOKE_RDS_IDENTITY_MISMATCH');
    if (mode === 'audit') {
      phase = 'feedback-audit';
      const messageId = process.env.TRACEPOINT_FINAL_SES_MESSAGE_ID;
      assert.match(messageId ?? '', /^[A-Za-z0-9_-]{1,256}$/, 'SES_SMOKE_MESSAGE_ID_MISSING');
      const row = await db.query(`select a.department_id,a.recipient_hashes,e.event_kind
        from public.email_provider_acceptances a left join public.email_provider_events e
          on e.message_id=a.message_id where a.message_id=$1`, [messageId]);
      assert.equal(row.rowCount, 1, 'SES_SMOKE_ACCEPTANCE_COUNT_MISMATCH');
      assert.equal(row.rows[0].department_id, DEPARTMENT, 'SES_SMOKE_TENANT_MISMATCH');
      assert.deepEqual(row.rows[0].recipient_hashes, [recipientHash], 'SES_SMOKE_RECIPIENT_HASH_MISMATCH');
      assert.equal(row.rows[0].event_kind, 'Delivery', 'SES_SMOKE_FEEDBACK_NOT_DELIVERED');
      console.log(JSON.stringify({ status: 'FINAL_SES_FEEDBACK_CORRELATED', acceptances: 1,
        deliveryEvents: 1, tenantPinned: true, tlsVerified: true, sourceMutation: false }));
      return;
    }
    phase = 'suppression';
    const suppressed = await db.query('select 1 from public.email_suppressions where recipient_hash=$1', [recipientHash]);
    assert.equal(suppressed.rowCount, 0, 'SES_SMOKE_SIMULATOR_SUPPRESSED');
    phase = 'tenant-preflight';
    await db.query('begin');
    try {
      const probe = await db.query(`insert into public.email_provider_acceptances(message_id,department_id,recipient_hashes)
        values($1,$2,$3) returning message_id`, [`preflight_${crypto.randomUUID().replaceAll('-', '')}`, DEPARTMENT, [recipientHash]]);
      assert.equal(probe.rowCount, 1, 'SES_SMOKE_TENANT_FK_FAILED');
    } finally { await db.query('rollback'); }
    phase = 'ses-send';
    const ses = new SESv2Client({ region: 'us-east-1', maxAttempts: 1 });
    let messageId;
    try {
      const response = await ses.send(new SendEmailCommand({
        FromEmailAddress: 'TracePoint <notifications@tracepointhq.com>',
        ConfigurationSetName: CONFIGURATION_SET,
        Destination: { ToAddresses: [RECIPIENT] },
        Content: { Simple: {
          Subject: { Data: 'TracePoint final cutover synthetic delivery proof', Charset: 'UTF-8' },
          Body: { Text: { Data: 'Synthetic SES simulator proof only. No customer data.', Charset: 'UTF-8' },
            Html: { Data: '<p>Synthetic SES simulator proof only. No customer data.</p>', Charset: 'UTF-8' } },
        } },
      }));
      messageId = response.MessageId;
    } finally { ses.destroy(); }
    assert.match(messageId ?? '', /^[A-Za-z0-9_-]{1,256}$/, 'SES_SMOKE_ACCEPTANCE_ID_INVALID');
    phase = 'acceptance-record';
    const accepted = await db.query(`insert into public.email_provider_acceptances(message_id,department_id,recipient_hashes)
      values($1,$2,$3) on conflict(message_id) do update set message_id=excluded.message_id
      where email_provider_acceptances.department_id=excluded.department_id
        and email_provider_acceptances.recipient_hashes=excluded.recipient_hashes returning message_id`,
    [messageId, DEPARTMENT, [recipientHash]]);
    assert.equal(accepted.rowCount, 1, 'SES_SMOKE_ACCEPTANCE_PERSISTENCE_FAILED');
    console.log(JSON.stringify({ status: 'FINAL_SES_SIMULATOR_ACCEPTED', messageId,
      configurationSet: CONFIGURATION_SET, acceptanceRecorded: true, tenantPinned: true,
      recipientIsSimulator: true, tlsVerified: true, sourceMutation: false }));
  } finally { await db.end().catch(() => {}); }
}
if (['send', 'audit'].includes(process.env.TRACEPOINT_FINAL_SES_SMOKE)) {
  main().catch(error => {
    const code = String(error?.message ?? '').split(/\r?\n/, 1)[0];
    console.error(JSON.stringify({ status: 'FINAL_SES_SMOKE_FAILED', phase,
      code: /^[A-Z_]+$/.test(code) ? code : 'FAIL_CLOSED', errorClass: String(error?.code ?? error?.name ?? 'Error') }));
    process.exitCode = 1;
  });
}
