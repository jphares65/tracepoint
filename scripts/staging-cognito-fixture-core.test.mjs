import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { applyStagingFixture, validateStagingFixtureManifest } from './staging-cognito-fixture-core.mjs';
import { totp } from './staging-cognito-login.mjs';

const run = 'c30a4084-6487-4c42-9d6f-83fd1df935a8';
const manifest = {
  environment: 'staging', run, poolId: 'us-east-1_Y9GiDA5Zy',
  issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Y9GiDA5Zy',
  agencies: [0, 1].map(index => ({ id: `00000000-0000-4000-8000-00000000000${index + 1}`, slug: `acceptance-${run}-${index}` })),
  users: ['officer', 'instructor', 'supervisor', 'administrator', 'foreign'].map((role, index) => {
    const email = `acceptance-${run}-${role}@example.invalid`;
    return { id: `10000000-0000-4000-8000-00000000000${index + 1}`, subject: `20000000-0000-4000-8000-00000000000${index + 1}`, username: email, email, fullName: `Staging Acceptance ${role}`, role: role === 'foreign' ? 'officer' : role, agencyIndex: role === 'foreign' ? 1 : 0 };
  }),
};

test('accepts five Cognito identities across two agencies with all four primary roles', () => {
  assert.equal(validateStagingFixtureManifest(manifest, 'create'), manifest);
});

test('rejects production, role drift, cross-run slugs, and embedded credentials', () => {
  assert.throws(() => validateStagingFixtureManifest({ ...manifest, environment: 'production' }, 'create'), /staging-only/);
  assert.throws(() => validateStagingFixtureManifest({ ...manifest, agencies: [{ ...manifest.agencies[0], slug: 'production' }, manifest.agencies[1]] }, 'create'), /bound to this run/);
  assert.throws(() => validateStagingFixtureManifest({ ...manifest, users: manifest.users.map((user, index) => index ? user : { ...user, role: 'chief' }) }, 'create'), /Unsupported fixture role/);
  assert.throws(() => validateStagingFixtureManifest({ ...manifest, password: 'secret' }, 'create'), /Authentication secrets/);
});

test('pins all fixture SQL to the configured staging database host before connecting to fixture rows', async () => {
  let statements = 0;
  const client = { async query() { statements += 1; return { rows: [], rowCount: 0 }; } };
  await assert.rejects(applyStagingFixture(client, 'create', manifest, {
    CONFIGURATION_ENVIRONMENT: 'staging', TRACEPOINT_RUNTIME_PROVIDER_MODE: 'aws-native',
    TRACEPOINT_EXPECTED_DATABASE_HOST: 'wrong-host', TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ host: 'wrong-host' }),
  }), /pinned staging instance/);
  assert.equal(statements, 0);
});

test('creates only the declared agencies, identities, memberships, roles, and equipment entitlement in one transaction', async () => {
  const statements = [];
  const client = { async query(sql) {
    statements.push(sql);
    if (sql.includes('select id from public.departments')) return { rows: [], rowCount: 0 };
    if (sql.includes('select code from public.feature_catalog')) return { rows: [{ code: 'equipment_readiness' }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  } };
  const result = await applyStagingFixture(client, 'create', manifest, {
    CONFIGURATION_ENVIRONMENT: 'staging', TRACEPOINT_RUNTIME_PROVIDER_MODE: 'aws-native',
    TRACEPOINT_EXPECTED_DATABASE_HOST: 'tracepoint-staging-full-aws.abc.us-east-1.rds.amazonaws.com',
    TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ host: 'tracepoint-staging-full-aws.abc.us-east-1.rds.amazonaws.com' }),
  });
  assert.equal(result.agencies, 2);
  assert.equal(result.users, 5);
  assert.equal(statements[0], 'begin');
  assert.equal(statements.at(-1), 'commit');
  assert.equal(statements.filter(sql => sql.includes('insert into public.departments')).length, 2);
  assert.equal(statements.filter(sql => sql.includes('insert into auth.users')).length, 5);
  assert.equal(statements.filter(sql => sql.includes('insert into public.department_membership_roles')).length, 5);
  assert.ok(statements.every(sql => !/^\s*(alter|create|drop)\b/i.test(sql)));
});

test('cleanup is idempotent for the same completed run', async () => {
  const statements = [];
  const client = { async query(sql) {
    statements.push(sql);
    if (sql.includes('select\n    (select count(*) from public.departments')) return { rows: [{ agencies: 0, profiles: 0, identities: 0 }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  } };
  const result = await applyStagingFixture(client, 'cleanup', manifest, {
    CONFIGURATION_ENVIRONMENT: 'staging', TRACEPOINT_RUNTIME_PROVIDER_MODE: 'aws-native',
    TRACEPOINT_EXPECTED_DATABASE_HOST: 'tracepoint-staging-full-aws.abc.us-east-1.rds.amazonaws.com',
    TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ host: 'tracepoint-staging-full-aws.abc.us-east-1.rds.amazonaws.com' }),
  });
  assert.equal(result.action, 'cleanup');
  assert.equal(statements.includes('commit'), true);
});

test('computes RFC 6238 six-digit software-token codes', () => {
  assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000), '287082');
});

test('migration runner image copies its local fixture module dependency', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /COPY --chown=nonroot:nonroot scripts\/run-staging-cognito-fixture\.mjs scripts\/staging-cognito-fixture-core\.mjs \.\/scripts\//);
});
