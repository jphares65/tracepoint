import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { applyStagingFixture, isStagingAcceptanceUser, sanitizeFixturePostgresDiagnostic, validateStagingFixtureManifest } from './staging-cognito-fixture-core.mjs';
import { totp } from './staging-cognito-login.mjs';

const run = 'c30a4084-6487-4c42-9d6f-83fd1df935a8';
const manifest = {
  environment: 'staging', run, poolId: 'us-east-1_Y9GiDA5Zy',
  issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Y9GiDA5Zy',
  agencies: [0, 1].map(index => ({ id: `00000000-0000-4000-8000-00000000000${index + 1}`, slug: `acceptance-${run}-${index}` })),
  users: ['officer', 'instructor', 'supervisor', 'administrator', 'foreign'].map((role, index) => {
    const email = `acceptance-${run}-${role}@example.invalid`;
    return { id: `10000000-0000-4000-8000-00000000000${index + 1}`, subject: `20000000-0000-4000-8000-00000000000${index + 1}`, username: `30000000-0000-4000-8000-00000000000${index + 1}`, email, fullName: `Staging Acceptance ${role}`, role: role === 'foreign' ? 'officer' : role, agencyIndex: role === 'foreign' ? 1 : 0 };
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

test('detects acceptance identities by email when Cognito canonicalizes the username', () => {
  assert.equal(isStagingAcceptanceUser({ Username: '20000000-0000-4000-8000-000000000001', Attributes: [{ Name: 'email', Value: 'acceptance-run-officer@example.invalid' }] }), true);
  assert.equal(isStagingAcceptanceUser({ Username: 'acceptance-run-officer@example.invalid', Attributes: [] }), true);
  assert.equal(isStagingAcceptanceUser({ Username: 'ordinary-user', Attributes: [{ Name: 'email', Value: 'member@example.invalid' }] }), false);
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
  const identityLinkUsernames = [];
  const client = { async query(sql, parameters = []) {
    statements.push(sql);
    if (sql.includes('insert into public.authentication_identity_links')) identityLinkUsernames.push(parameters[3]);
    if (sql.includes('select id from public.departments')) return { rows: [], rowCount: 0 };
    if (sql.includes('select 1 from public.profiles')) return { rows: [], rowCount: 0 };
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
  assert.ok(statements.some(sql => sql.includes('select 1 from public.profiles') && sql.includes('provider_username')));
  const authAnchor = statements.find(sql => sql.includes('insert into auth.users'));
  assert.match(authAnchor, /auth\.users\(id,email,raw_user_meta_data\)/);
  assert.doesNotMatch(authAnchor, /\b(?:aud|role|encrypted_password|email_confirmed_at|raw_app_meta_data|created_at|updated_at)\b/);
  assert.deepEqual(identityLinkUsernames, manifest.users.map(user => user.username));
  assert.ok(statements.every(sql => !/^\s*(alter|create|drop)\b/i.test(sql)));
});

test('sanitizes PostgreSQL fixture diagnostics while preserving operation, SQLSTATE, position, and safe schema context', () => {
  const error = Object.assign(new Error('column "aud" of relation "users" does not exist'), {
    code: '42703', position: '24', column: 'aud', table: 'users',
    detail: 'A conflicting row included acceptance-123@example.invalid.',
    hint: 'Use id, email, and raw_user_meta_data.',
    where: 'PL/pgSQL function public.handle_new_auth_user() line 7 at SQL statement',
    fixtureOperation: 'identity.create_auth_user_anchor',
  });
  const diagnostic = sanitizeFixturePostgresDiagnostic(error, 'seed-fixture-records');
  assert.equal(diagnostic.sqlstate, '42703');
  assert.equal(diagnostic.position, 24);
  assert.equal(diagnostic.operation, 'identity.create_auth_user_anchor');
  assert.equal(diagnostic.column, 'aud');
  assert.equal(diagnostic.table, 'users');
  assert.match(diagnostic.message, /column "aud"/);
  assert.doesNotMatch(JSON.stringify(diagnostic), /acceptance-123@example\.invalid/);
  assert.match(diagnostic.executionContext, /handle_new_auth_user/);
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
