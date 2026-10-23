import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { localPostgresPort } from '../src/test-support/local-postgres-port.mjs';
import { applyStagingFixture, validateStagingFixtureManifest } from './staging-cognito-fixture-core.mjs';
import { FixtureStorageRefused, fixtureStoragePrefix, planFixtureStorageDeletion } from './staging-acceptance-fixture-storage.mjs';

// Storage cleanup deletes S3 objects for the agencies a manifest names. These tests pin that the manifest alone is never
// enough: the staging database must show the agencies are this run's synthetic agencies, with no other members, and
// attest each object's upload; and storage cleanup deletes only the exact objects the run recorded.

const run = 'c30a4084-6487-4c42-9d6f-83fd1df935a8';
const issuer = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Y9GiDA5Zy';
const realAgency = '90000000-0000-4000-8000-000000000001';
const realMember = '91000000-0000-4000-8000-000000000001';
const fixtureAgencies = [0, 1].map(index => ({ id: `00000000-0000-4000-8000-00000000000${index + 1}`, slug: `acceptance-${run}-${index}` }));
const patchKey = `department-assets/${fixtureAgencies[0].id}/patch-1761234567890.png`;
const realKey = `department-assets/${realAgency}/patch-1700000000000.png`;
const host = 'tracepoint-staging-full-aws.abc.us-east-1.rds.amazonaws.com';
const environment = {
  CONFIGURATION_ENVIRONMENT: 'staging', TRACEPOINT_RUNTIME_PROVIDER_MODE: 'aws-native',
  TRACEPOINT_EXPECTED_DATABASE_HOST: host, TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ host }),
};

function fixtureManifest(overrides = {}) {
  return {
    environment: 'staging', run, poolId: 'us-east-1_Y9GiDA5Zy', issuer, agencies: fixtureAgencies,
    users: ['officer', 'instructor', 'supervisor', 'administrator', 'foreign'].map((role, index) => ({
      id: `10000000-0000-4000-8000-00000000000${index + 1}`, subject: `20000000-0000-4000-8000-00000000000${index + 1}`,
      username: `30000000-0000-4000-8000-00000000000${index + 1}`, email: `acceptance-${run}-${role}@example.invalid`,
      fullName: `Staging Acceptance ${role}`, role: role === 'foreign' ? 'officer' : role, agencyIndex: role === 'foreign' ? 1 : 0,
    })),
    storageObjects: [patchKey],
    ...overrides,
  };
}
const administrator = fixtureManifest().users[3].id;

let server, client, directory;
const count = async (sql, parameters = []) => Number((await client.query(sql, parameters)).rows[0].count);
const realAgencyIntact = async () => {
  assert.equal(await count('select count(*) from public.departments where id=$1', [realAgency]), 1);
  assert.equal(await count('select count(*) from public.department_memberships where department_id=$1', [realAgency]), 1);
  assert.equal(await count('select count(*) from public.equipment_types where department_id=$1', [realAgency]), 1);
  assert.equal(await count('select count(*) from public.audit_events where department_id=$1', [realAgency]), 1);
};

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'tp-fixture-ownership-'));
  const port = await localPostgresPort();
  server = new EmbeddedPostgres({ databaseDir: directory, user: 'postgres', password: 'local-test-only', port,
    persistent: true, postgresFlags: ['-h', '127.0.0.1'], initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {}, onError: () => {} });
  await server.initialise(); await server.start();
  client = new pg.Client({ host: '127.0.0.1', port, database: 'postgres', user: 'postgres', password: 'local-test-only' });
  await client.connect();
  await client.query(`create schema auth;
    create table auth.users(id uuid primary key, email text);
    create table public.departments(id uuid primary key, name text not null, short_name text, slug text unique not null, is_active boolean);
    create table public.profiles(id uuid primary key references auth.users(id) on delete cascade, full_name text, email text);
    create table public.authentication_identity_links(provider text, issuer text, subject text, tracepoint_user_id uuid references auth.users(id) on delete cascade, state text, provider_username text);
    create table public.department_memberships(department_id uuid references public.departments(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade, is_active boolean);
    create table public.audit_events(department_id uuid not null references public.departments(id) on delete cascade, actor_user_id uuid references auth.users(id) on delete set null, action text, details jsonb);
    create table public.equipment_asset_assignments(department_id uuid);
    create table public.equipment_assets(department_id uuid);
    create table public.equipment_types(department_id uuid);
    create table public.department_feature_events(department_id uuid);
    create table public.department_features(department_id uuid);`);
});

after(async () => {
  await client?.end(); await server?.stop();
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

// A real agency with a real member, a document upload and equipment; then this run's two synthetic agencies, its five
// identities and the Agency A patch upload, as the create action and the application would leave them.
beforeEach(async () => {
  await client.query(`truncate public.departments, auth.users, public.equipment_asset_assignments, public.equipment_assets,
    public.equipment_types, public.department_feature_events, public.department_features cascade`);
  await client.query(`insert into public.departments values ($1, 'Real Police Department', 'Real', 'real-pd', true);
    insert into auth.users values ($2, 'member@agency.example');
    insert into public.department_memberships values ($1, $2, true);
    insert into public.equipment_types values ($1);
    insert into public.audit_events values ($1, $2, 'department_patch_upload', jsonb_build_object('storage_path', $3::text))`.replace(/\$(\d)/g, (_, n) => ['', `'${realAgency}'`, `'${realMember}'`, `'${realKey.slice('department-assets/'.length)}'`][n]));
  const manifest = fixtureManifest();
  for (const [index, agency] of manifest.agencies.entries()) {
    await client.query('insert into public.departments values ($1, $2, $3, $4, true)', [agency.id, `Staging Acceptance ${run.slice(0, 8)}-${index ? 'B' : 'A'}`, 'Acceptance', agency.slug]);
  }
  for (const user of manifest.users) {
    await client.query('insert into auth.users values ($1, $2)', [user.id, user.email]);
    await client.query('insert into public.profiles values ($1, $2, $3)', [user.id, user.fullName, user.email]);
    await client.query(`insert into public.authentication_identity_links values ('cognito', $1, $2, $3, 'active', $4)`, [issuer, user.subject, user.id, user.username]);
    await client.query('insert into public.department_memberships values ($1, $2, true)', [manifest.agencies[user.agencyIndex].id, user.id]);
  }
  await client.query(`insert into public.audit_events values ($1, $2, 'department_patch_upload', jsonb_build_object('storage_path', $3::text))`, [fixtureAgencies[0].id, administrator, patchKey.slice('department-assets/'.length)]);
});

test('the database verifies a run\'s own agencies, identities and recorded upload, read-only', async () => {
  const before = await count('select count(*) from public.audit_events');
  const result = await applyStagingFixture(client, 'verify', fixtureManifest(), environment);
  assert.equal(result.action, 'verify');
  assert.equal(await count('select count(*) from public.audit_events'), before);
  assert.equal(await count('select count(*) from public.departments'), 3);
});

test('verification runs in a read-only transaction', async () => {
  const statements = [];
  const recording = { query: (sql, parameters) => { statements.push(sql); return client.query(sql, parameters); } };
  await applyStagingFixture(recording, 'verify', fixtureManifest(), environment);
  assert.equal(statements[0], 'begin read only');
  assert.ok(statements.every(sql => !/\b(insert|update|delete|truncate)\b/i.test(sql)));
});

test('an incorrect agency identifier (a real agency under the run\'s slug) is refused and the real agency is untouched', async () => {
  const forged = fixtureManifest({ agencies: [{ id: realAgency, slug: fixtureAgencies[0].slug }, fixtureAgencies[1]], storageObjects: [realKey] });
  validateStagingFixtureManifest(forged, 'cleanup');
  await assert.rejects(applyStagingFixture(client, 'verify', forged, environment), /does not belong to this run/);
  await assert.rejects(applyStagingFixture(client, 'cleanup', forged, environment));
  await realAgencyIntact();
});

test('forged fixture metadata naming a real agency by its real slug is refused before any deletion', async () => {
  // A forged marker and manifest can agree with each other; they cannot make the database agree.
  const forged = fixtureManifest({ agencies: [{ id: realAgency, slug: 'real-pd' }, fixtureAgencies[1]] });
  assert.throws(() => validateStagingFixtureManifest(forged, 'cleanup'), /bound to this run/);
  await assert.rejects(applyStagingFixture(client, 'verify', { ...forged, storageObjects: [] }, environment));
  await realAgencyIntact();
});

test('a run agency that has gained a member outside the run is refused, by verify and by cleanup', async () => {
  await client.query('insert into public.department_memberships values ($1, $2, true)', [fixtureAgencies[0].id, realMember]);
  await assert.rejects(applyStagingFixture(client, 'verify', fixtureManifest(), environment), /members outside this run/);
  await assert.rejects(applyStagingFixture(client, 'cleanup', fixtureManifest(), environment), /members outside this run/);
  assert.equal(await count('select count(*) from public.departments where id=$1', [fixtureAgencies[0].id]), 1);
  await realAgencyIntact();
});

test('a run identity that has joined another agency is refused', async () => {
  await client.query('insert into public.department_memberships values ($1, $2, true)', [realAgency, administrator]);
  await assert.rejects(applyStagingFixture(client, 'verify', fixtureManifest(), environment), /members outside this run/);
  await client.query('delete from public.department_memberships where department_id = $1 and user_id = $2', [realAgency, administrator]);
});

test('a storage object the run did not upload is refused even inside the run\'s own agency prefix', async () => {
  const unattested = fixtureManifest({ storageObjects: [`department-assets/${fixtureAgencies[0].id}/patch-1.png`] });
  await assert.rejects(applyStagingFixture(client, 'verify', unattested, environment), /not created by this run/);
});

test('an upload attested by someone outside the run does not count as the run\'s', async () => {
  await client.query('update public.audit_events set actor_user_id = $1 where department_id = $2', [realMember, fixtureAgencies[0].id]);
  await assert.rejects(applyStagingFixture(client, 'verify', fixtureManifest(), environment), /not created by this run/);
});

test('recorded objects cannot be attributed once the run\'s agencies are gone; an empty run verifies', async () => {
  await client.query('delete from public.departments where id = any($1::uuid[])', [fixtureAgencies.map(agency => agency.id)]);
  await assert.rejects(applyStagingFixture(client, 'verify', fixtureManifest(), environment), /agencies are absent/);
  await applyStagingFixture(client, 'verify', fixtureManifest({ storageObjects: [] }), environment);
  await realAgencyIntact();
});

test('manifest storage objects outside the run\'s storage scope are refused', () => {
  for (const key of [
    realKey,
    `department-assets/${fixtureAgencies[0].id}/../${realAgency}/patch-1.png`,
    `department-assets/${fixtureAgencies[0].id}/`,
    `department-assets/${fixtureAgencies[0].id}/document.pdf`,
    `vehicle-documents/${fixtureAgencies[0].id}/patch-1.png`,
    `department-assets/${fixtureAgencies[0].id}/nested/patch-1.png`,
    `/department-assets/${fixtureAgencies[0].id}/patch-1.png`,
  ]) assert.throws(() => validateStagingFixtureManifest(fixtureManifest({ storageObjects: [key] }), 'cleanup'), /storage scope/, key);
  assert.throws(() => validateStagingFixtureManifest(fixtureManifest({ storageObjects: [patchKey, patchKey] }), 'cleanup'), /unique/);
  assert.throws(() => validateStagingFixtureManifest(fixtureManifest({ storageObjects: patchKey }), 'cleanup'), /invalid/);
});

const listing = (agencyIndex, versions = [], markers = [], truncated = false) => ({
  prefix: fixtureStoragePrefix(fixtureAgencies[agencyIndex].id), IsTruncated: truncated, Versions: versions, DeleteMarkers: markers,
});

test('storage cleanup deletes every version and delete marker of exactly the recorded objects', () => {
  const plan = planFixtureStorageDeletion(fixtureManifest(), [
    listing(0, [{ Key: patchKey, VersionId: 'v2' }, { Key: patchKey, VersionId: 'v1' }], [{ Key: patchKey, VersionId: 'm1' }]),
    listing(1),
  ]);
  assert.deepEqual(plan, [{ Key: patchKey, VersionId: 'v2' }, { Key: patchKey, VersionId: 'v1' }, { Key: patchKey, VersionId: 'm1' }]);
  assert.deepEqual(planFixtureStorageDeletion(fixtureManifest({ storageObjects: [] }), [listing(0), listing(1)]), []);
});

test('an object the run did not record refuses the whole storage cleanup', () => {
  assert.throws(() => planFixtureStorageDeletion(fixtureManifest(), [
    listing(0, [{ Key: patchKey, VersionId: 'v1' }, { Key: `${fixtureStoragePrefix(fixtureAgencies[0].id)}patch-2.png`, VersionId: 'v1' }]), listing(1),
  ]), FixtureStorageRefused);
  assert.throws(() => planFixtureStorageDeletion(fixtureManifest({ storageObjects: [] }), [
    listing(0, [{ Key: patchKey, VersionId: 'v1' }]), listing(1),
  ]), /did not record creating/);
});

test('listings outside the run\'s prefixes, truncated, incomplete or malformed are refused', () => {
  const manifest = fixtureManifest();
  assert.throws(() => planFixtureStorageDeletion(manifest, [{ prefix: `department-assets/${realAgency}/`, Versions: [{ Key: realKey, VersionId: 'v1' }] }, listing(1)]), /not one of this run/);
  assert.throws(() => planFixtureStorageDeletion(manifest, [listing(0, [{ Key: realKey, VersionId: 'v1' }]), listing(1)]), /outside its agency prefix/);
  assert.throws(() => planFixtureStorageDeletion(manifest, [listing(0, [], [], true), listing(1)]), /more than one page/);
  assert.throws(() => planFixtureStorageDeletion(manifest, [listing(0)]), /was not listed/);
  assert.throws(() => planFixtureStorageDeletion(manifest, [listing(0), listing(0)]), /not one of this run/);
  assert.throws(() => planFixtureStorageDeletion(manifest, [listing(0, [{ Key: patchKey }]), listing(1)]), /no version identifier/);
  assert.throws(() => planFixtureStorageDeletion(fixtureManifest({ storageObjects: [realKey] }), [listing(0), listing(1)]), /storage scope/);
});

test('the runner verifies ownership in the database before its only storage deletion, and deletes by exact version', async () => {
  const source = await readFile(new URL('./run-staging-cognito-acceptance.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function cleanupStorage('), source.indexOf('async function deleteCognitoUsers('));
  const plan = body.indexOf('planFixtureStorageDeletion(');
  const verify = body.indexOf("runFixtureTask('acceptance-fixture-verify'");
  const remove = body.indexOf('new DeleteObjectCommand(');
  assert.ok(plan > 0 && verify > plan && remove > verify);
  assert.equal(source.split('new DeleteObjectCommand(').length, 2);
  assert.doesNotMatch(body, /Prefix: prefix[^\n]*DeleteObject/);
});
