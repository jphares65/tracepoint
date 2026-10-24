import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { localPostgresPort } from '../src/test-support/local-postgres-port.mjs';
import { isAwsNativeSchemaFile } from '../src/test-support/aws-native-schema-files.mjs';
import { applyStagingFixture } from './staging-cognito-fixture-core.mjs';

// Fixture cleanup on the full AWS-native schema (Supabase lineage plus database/aws), after the residue an acceptance
// run leaves: a firearm assigned to the Administrator with a Duty Only restriction, current custody and a custody event,
// plus the D-2 equipment asset and audit rows. firearm_assignments references department_memberships and
// firearm_custody_events references firearms and profiles with ON DELETE RESTRICT, so this pins that cleanup still
// removes everything. TRACEPOINT_FIXTURE_SCHEMA_ROOT points at another checkout's migrations (for example the commit
// deployed to staging) to run the same check against that schema.
const schemaRoot = path.resolve(process.env.TRACEPOINT_FIXTURE_SCHEMA_ROOT ?? path.join(import.meta.dirname, '..'));
const run = '5d3a1f0e-7c2b-4e19-9a64-0b8f2c6d4e71';
const issuer = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Y9GiDA5Zy';
const host = 'tracepoint-staging-full-aws.abc.us-east-1.rds.amazonaws.com';
const environment = {
  CONFIGURATION_ENVIRONMENT: 'staging', TRACEPOINT_RUNTIME_PROVIDER_MODE: 'aws-native',
  TRACEPOINT_EXPECTED_DATABASE_HOST: host, TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ host }),
};
const agencies = [0, 1].map(index => ({ id: `0f000000-0000-4000-8000-00000000000${index + 1}`, slug: `acceptance-${run}-${index}` }));
const users = ['administrator', 'officer', 'instructor', 'supervisor', 'foreign'].map((role, index) => ({
  id: `1f000000-0000-4000-8000-00000000000${index + 1}`, subject: `2f000000-0000-4000-8000-00000000000${index + 1}`,
  username: `3f000000-0000-4000-8000-00000000000${index + 1}`, email: `acceptance-${run}-${role}@example.invalid`,
  fullName: `Staging Acceptance ${role}`, role: role === 'foreign' ? 'officer' : role, agencyIndex: role === 'foreign' ? 1 : 0,
}));
const patchName = 'patch-1761234567890.png';
const manifest = { environment: 'staging', run, poolId: 'us-east-1_Y9GiDA5Zy', issuer, agencies, users, storageObjects: [`department-assets/${agencies[0].id}/${patchName}`] };
const [admin, officer] = users;
const A = agencies[0].id;
const real = { agency: '9f000000-0000-4000-8000-000000000001', member: '9e000000-0000-4000-8000-000000000001', firearm: '9d000000-0000-4000-8000-000000000001' };

let server, client, directory;
const count = async (sql, parameters) => Number((await client.query(sql, parameters)).rows[0].count);

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'tp-fixture-cleanup-schema-'));
  const port = await localPostgresPort();
  server = new EmbeddedPostgres({ databaseDir: directory, user: 'postgres', password: 'local-test-only', port,
    persistent: true, postgresFlags: ['-h', '127.0.0.1'], initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {}, onError: () => {} });
  await server.initialise(); await server.start();
  client = new pg.Client({ host: '127.0.0.1', port, database: 'postgres', user: 'postgres', password: 'local-test-only' });
  await client.connect();
  const { supabasePrerequisites } = await import(pathToFileURL(path.join(schemaRoot, 'scripts/postgres-bootstrap-prerequisites.mjs')).href);
  await client.query(supabasePrerequisites);
  for (const folder of ['supabase/migrations', 'database/aws']) {
    for (const file of (await readdir(path.join(schemaRoot, folder))).filter(isAwsNativeSchemaFile).sort()) {
      await client.query((await readFile(path.join(schemaRoot, folder, file), 'utf8')).replace(/^﻿/, ''));
    }
  }
});

after(async () => {
  await client?.end(); await server?.stop();
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

async function seedRealAgencyWithFirearm() {
  await client.query("insert into auth.users(id,email) values($1,'real-member@example.test')", [real.member]);
  await client.query("insert into public.profiles(id,full_name,email) values($1,'Real Member','real-member@example.test') on conflict(id) do nothing", [real.member]);
  await client.query("insert into public.departments(id,name,short_name,slug,is_active) values($1,'Real Agency','RA','real-agency',true)", [real.agency]);
  await client.query('insert into public.department_memberships(department_id,user_id,is_active) values($1,$2,true)', [real.agency, real.member]);
  await client.query(`insert into public.firearms(id,department_id,serial_number,make,model,caliber,firearm_type)
    values($1,$2,'REAL-1','Real','Duty','9mm','handgun')`, [real.firearm, real.agency]);
  await client.query('insert into public.firearm_assignments(department_id,firearm_id,assigned_to_user_id) values($1,$2,$3)', [real.agency, real.firearm, real.member]);
}

// What the acceptance run's administrator and officer steps leave behind in Agency A.
async function seedAcceptanceResidue() {
  const firearm = (await client.query(`insert into public.firearms(department_id,serial_number,make,model,caliber,firearm_type,created_by)
    values($1,$2,'Acceptance','Custody Authorization','TBD / Unknown','handgun',$3) returning id`, [A, `ACCEPTANCE-${run}`, admin.id])).rows[0].id;
  const assignment = (await client.query(`insert into public.firearm_assignments(department_id,firearm_id,assigned_to_user_id,assigned_by_user_id)
    values($1,$2,$3,$4) returning id`, [A, firearm, admin.id, admin.id])).rows[0].id;
  await client.query(`insert into public.firearm_current_custody(firearm_id,department_id,assignment_id,holder_type,holder_user_id,updated_by_user_id)
    values($1,$2,$3,'OFFICER',$4,$5) on conflict(firearm_id) do nothing`, [firearm, A, assignment, admin.id, admin.id]);
  const restriction = (await client.query(`insert into public.firearm_possession_restrictions(department_id,firearm_id,assignment_id,affected_officer_user_id,reason_category,restriction_type,duty_only,created_by_user_id)
    values($1,$2,$3,$4,'training','duty_only',true,$5) returning id`, [A, firearm, assignment, admin.id, admin.id])).rows[0].id;
  await client.query(`insert into public.firearm_custody_events(department_id,firearm_id,assignment_id,to_holder_type,to_holder_user_id,initiating_user_id,action_type,reason,restriction_id,idempotency_key)
    values($1,$2,$3,'OFFICER',$4,$5,'INITIALIZE','acceptance issue',$6,gen_random_uuid())`, [A, firearm, assignment, admin.id, admin.id, restriction]);
  const type = (await client.query("insert into public.equipment_types(department_id,name) values($1,'Acceptance Radio') returning id", [A])).rows[0].id;
  await client.query(`insert into public.equipment_assets(department_id,equipment_type_id,serial_number,assigned_user_id,created_by,updated_by)
    values($1,$2,$3,$4,$5,$5)`, [A, type, `D2-${run}`, officer.id, admin.id]);
  await client.query(`insert into public.audit_events(department_id,actor_user_id,action,entity_type,summary,details)
    values($1,$2,'department_patch_upload','department','patch',jsonb_build_object('storage_path',$3::text))`, [A, admin.id, `${A}/${patchName}`]);
  return { firearm, assignment, restriction };
}

test('fixture cleanup removes firearm assignment, restriction, custody and custody events with the agencies, and nothing else', async () => {
  await seedRealAgencyWithFirearm();
  assert.equal((await applyStagingFixture(client, 'create', manifest, environment)).action, 'create');
  const { firearm } = await seedAcceptanceResidue();
  assert.equal(await count('select count(*) from public.firearm_custody_events where firearm_id=$1', [firearm]), 1);
  assert.equal(await count('select count(*) from public.firearm_possession_restrictions where firearm_id=$1 and is_active', [firearm]), 1);

  await applyStagingFixture(client, 'cleanup', manifest, environment);

  const agencyIds = agencies.map(agency => agency.id);
  const userIds = users.map(user => user.id);
  for (const table of ['firearms', 'firearm_assignments', 'firearm_possession_restrictions', 'firearm_current_custody', 'firearm_custody_events',
    'equipment_assets', 'equipment_types', 'department_memberships', 'department_membership_roles', 'department_features', 'audit_events']) {
    assert.equal(await count(`select count(*) from public.${table} where department_id=any($1::uuid[])`, [agencyIds]), 0, table);
  }
  assert.equal(await count('select count(*) from public.departments where id=any($1::uuid[])', [agencyIds]), 0);
  assert.equal(await count('select count(*) from auth.users where id=any($1::uuid[])', [userIds]), 0);
  assert.equal(await count('select count(*) from public.profiles where id=any($1::uuid[])', [userIds]), 0);
  assert.equal(await count("select count(*) from public.authentication_identity_links where provider='cognito' and subject=any($1::text[])", [users.map(user => user.subject)]), 0);
  // The real agency's firearm and assignment are untouched.
  assert.equal(await count('select count(*) from public.firearms where department_id=$1', [real.agency]), 1);
  assert.equal(await count('select count(*) from public.firearm_assignments where department_id=$1 and returned_at is null', [real.agency]), 1);
  assert.equal(await count('select count(*) from public.department_memberships where department_id=$1', [real.agency]), 1);
  // A second recovery pass finds nothing and changes nothing.
  await applyStagingFixture(client, 'cleanup', manifest, environment);
  assert.equal(await count('select count(*) from public.firearms where department_id=$1', [real.agency]), 1);
});
