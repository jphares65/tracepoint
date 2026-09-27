import { readFileSync } from 'node:fs';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import pg from 'pg';
import { ManagedSesProvider } from '../src/lib/email/ses-managed-provider.ts';
import { PostgresSesFeedbackStore } from '../src/lib/email/ses-feedback-postgres.ts';

const account = '193644343389';
const region = 'us-east-1';
const secretArn = 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/rehearsal/database-runtime-4272874f-uDq389';
const host = 'tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const configurationSet = 'tracepoint-production-isolated-ses-proof-20260926';
const departmentId = '1d0e2994-4224-4237-8328-71020ba20027';
const destinations = {
  success: 'success@simulator.amazonses.com',
  bounce: 'bounce@simulator.amazonses.com',
  complaint: 'complaint@simulator.amazonses.com',
};
const mode = process.env.TRACEPOINT_ISOLATED_SES_PROOF_MODE;
let stage = 'environment';

async function main() {
  if (process.env.TRACEPOINT_ISOLATED_SES_APP_PROOF !== '20260926' ||
      process.env.TRACEPOINT_AWS_ACCOUNT_ID !== account ||
      process.env.AWS_REGION !== region || !Object.hasOwn(destinations, mode)) {
    throw new Error('ISOLATED_PROOF_GUARD_FAIL');
  }
  stage = 'ca';
  const ca = readFileSync('/app/rds-ca.pem', 'utf8');
  if (!ca.includes('BEGIN CERTIFICATE')) throw new Error('RDS_CA_FAIL');
  stage = 'secret';
  const manager = new SecretsManagerClient({ region, maxAttempts: 1 });
  const response = await manager.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const secret = JSON.parse(response.SecretString ?? 'null');
  if (secret?.host !== host || secret?.port !== 5432 || secret?.dbname !== 'tracepoint' ||
      secret?.username !== 'tracepoint_runtime' || typeof secret?.password !== 'string') {
    throw new Error('REHEARSAL_DATABASE_PIN_FAIL');
  }
  const pool = new pg.Pool({ host, port: 5432, user: secret.username, password: secret.password,
    database: 'tracepoint', ssl: { ca, rejectUnauthorized: true }, max: 1,
    connectionTimeoutMillis: 10000, statement_timeout: 30000 });
  try {
    stage = 'database_identity';
    const db = (await pool.query('select current_database() as database, current_user as role')).rows[0];
    if (db.database !== 'tracepoint' || db.role !== 'tracepoint_runtime') {
      throw new Error('REHEARSAL_DATABASE_ROLE_FAIL');
    }
    const department = await pool.query('select count(*)::int as count from public.departments where id=$1', [departmentId]);
    if (department.rows[0].count !== 1) throw new Error('REHEARSAL_TENANT_PIN_FAIL');
    stage = 'suppression_read';
    const store = new PostgresSesFeedbackStore(pool);
    const recipient = destinations[mode];
    if (await store.isSuppressed(recipient)) throw new Error('SIMULATOR_RECIPIENT_SUPPRESSED');
    stage = 'provider_send';
    const provider = new ManagedSesProvider({
      fromEmail: 'notifications@tracepointhq.com', configurationSet,
      transport: new SESv2Client({ region, maxAttempts: 1 }),
    }, store, departmentId);
    const accepted = await provider.send({
      to: [{ email: recipient }],
      subject: `TracePoint isolated SES application provider proof ${mode}`,
      textContent: 'Synthetic proof only. No customer data.',
      htmlContent: '<p>Synthetic proof only. No customer data.</p>',
    });
    stage = 'acceptance_verify';
    const mapped = await pool.query(
      'select count(*)::int as count from public.email_provider_acceptances where message_id=$1 and department_id=$2',
      [accepted.messageId, departmentId],
    );
    if (mapped.rows[0].count !== 1) throw new Error('ACCEPTANCE_MAPPING_MISSING');
    console.log(JSON.stringify({ event: 'ISOLATED_APP_SES_PROVIDER_ACCEPTED', mode,
      messageId: accepted.messageId, tenantPinned: true, tlsVerified: true,
      acceptanceRecorded: true, configurationSet }));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ event: 'ISOLATED_APP_SES_PROVIDER_FAILED', stage,
    errorType: error?.name ?? 'Error', status: error?.$metadata?.httpStatusCode,
    guard: /^(?:ISOLATED_|RDS_|REHEARSAL_|SIMULATOR_|ACCEPTANCE_)/.test(error?.message ?? '')
      ? error.message : undefined }));
  process.exitCode = 1;
});
