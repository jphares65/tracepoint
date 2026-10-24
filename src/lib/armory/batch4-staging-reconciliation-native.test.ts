import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";

import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";
import { isAwsNativeSchemaFile } from "../../test-support/aws-native-schema-files.mjs";
import { supabasePrerequisites } from "../../../scripts/postgres-bootstrap-prerequisites.mjs";
import { custodyTransferFailure, restrictedCustodyFailure } from "./custody-transfer.ts";

// Batch 4 on a staging-equivalent schema: the full AWS-native lineage through 068, then the catalog differences the
// read-only SCH-3 capture found on staging (src/test-support/staging-schema-20261024.sql: 024 and 027 functions
// missing, 028 as the Supabase-lineage Phase A variant, the inventory variant). Rows are written under that shape first,
// as staging holds them, then 069 and 070 are applied the way the runner applies them. Every call after that is made
// as the runtime makes it (tracepoint_runtime acting as authenticated, with subject and agency set).
const migration069 = "database/aws/069_baseline_object_reconciliation.sql";
const migration070 = "database/aws/070_restriction_follows_assignment.sql";
const A = "b4000000-0000-4000-8000-00000000000a", B = "b4000000-0000-4000-8000-00000000000b";
const armorer = "b4000000-0000-4000-8000-0000000000a1", kris = "b4000000-0000-4000-8000-0000000000a2";
const eli = "b4000000-0000-4000-8000-0000000000a3", viewer = "b4000000-0000-4000-8000-0000000000a4";
const outsider = "b4000000-0000-4000-8000-0000000000c1", dual = "b4000000-0000-4000-8000-0000000000d1";
const foreignArmorer = "b4000000-0000-4000-8000-0000000000b1", foreignOfficer = "b4000000-0000-4000-8000-0000000000b2";
const invited = "b4000000-0000-4000-8000-0000000000e1", operation = "b4000000-0000-4000-8000-0000000000f1";
const vault = "b4000000-0000-4000-8000-0000000005a1", foreignVault = "b4000000-0000-4000-8000-0000000005b1";
const armoryPermissions = ["manage_firearms", "manage_firearm_restrictions", "manage_restricted_firearm_custody",
  "firearm_custody.check_in", "firearm_custody.check_out", "firearm_custody.view_history", "manage_users"];
const custodyTables = ["firearm_storage_locations", "firearm_current_custody", "firearm_possession_restrictions", "firearm_custody_events"];
let server: EmbeddedPostgres, owner: pg.Pool, runtime: pg.Pool, directory: string, serial = 0;
const seeded: { custodyGun?: string; staleGun?: string; staleRestriction?: string; foreignGun?: string; foreignRestriction?: string; rolePermissions?: unknown } = {};

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-batch4-staging-"));
  const port = await localPostgresPort();
  server = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "synthetic-local-only", port, persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  owner = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "synthetic-local-only", database: "postgres" });
  await owner.query(supabasePrerequisites);
  for (const folder of ["supabase/migrations", "database/aws"]) {
    for (const file of (await readdir(folder)).filter(isAwsNativeSchemaFile).sort()) {
      if (folder === "database/aws" && Number(file.slice(0, 3)) > 68) continue;
      await owner.query((await readFile(path.join(folder, file), "utf8")).replace(/^﻿/, ""));
    }
  }
  await owner.query(await readFile("src/test-support/staging-schema-20261024.sql", "utf8"));
  await owner.query("alter role tracepoint_runtime login password 'synthetic-runtime-only'");
  runtime = new pg.Pool({ host: "127.0.0.1", port, user: "tracepoint_runtime", password: "synthetic-runtime-only", database: "postgres", max: 6 });
  const people: Array<[string, string, string, string]> = [[armorer, "Avery Armorer", A, "armorer"], [kris, "Kris Tine", A, "officer"], [eli, "Eli Manning", A, "officer"],
    [viewer, "Vic Viewer", A, "supervisor"], [foreignArmorer, "Foreign Armorer", B, "armorer"], [foreignOfficer, "Foreign Officer", B, "officer"], [dual, "Dana Dual", B, "armorer"]];
  for (const [id, name] of [...people, [outsider, "Oscar Outsider", "", ""] as [string, string, string, string]]) {
    await owner.query("insert into auth.users(id,email) values($1,$2)", [id, `${id.slice(-2)}@example.test`]);
    await owner.query("insert into public.profiles(id,full_name,email) values($1,$2,$3) on conflict(id) do update set full_name=excluded.full_name, email=excluded.email", [id, name, `${id.slice(-2)}@example.test`]);
  }
  await owner.query("insert into public.departments(id,name,short_name,slug,created_by) values($1,'Batch 4 A','A','b4-a',$3),($2,'Batch 4 B','B','b4-b',$4)", [A, B, armorer, foreignArmorer]);
  for (const [id, , department, role] of [...people, [dual, "", A, "armorer"] as [string, string, string, string]]) {
    await owner.query("insert into public.department_memberships(department_id,user_id,is_active,activation_status) values($1,$2,true,'activated') on conflict do nothing", [department, id]);
    await owner.query("insert into public.department_membership_roles(department_id,user_id,role_code) values($1,$2,$3) on conflict do nothing", [department, id, role]);
  }
  for (const department of [A, B]) {
    for (const permission of armoryPermissions) {
      await owner.query("insert into public.department_role_permissions(department_id,role_code,permission_code) values($1,'armorer',$2) on conflict do nothing", [department, permission]);
    }
    await owner.query("insert into public.department_role_permissions(department_id,role_code,permission_code) values($1,'supervisor','firearm_custody.view_history') on conflict do nothing", [department]);
  }
  await owner.query("insert into public.firearm_storage_locations(id,department_id,name,created_by_user_id) values($1,$3,'Vault',$4),($2,$5,'Foreign vault',$6)", [vault, foreignVault, A, armorer, B, foreignArmorer]);
  seeded.rolePermissions = (await owner.query("select department_id,role_code,permission_code from public.department_role_permissions order by 1,2,3")).rows;
});

after(async () => { await runtime?.end(); await owner?.end(); await server?.stop(); if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

async function as<T>(user: string, department: string, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await runtime.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('tracepoint.subject_id',$1,true),set_config('tracepoint.department_id',$2,true)", [user, department]);
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}
const key = () => crypto.randomUUID();
async function firearm(department = A) {
  serial += 1;
  const id = crypto.randomUUID();
  await owner.query("insert into public.firearms(id,department_id,serial_number,make,model,caliber,firearm_type) values($1,$2,$3,'Glock','17','9mm','handgun')", [id, department, `B4-${serial}`]);
  return id;
}
async function issue(firearmId: string, officer: string, department = A, actor = armorer) {
  const id = crypto.randomUUID();
  await as(actor, department, (c) => c.query("insert into public.firearm_assignments(id,department_id,firearm_id,assigned_to_user_id,assigned_by_user_id) values($1,$2,$3,$4,$5)", [id, department, firearmId, officer, actor]));
  return id;
}
const returnSql = "update public.firearm_assignments set returned_at=now(),returned_by_user_id=$3,updated_at=now() where firearm_id=$1 and department_id=$2 and returned_at is null";
const giveBack = (firearmId: string, department = A, actor = armorer) => as(actor, department, (c) => c.query(returnSql, [firearmId, department, actor]));
const restrict = (firearmId: string, type = "duty_only", department = A, actor = armorer) =>
  as(actor, department, async (c) => (await c.query("select public.set_firearm_restriction($1,$2,current_date,'Restricted',null,null) id", [firearmId, type])).rows[0].id as string);
const transfer = (c: pg.PoolClient, firearmId: string, holderType: string, holder: string | null, location: string | null) =>
  c.query("select public.transfer_firearm_custody($1,$2,$3,$4,'Batch 4 check',null,$5,false) id", [firearmId, holderType, holder, location, key()]);
const scalar = async (sql: string, values: unknown[] = []) => (await owner.query(sql, values)).rows[0]?.v;
const count = async (sql: string, values: unknown[] = []) => Number(await scalar(sql, values));
const reject = (promise: Promise<unknown>) => promise.then(() => assert.fail("expected a refusal"), (error: { message: string; code?: string }) => error);
const applyFile = async (file: string) => owner.query((await readFile(file, "utf8")).replace(/^﻿/, ""));
async function catalogOf(tables: string[]) {
  return (await owner.query(`
    select 'policy' kind, tablename||'.'||policyname id, cmd||' '||array_to_string(roles,',')||' '||coalesce(qual,'')||' '||coalesce(with_check,'') def from pg_policies where schemaname='public' and tablename=any($1)
    union all select 'constraint', conrelid::regclass::text||'.'||conname, pg_get_constraintdef(oid)||' valid='||convalidated from pg_constraint where conrelid=any(select ('public.'||t)::regclass from unnest($1::text[]) t) and contype<>'n'
    union all select 'grant', table_name||'.'||grantee, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name=any($1) group by table_name, grantee
    union all select 'function', p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))||' owner='||pg_get_userbyid(p.proowner)||' acl='||coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where (n.nspname,p.proname) in (('tracepoint_auth','enqueue_notification_email'),('tracepoint_auth','inspect_cognito_invite_retry'),('tracepoint_auth','claim_cognito_invite_retry'),('public','transfer_firearm_custody'),('public','end_returned_assignment_restrictions'),('public','guard_firearm_restriction_assignment'))
    union all select 'trigger', tgrelid::regclass::text||'.'||tgname, pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in ('public.firearm_assignments'::regclass,'public.firearm_possession_restrictions'::regclass,'public.firearm_current_custody'::regclass)
    order by 1,2`, [tables])).rows;
}

test("staging-equivalent shape reproduces the SCH-3 findings before 069 (and AT-5 before 070)", async () => {
  assert.equal(await count("select count(*) v from pg_proc where proname in ('enqueue_notification_email','inspect_cognito_invite_retry','claim_cognito_invite_retry')"), 0);
  const gun = await firearm();
  await issue(gun, kris);
  // The Phase A variant gates transfers on a department feature row.
  await owner.query("insert into public.feature_catalog(code,display_name,description,sort_order,is_active) values('firearm_custody','Firearm Custody','Phase A custody (staging data)',900,true) on conflict (code) do nothing");
  await owner.query("insert into public.department_features(department_id,feature_code,is_enabled) values($1,'firearm_custody',true),($2,'firearm_custody',true) on conflict (department_id,feature_code) do update set is_enabled=true", [A, B]);
  await as(armorer, A, (c) => transfer(c, gun, "OFFICER", kris, null));
  // M1: every member reads custody history; M2: custody to a non-member is accepted; M3: service_role holds DML.
  assert.equal(await as(eli, A, async (c) => (await c.query("select count(*)::int n from public.firearm_custody_events where firearm_id=$1", [gun])).rows[0].n), 1);
  const nonMember = await firearm();
  await as(armorer, A, (c) => transfer(c, nonMember, "OFFICER", outsider, null));
  assert.equal(await count("select count(*) v from public.firearm_current_custody where firearm_id=$1 and holder_user_id=$2", [nonMember, outsider]), 1);
  assert.equal(await scalar("select has_table_privilege('service_role','public.firearm_custody_events','DELETE') v"), true);
  // The non-member custody row is staging data 069 must not touch; remove it here as the armorer's correction would.
  await owner.query("delete from public.firearm_current_custody where firearm_id=$1", [nonMember]);
  seeded.custodyGun = gun;

  // AT-5: a Duty Only restriction outlives its returned assignment.
  const stale = await firearm();
  await issue(stale, kris);
  seeded.staleRestriction = await restrict(stale);
  await giveBack(stale);
  assert.equal(await count("select count(*) v from public.firearm_possession_restrictions where id=$1 and is_active", [seeded.staleRestriction]), 1);
  seeded.staleGun = stale;
  const foreignGun = await firearm(B);
  await issue(foreignGun, foreignOfficer, B, foreignArmorer);
  seeded.foreignRestriction = await restrict(foreignGun, "duty_only", B, foreignArmorer);
  seeded.foreignGun = foreignGun;
});

test("069 stops, changing nothing, when existing rows violate a restored CHECK or a runtime role can act as service_role", async () => {
  const before = await catalogOf(custodyTables);
  const blank = crypto.randomUUID();
  await owner.query("insert into public.firearm_storage_locations(id,department_id,name) values($1,$2,'   ')", [blank, A]);
  const refusal = await reject(applyFile(migration069));
  assert.match(refusal.message, /^069 refused: 1 rows of public\.firearm_storage_locations violate firearm_storage_locations_name_check \(no rows were changed/);
  assert.equal(refusal.code, "23514");
  assert.deepEqual(await catalogOf(custodyTables), before, "the refused apply left the catalog as it was");
  assert.equal(await count("select count(*) v from pg_proc where proname='enqueue_notification_email'"), 0);
  assert.equal(await count("select count(*) v from public.firearm_storage_locations where id=$1 and name='   '", [blank]), 1, "the violating row is reported, not modified");
  await owner.query("delete from public.firearm_storage_locations where id=$1", [blank]);

  await owner.query("grant service_role to tracepoint_runtime");
  const membership = await reject(applyFile(migration069));
  assert.match(membership.message, /^069 refused: a runtime role is a member of service_role/);
  await owner.query("revoke service_role from tracepoint_runtime");
  assert.deepEqual(await catalogOf(custodyTables), before);
});

test("069 restores 024, 027 and 028's objects exactly and is reproducible; 070 applies; role permissions are untouched", async () => {
  await applyFile(migration069);
  const once = await catalogOf(custodyTables);
  await applyFile(migration069);
  assert.deepEqual(await catalogOf(custodyTables), once, "a second apply changes nothing");
  await applyFile(migration070);
  await applyFile(migration070);

  const policies = (await owner.query("select tablename||'.'||policyname v from pg_policies where schemaname='public' and tablename=any($1) order by 1", [custodyTables])).rows.map((row) => row.v);
  assert.deepEqual(policies, ["firearm_current_custody.firearm_current_custody_read", "firearm_custody_events.firearm_custody_events_read",
    "firearm_possession_restrictions.firearm_possession_restrictions_read", "firearm_storage_locations.firearm_storage_locations_read"]);
  for (const table of custodyTables) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      assert.equal(await scalar("select has_table_privilege('service_role',$1,$2) v", [`public.${table}`, privilege]), false, `service_role ${privilege} ${table}`);
    }
    assert.equal(await scalar("select has_table_privilege('authenticated',$1,'SELECT') v", [`public.${table}`]), true);
    assert.equal(await scalar("select has_table_privilege('authenticated',$1,'INSERT') v", [`public.${table}`]), false);
  }
  const checks = (await owner.query("select conname v from pg_constraint where conname=any($1) and convalidated order by 1", [["firearm_custody_events_reason_check",
    "firearm_possession_restrictions_reason_category_check", "firearm_storage_locations_location_kind_check", "firearm_storage_locations_name_check"]])).rows.map((row) => row.v);
  assert.equal(checks.length, 4);
  const transferDefinition = await scalar("select pg_get_functiondef('public.transfer_firearm_custody(uuid,text,uuid,uuid,text,text,uuid,boolean)'::regprocedure) v");
  assert.match(transferDefinition, /SET search_path TO 'pg_catalog', 'public', 'tracepoint_auth'/);
  assert.match(transferDefinition, /v_department_id is distinct from tracepoint_auth\.department_id\(\)/);
  assert.doesNotMatch(transferDefinition, /department_features/);
  const functions = (await owner.query(`select p.oid::regprocedure::text sig, p.prosecdef, array_to_string(p.proconfig,',') config, pg_get_userbyid(p.proowner) owner,
      has_function_privilege('tracepoint_runtime',p.oid,'EXECUTE') runtime, has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated, has_function_privilege('anon',p.oid,'EXECUTE') anon
    from pg_proc p where p.proname in ('enqueue_notification_email','inspect_cognito_invite_retry','claim_cognito_invite_retry') order by p.proname`)).rows;
  // 024 grants the runtime login itself; 027 grants authenticated, which the (noinherit) runtime acts as.
  assert.deepEqual(functions.map((row) => [row.sig.split("(")[0], row.prosecdef, row.owner, row.runtime, row.authenticated, row.anon]), [
    ["tracepoint_auth.claim_cognito_invite_retry", true, "postgres", false, true, false],
    ["tracepoint_auth.enqueue_notification_email", true, "postgres", true, false, false],
    ["tracepoint_auth.inspect_cognito_invite_retry", true, "postgres", false, true, false],
  ]);
    // Each restored definition is the source file's text (024, 027, 028).
  for (const [file, name] of [["024_notification_email_server_enqueue.sql", "enqueue_notification_email"], ["027_cognito_invite_retry_claim.sql", "claim_cognito_invite_retry"],
    ["028_firearm_custody_phase_a.sql", "transfer_firearm_custody"]]) {
    const source = (await readFile(path.join("database/aws", file), "utf8")).replace(/\r\n/g, "\n");
    // Staging images apply the CRLF archive, so the stored body may carry CRLF; compare the text, not the line endings.
    const body = String(await scalar("select prosrc v from pg_proc where proname=$1", [name])).replace(/\r\n/g, "\n");
    assert.ok(source.includes(body), `${name} body equals ${file}`);
  }
  assert.deepEqual((await owner.query("select department_id,role_code,permission_code from public.department_role_permissions order by 1,2,3")).rows, seeded.rolePermissions);
});

test("custody history is readable only with view_history or manage_firearms, and never across agencies", async () => {
  const gun = seeded.custodyGun!;
  const read = (user: string, department: string) => as(user, department, async (c) => (await c.query("select count(*)::int n from public.firearm_custody_events where firearm_id=$1", [gun])).rows[0].n);
  assert.equal(await read(armorer, A), 1);
  assert.equal(await read(viewer, A), 1, "view_history alone suffices");
  assert.equal(await read(eli, A), 0, "an officer without history permission reads none");
  assert.equal(await read(kris, A), 0, "nor does the holder");
  assert.equal(await read(foreignArmorer, B), 0, "another agency reads none");
  assert.equal(await read(foreignArmorer, A), 0, "selecting another agency grants nothing");
  // Current custody stays visible to members, as 028 intended.
  assert.equal(await as(eli, A, async (c) => (await c.query("select count(*)::int n from public.firearm_current_custody where firearm_id=$1", [gun])).rows[0].n), 1);
});

test("custody transfers enforce the active agency, an active receiving officer and one holder; legitimate transfers work", async () => {
  const gun = await firearm();
  const assignment = await issue(gun, kris);
  await as(armorer, A, (c) => transfer(c, gun, "OFFICER", kris, null));
  await as(armorer, A, (c) => transfer(c, gun, "SECURE_STORAGE", null, vault));
  assert.deepEqual((await owner.query("select assignment_id,holder_type,storage_location_id from public.firearm_current_custody where firearm_id=$1", [gun])).rows[0], { assignment_id: assignment, holder_type: "SECURE_STORAGE", storage_location_id: vault });
  assert.equal(await count("select count(*) v from public.audit_events where entity_id=$1 and action='firearm_custody_transferred'", [gun]), 2);
  // Temporary custody to another active member stays allowed (028; the route offers it).
  await as(armorer, A, (c) => transfer(c, gun, "OFFICER", eli, null));

  const refusals: Array<[string, () => Promise<unknown>, RegExp, number]> = [
    ["non-member officer", () => as(armorer, A, (c) => transfer(c, gun, "OFFICER", outsider, null)), /custody officer unavailable/, 400],
    ["officer of another agency", () => as(armorer, A, (c) => transfer(c, gun, "OFFICER", foreignOfficer, null)), /custody officer unavailable/, 400],
    ["officer with a storage location", () => as(armorer, A, (c) => transfer(c, gun, "OFFICER", kris, vault)), /invalid custody holder/, 400],
    ["storage with an officer", () => as(armorer, A, (c) => transfer(c, gun, "SECURE_STORAGE", kris, vault)), /invalid custody holder/, 400],
    ["another agency's storage", () => as(armorer, A, (c) => transfer(c, gun, "SECURE_STORAGE", null, foreignVault)), /storage location unavailable/, 400],
    ["member of both agencies acting in the other", () => as(dual, B, (c) => transfer(c, gun, "SECURE_STORAGE", null, vault)), /firearm unavailable/, 404],
    ["another agency's armorer", () => as(foreignArmorer, B, (c) => transfer(c, gun, "SECURE_STORAGE", null, foreignVault)), /firearm unavailable/, 404],
    ["officer without custody permission", () => as(kris, A, (c) => transfer(c, gun, "SECURE_STORAGE", null, vault)), /custody permission required/, 403],
  ];
  for (const [label, attempt, message, status] of refusals) {
    const error = await reject(attempt()) as { message: string; code?: string };
    assert.match(error.message, message, label);
    assert.equal(custodyTransferFailure(error).status, status, `${label} maps to ${status}`);
  }
  assert.deepEqual((await owner.query("select holder_type,holder_user_id from public.firearm_current_custody where firearm_id=$1", [gun])).rows[0], { holder_type: "OFFICER", holder_user_id: eli });
  assert.equal(await count("select count(*) v from public.department_memberships where user_id=$1 and is_active", [dual]), 2, "the dual member belongs to both agencies");
  // The member of both agencies, acting in this one, may transfer; a racing return is still refused whole by 067's guard.
  await as(dual, A, (c) => transfer(c, gun, "SECURE_STORAGE", null, vault));
});

test("067 behaviour is kept: Duty Only names the assignee, restricted check-in and check-out work, return releases custody", async () => {
  const gun = await firearm();
  const assignment = await issue(gun, kris);
  await restrict(gun);
  assert.deepEqual((await owner.query("select assignment_id,holder_type,holder_user_id from public.firearm_current_custody where firearm_id=$1", [gun])).rows[0], { assignment_id: assignment, holder_type: "OFFICER", holder_user_id: kris });
  await as(kris, A, (c) => c.query("select public.operate_restricted_firearm_custody($1,'CHECK_IN',$2,null,$3)", [gun, vault, key()]));
  await as(kris, A, (c) => c.query("select public.operate_restricted_firearm_custody($1,'CHECK_OUT',null,null,$2)", [gun, key()]));
  const refused = await reject(as(eli, A, (c) => c.query("select public.operate_restricted_firearm_custody($1,'CHECK_IN',$2,null,$3)", [gun, vault, key()]))) as { message: string };
  assert.equal(restrictedCustodyFailure(refused).status, 403);
  await giveBack(gun);
  assert.equal(await count("select count(*) v from public.firearm_current_custody where firearm_id=$1", [gun]), 0);
});

test("the restored CHECK constraints refuse blank values", async () => {
  for (const [sql, values] of [
    ["insert into public.firearm_storage_locations(department_id,name) values($1,' ')", [A]],
    ["insert into public.firearm_storage_locations(department_id,name,location_kind) values($1,'Locker','locker')", [A]],
  ] as Array<[string, unknown[]]>) {
    const error = await reject(owner.query(sql, values)) as { code?: string };
    assert.equal(error.code, "23514");
  }
  const gun = await firearm();
  await issue(gun, kris);
  const restriction = await restrict(gun);
  assert.equal((await reject(owner.query("update public.firearm_possession_restrictions set reason_category=' ' where id=$1", [restriction])) as { code?: string }).code, "23514");
  assert.equal((await reject(owner.query("insert into public.firearm_custody_events(department_id,firearm_id,to_holder_type,to_holder_user_id,initiating_user_id,action_type,reason,idempotency_key) values($1,$2,'OFFICER',$3,$3,'TRANSFER',' ',gen_random_uuid())", [A, gun, kris])) as { code?: string }).code, "23514");
});

test("notification enqueue is restored for the runtime's own session and refused to every other caller", async () => {
  const fingerprint = key();
  await owner.query("insert into public.notification_events(department_id,user_id,notification_key,source,kind,title,detail,href,fingerprint) values($1,$2,'b4-critical','armory','alert','Critical','Batch 4','/firearms',$3)", [A, kris, fingerprint]);
  const args = [A, kris, `${kris.slice(-2)}@example.test`, "b4-critical", fingerprint, "Critical item", "Body", new Date().toISOString(), "Pending", new Date().toISOString()];
  const enqueue = "select tracepoint_auth.enqueue_notification_email($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) v";
  const client = await runtime.connect();
  try { assert.equal((await client.query(enqueue, args)).rows[0].v, true); } finally { client.release(); }
  assert.equal(await count("select count(*) v from public.notification_email_queue where department_id=$1 and user_id=$2 and fingerprint=$3", [A, kris, fingerprint]), 1);
  const asAuthenticated = await reject(as(kris, A, (c) => c.query(enqueue, args))) as { code?: string };
  assert.equal(asAuthenticated.code, "42501");
  const wrongRecipient = await runtime.connect();
  try { await assert.rejects(wrongRecipient.query(enqueue, [...args.slice(0, 2), "someone@example.test", ...args.slice(3)]), /notification enqueue rejected/); } finally { wrongRecipient.release(); }
});

test("invitation retry inspect and claim are restored and resume the original pending invite exactly once", async () => {
  const provider = key();
  await owner.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'invitee@example.test',jsonb_build_object('identity_provider','cognito'))", [invited]);
  await owner.query("insert into public.profiles(id,full_name,email) values($1,'Ivy Invitee','invitee@example.test') on conflict(id) do update set full_name=excluded.full_name,email=excluded.email", [invited]);
  await owner.query("insert into public.department_memberships(department_id,user_id,is_active,activation_status) values($1,$2,true,'pending_activation')", [A, invited]);
  await owner.query("insert into public.department_membership_roles(department_id,user_id,role_code) values($1,$2,'officer')", [A, invited]);
  await owner.query("insert into public.authentication_lifecycle_operations(id,operation_kind,tracepoint_user_id,department_id,actor_user_id,provider_username,state,safe_error_code) values($1,'invite',$2,$3,$4,$5,'compensation_required','provider_create_failed')", [operation, invited, A, armorer, provider]);
  const args = [A, "invitee@example.test", "Ivy Invitee", "", "", "", "", ["officer"], []];
  const inspected = await as(armorer, A, async (c) => (await c.query("select * from tracepoint_auth.inspect_cognito_invite_retry($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::uuid[])", args)).rows);
  assert.deepEqual(inspected, [{ user_id: invited, operation_id: operation, provider_username: provider }]);
  const claimed = await as(armorer, A, async (c) => (await c.query("select * from tracepoint_auth.claim_cognito_invite_retry($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::uuid[],$10)", [...args, operation])).rows);
  assert.deepEqual(claimed, [{ user_id: invited, operation_id: operation, provider_username: provider }]);
  assert.deepEqual((await owner.query("select state,attempts from public.authentication_lifecycle_operations where id=$1", [operation])).rows[0], { state: "prepared", attempts: 1 });
  await assert.rejects(as(armorer, A, (c) => c.query("select * from tracepoint_auth.claim_cognito_invite_retry($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::uuid[],$10)", [...args, operation])), /invite retry lifecycle mismatch/);
  await assert.rejects(as(eli, A, (c) => c.query("select * from tracepoint_auth.inspect_cognito_invite_retry($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::uuid[])", args)), /invite retry forbidden/);
  await assert.rejects(as(foreignArmorer, B, (c) => c.query("select * from tracepoint_auth.inspect_cognito_invite_retry($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::uuid[])", args)), /invite retry forbidden/);
});

test("070 ended the restriction AT-5 left active, with an audit entry, and left the other agency's restriction alone", async () => {
  assert.equal(await count("select count(*) v from public.firearm_possession_restrictions where id=$1 and is_active", [seeded.staleRestriction]), 0);
  assert.equal(await count("select count(*) v from public.audit_events where entity_id=$1 and action='firearm_restriction_removed' and new_value->>'migration'='070' and new_value->>'restriction_id'=$2", [seeded.staleGun, seeded.staleRestriction]), 1);
  assert.equal(await count("select count(*) v from public.firearm_possession_restrictions where id=$1 and is_active", [seeded.foreignRestriction]), 1);
});

test("AT-5: returning an assignment ends its restriction; re-issue starts unrestricted and the previous officer holds nothing active", async () => {
  const gun = await firearm();
  await issue(gun, kris);
  const restriction = await restrict(gun);
  await giveBack(gun);
  assert.equal(await count("select count(*) v from public.firearm_possession_restrictions where firearm_id=$1 and is_active", [gun]), 0);
  assert.equal(await count("select count(*) v from public.audit_events where entity_id=$1 and action='firearm_restriction_removed' and actor_user_id=$2 and new_value->>'ended_by'='assignment_returned' and new_value->>'restriction_id'=$3", [gun, armorer, restriction]), 1);
  const visibleToKris = await as(kris, A, async (c) => (await c.query("select count(*)::int n from public.firearm_possession_restrictions where firearm_id=$1 and is_active", [gun])).rows[0].n);
  assert.equal(visibleToKris, 0);
  await issue(gun, eli);
  assert.equal(await count("select count(*) v from public.firearm_possession_restrictions where firearm_id=$1 and is_active", [gun]), 0, "the re-issued firearm is unrestricted");
  await assert.rejects(as(eli, A, (c) => c.query("select public.operate_restricted_firearm_custody($1,'CHECK_IN',$2,null,$3)", [gun, vault, key()])), /active assigned firearm restriction required/);
  // The new assignee's own restriction works as before, and No Carry ends the same way.
  await restrict(gun, "no_carry");
  await giveBack(gun);
  assert.equal(await count("select count(*) v from public.firearm_possession_restrictions where firearm_id=$1 and is_active", [gun]), 0);
  assert.equal(await count("select count(*) v from public.firearm_possession_restrictions where id=$1 and is_active", [seeded.foreignRestriction]), 1, "another agency is untouched");
});

test("an active restriction cannot name a returned assignment or another firearm's or agency's; a restriction racing a return is refused whole", async () => {
  const gun = await firearm(), other = await firearm(), foreignGun = await firearm(B);
  const returnedAssignment = await issue(gun, kris);
  await giveBack(gun);
  const otherAssignment = await issue(other, eli);
  const foreignAssignment = await issue(foreignGun, foreignOfficer, B, foreignArmorer);
  for (const assignment of [returnedAssignment, otherAssignment, foreignAssignment]) {
    const error = await reject(owner.query("insert into public.firearm_possession_restrictions(department_id,firearm_id,assignment_id,reason_category,restriction_type,duty_only) values($1,$2,$3,'test','duty_only',true)", [A, gun, assignment])) as { code?: string; message: string };
    assert.equal(error.code, "40001");
    assert.equal(restrictedCustodyFailure(error).status, 409);
  }

  const raced = await firearm();
  await issue(raced, kris);
  const returning = await runtime.connect();
  await returning.query("begin");
  await returning.query("set local role authenticated");
  await returning.query("select set_config('tracepoint.subject_id',$1,true),set_config('tracepoint.department_id',$2,true)", [armorer, A]);
  await returning.query(returnSql, [raced, A, armorer]);
  const restricting = restrict(raced).then(() => "applied", (error: { code?: string }) => error.code ?? "failed");
  await new Promise((resolve) => setTimeout(resolve, 300));
  try { await returning.query("commit"); } finally { returning.release(); }
  assert.equal(await restricting, "40001");
  assert.equal(await count("select count(*) v from public.firearm_possession_restrictions where firearm_id=$1 and is_active", [raced]), 0);
});
