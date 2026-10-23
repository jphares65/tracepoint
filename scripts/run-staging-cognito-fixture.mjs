import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { applyStagingFixture } from './staging-cognito-fixture-core.mjs';

const action = process.argv[2];
const environmentName = process.argv[3];
const lockName = 'tracepoint:aws-native-schema-migrations:v1';
let operationStage = 'validate-fixture-action';

function safeFailureCode(error) {
  const code = String(error?.code ?? '');
  if (/^[0-9A-Z]{5}$/.test(code)) return code;
  if (/^(ECONN|EAI_|ETIMEDOUT|ENOTFOUND)/.test(code)) return code;
  if (error?.name === 'AssertionError') return 'FIXTURE_PRECONDITION_FAILED';
  return 'FIXTURE_RUNNER_FAILED';
}

function safeSchemaIdentifier(value) {
  const identifier = String(value ?? '');
  return /^[a-z_][a-z0-9_]{0,62}$/.test(identifier) ? identifier : undefined;
}

async function connectStaging() {
  if (environmentName !== 'staging' || process.env.CONFIGURATION_ENVIRONMENT !== 'staging' ||
      process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE !== 'aws-native' || process.env.TRACEPOINT_DATA_PROVIDER !== 'postgres') {
    throw new Error('Staging AWS-native PostgreSQL configuration is required.');
  }
  let secret;
  try { secret = JSON.parse(process.env.TRACEPOINT_DATABASE_SECRET_JSON ?? ''); }
  catch { throw new Error('Staging database secret is invalid.'); }
  const expectedHost = String(process.env.TRACEPOINT_EXPECTED_DATABASE_HOST ?? '').toLowerCase().replace(/\.$/, '');
  if (!expectedHost.includes('tracepoint-staging-full-aws') || secret.host?.toLowerCase().replace(/\.$/, '') !== expectedHost ||
      secret.port !== 5432 || secret.dbname !== 'tracepoint' || typeof secret.username !== 'string' || typeof secret.password !== 'string') {
    throw new Error('Staging fixture database target does not match the pinned staging instance.');
  }
  const caPath = process.env.TRACEPOINT_DATABASE_CA_PATH;
  if (!caPath?.startsWith('/app/') || !caPath.endsWith('.pem')) throw new Error('Staging database CA path is invalid.');
  const ca = await readFile(caPath, 'utf8');
  if (!ca.includes('BEGIN CERTIFICATE')) throw new Error('Staging database CA is invalid.');
  const client = new Client({
    host: secret.host, port: secret.port, user: secret.username, password: secret.password,
    database: secret.dbname, ssl: { ca, rejectUnauthorized: true, servername: secret.host },
    connectionTimeoutMillis: 10_000, statement_timeout: 60_000, application_name: 'tracepoint-staging-cognito-fixture',
  });
  await client.connect();
  return client;
}

let client;
try {
  if (!['create', 'cleanup'].includes(action)) throw new Error('Fixture action must be create or cleanup.');
  operationStage = 'connect-staging-database';
  client = await connectStaging();
  operationStage = 'acquire-fixture-lock';
  await client.query('select pg_advisory_lock(hashtext($1))', [lockName]);
  let manifest;
  try { manifest = JSON.parse(process.env.TRACEPOINT_ACCEPTANCE_FIXTURE_JSON ?? ''); }
  catch { throw new Error('Staging acceptance fixture manifest is invalid.'); }
  operationStage = action === 'create' ? 'seed-fixture-records' : 'remove-fixture-records';
  const report = await applyStagingFixture(client, action, manifest);
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(JSON.stringify({ stagingAcceptanceFixture: 'failed', stage: operationStage, failureCode: safeFailureCode(error), ...(safeSchemaIdentifier(error?.column) ? { column: safeSchemaIdentifier(error.column) } : {}), ...(safeSchemaIdentifier(error?.table) ? { table: safeSchemaIdentifier(error.table) } : {}), detailsSuppressed: true }));
  process.exitCode = 1;
} finally {
  if (client) {
    await client.query('select pg_advisory_unlock(hashtext($1))', [lockName]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
