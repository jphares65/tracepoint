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

// The acceptance run expects the Officer, Instructor and Supervisor to be refused restricted custody of its Duty Only
// firearm (run cd66c7a4 assigned it to the Supervisor, who as assignee is authorized). This runs the real
// operate_restricted_firearm_custody on the full AWS-native schema with the real fixture's roles: none of the three holds
// manage_restricted_firearm_custody, so each is refused on the Administrator's firearm, while an assigned Officer may still
// check their own firearm in and out. TRACEPOINT_FIXTURE_SCHEMA_ROOT points at another checkout's migrations (for example
// the commit deployed to staging) to run the same check against that schema.
const schemaRoot = path.resolve(process.env.TRACEPOINT_FIXTURE_SCHEMA_ROOT ?? path.join(import.meta.dirname, '..'));
const run = '7c4e2a1b-9d3f-4b58-8e61-2f0a9c7d5b34';
const issuer = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Y9GiDA5Zy';
const host = 'tracepoint-staging-full-aws.abc.us-east-1.rds.amazonaws.com';
const environment = {
  CONFIGURATION_ENVIRONMENT: 'staging', TRACEPOINT_RUNTIME_PROVIDER_MODE: 'aws-native',
  TRACEPOINT_EXPECTED_DATABASE_HOST: host, TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ host }),
};
const agencies = [0, 1].map(index => ({ id: `0e000000-0000-4000-8000-00000000000${index + 1}`, slug: `acceptance-${run}-${index}` }));
const users = ['administrator', 'officer', 'instructor', 'supervisor', 'foreign'].map((role, index) => ({
  id: `1e000000-0000-4000-8000-00000000000${index + 1}`, subject: `2e000000-0000-4000-8000-00000000000${index + 1}`,
  username: `3e000000-0000-4000-8000-00000000000${index + 1}`, email: `acceptance-${run}-${role}@example.invalid`,
  fullName: `Staging Acceptance ${role}`, role: role === 'foreign' ? 'officer' : role, agencyIndex: role === 'foreign' ? 1 : 0,
}));
const manifest = { environment: 'staging', run, poolId: 'us-east-1_Y9GiDA5Zy', issuer, agencies, users, storageObjects: [] };
const [admin, officer, instructor, supervisor, foreign] = users;
const A = agencies[0].id;
const B = agencies[1].id;

let server, client, directory, location;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'tp-restricted-custody-authorization-'));
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
  await applyStagingFixture(client, 'create', manifest, environment);
  location = (await client.query("insert into public.firearm_storage_locations(department_id,name,created_by_user_id) values($1,'Acceptance Vault',$2) returning id",
    [A, admin.id])).rows[0].id;
});

after(async () => {
  await client?.end(); await server?.stop();
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

// A Duty Only firearm in Agency A, issued to and held by the assignee, as the acceptance run provisions it.
async function dutyOnlyFirearm(assignee, serial) {
  const firearm = (await client.query(`insert into public.firearms(department_id,serial_number,make,model,caliber,firearm_type,created_by)
    values($1,$2,'Acceptance','Custody Authorization','TBD / Unknown','handgun',$3) returning id`, [A, serial, admin.id])).rows[0].id;
  const assignment = (await client.query(`insert into public.firearm_assignments(department_id,firearm_id,assigned_to_user_id,assigned_by_user_id)
    values($1,$2,$3,$4) returning id`, [A, firearm, assignee.id, admin.id])).rows[0].id;
  await client.query(`insert into public.firearm_current_custody(firearm_id,department_id,assignment_id,holder_type,holder_user_id,updated_by_user_id)
    values($1,$2,$3,'OFFICER',$4,$5) on conflict(firearm_id) do nothing`, [firearm, A, assignment, assignee.id, admin.id]);
  await client.query(`insert into public.firearm_possession_restrictions(department_id,firearm_id,assignment_id,affected_officer_user_id,reason_category,restriction_type,duty_only,created_by_user_id)
    values($1,$2,$3,$4,'training','duty_only',true,$5)`, [A, firearm, assignment, assignee.id, admin.id]);
  return { firearm, assignment };
}

async function asUser(user, department, sql, parameters) {
  await client.query("select set_config('tracepoint.subject_id',$1,false), set_config('tracepoint.department_id',$2,false)", [user.id, department]);
  try { return await client.query(sql, parameters); } finally {
    await client.query("select set_config('tracepoint.subject_id','',false), set_config('tracepoint.department_id','',false)");
  }
}
const operate = (user, department, firearm, action, storageLocation = null) => asUser(user, department,
  'select public.operate_restricted_firearm_custody($1,$2,$3,null,gen_random_uuid()) as event', [firearm, action, storageLocation]);
const refusal = promise => promise.then(() => assert.fail('the custody action must be refused'), error => error.message);
const holder = async firearm => (await client.query('select holder_type, holder_user_id, storage_location_id from public.firearm_current_custody where firearm_id=$1', [firearm])).rows[0];

test('the fixture grants restricted custody management to the Administrator only', async () => {
  for (const [user, expected] of [[admin, true], [officer, false], [instructor, false], [supervisor, false]]) {
    const { rows } = await asUser(user, A, "select public.has_department_permission($1,'manage_restricted_firearm_custody') as granted", [A]);
    assert.equal(rows[0].granted, expected, user.role);
  }
});

test('Officer, Instructor and Supervisor are refused restricted custody of the Administrator\'s Duty Only firearm', async () => {
  const { firearm } = await dutyOnlyFirearm(admin, `ACCEPTANCE-${run}`);
  const before = await holder(firearm);
  for (const user of [officer, instructor, supervisor]) {
    for (const action of ['CHECK_OUT', 'CHECK_IN']) {
      assert.equal(await refusal(operate(user, A, firearm, action, location)), 'restricted custody permission required', `${user.role} ${action}`);
    }
  }
  // Agency B cannot see the firearm at all, which the application refuses with 409 before any permission check.
  assert.equal(await refusal(operate(foreign, B, firearm, 'CHECK_OUT')), 'active assigned firearm restriction required');
  assert.deepEqual(await holder(firearm), before);
  assert.equal(Number((await client.query('select count(*) from public.firearm_custody_events where firearm_id=$1', [firearm])).rows[0].count), 0);
});

test('an assigned Officer without custody management may check their own Duty Only firearm in and out', async () => {
  const { firearm, assignment } = await dutyOnlyFirearm(officer, `ACCEPTANCE-${run}-OFFICER`);
  await operate(officer, A, firearm, 'CHECK_IN', location);
  assert.deepEqual(await holder(firearm), { holder_type: 'SECURE_STORAGE', holder_user_id: null, storage_location_id: location });
  // Another member who is not the assignee is still refused while the firearm is in storage.
  assert.equal(await refusal(operate(instructor, A, firearm, 'CHECK_OUT')), 'restricted custody permission required');
  await operate(officer, A, firearm, 'CHECK_OUT');
  assert.deepEqual(await holder(firearm), { holder_type: 'OFFICER', holder_user_id: officer.id, storage_location_id: null });
  assert.equal((await client.query('select returned_at is null as active from public.firearm_assignments where id=$1', [assignment])).rows[0].active, true);
  const { rows } = await client.query(`select action from public.audit_events where entity_id=$1 and actor_user_id=$2
    and action in ('firearm_checked_in','firearm_checked_out') order by created_at, action`, [firearm, officer.id]);
  assert.deepEqual(rows.map(row => row.action).sort(), ['firearm_checked_in', 'firearm_checked_out']);
});
