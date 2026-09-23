import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";
import { PostgresDataClient } from "../database/postgres-data-client.ts";
import { TenantBoundRangeReadRepository, RangeReadAuthorizationError } from "../range/read-repository-core.ts";
import { SupabaseRangeReadDataSource } from "../range/read-repository-supabase.ts";
import { TenantBoundPersonalRifleReadRepository, PersonalRifleReadAuthorizationError } from "../personal-rifles/read-repository-core.ts";
import { SupabasePersonalRifleReadDataSource } from "../personal-rifles/read-repository-supabase.ts";
import { PostgresArmoryReadDataSource } from "../armory/read-repository-postgres.ts";
import { TenantBoundArmoryReadRepository, ArmoryReadAuthorizationError } from "../armory/read-repository-core.ts";
import { createCurrentRulesRepository, mapCurrentRules, type CurrentRulesSupabaseClient } from "../department-rules/current-rules-repository-core.ts";

const department = "10000000-0000-4000-8000-000000000001";
const otherDepartment = "10000000-0000-4000-8000-000000000002";
const user = "20000000-0000-4000-8000-000000000001";
const otherUser = "20000000-0000-4000-8000-000000000002";
const rifleId = "30000000-0000-4000-8000-000000000001";
const firearmId = "40000000-0000-4000-8000-000000000001";
let server: EmbeddedPostgres;
let pool: pg.Pool;
let directory: string;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-home-read-"));
  const port = await localPostgresPort();
  server = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "local-test-only", port, persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "local-test-only", database: "postgres" });
  await pool.query(`
    create role authenticated;
    create table public.department_memberships (department_id uuid, user_id uuid, badge_number text, rank_title text, unit_name text, employee_number text, is_active boolean, joined_at timestamptz);
    create table public.department_membership_roles (department_id uuid, user_id uuid, role_code text);
    create table public.profiles (id uuid primary key, full_name text, email text);
    create table public.personal_rifles (id uuid primary key, department_id uuid, owner_user_id uuid, manufacturer text, model text, caliber text, status text, submitted_at timestamptz, correction_notes text, armorer_decision_notes text, chief_decision_notes text, expiration_date date, updated_at timestamptz);
    create table public.personal_rifle_status_history (id uuid primary key, department_id uuid, personal_rifle_id uuid, actor_user_id uuid, created_at timestamptz);
    create table public.pilot_ammunition_workspaces (department_id uuid, workspace jsonb, updated_at timestamptz);
    create table public.pilot_range_workspaces (department_id uuid, workspace jsonb, updated_at timestamptz, updated_by_user_id uuid);
    create table public.pilot_remediation_workspaces (department_id uuid, remediations jsonb, updated_at timestamptz);
    create table public.department_qualification_standards (id uuid primary key, department_id uuid, name text, firearm_type text, is_active boolean);
    create table public.department_qualification_standard_components (id uuid primary key, department_id uuid, qualification_standard_id uuid, name text, scoring_basis text, passing_score numeric, passing_time_seconds numeric, minimum_hits integer, is_required boolean, is_active boolean, sort_order integer);
    create table public.qualification_results (id uuid primary key, department_id uuid, officer_user_id uuid, qualification_date date, lighting_condition text, score numeric, passed boolean, expires_on date, notes text);
    create table public.range_days (id uuid primary key, department_id uuid, title text, range_date date, status text, range_type text, packet_status text);
    create table public.range_day_drills (id uuid primary key, department_id uuid, range_day_id uuid, name text, category text, scoring_format text, passing_score numeric, max_score numeric, passing_time_seconds numeric);
    create table public.drill_run_results (id uuid primary key, department_id uuid, range_day_id uuid, range_day_drill_id uuid, officer_user_id uuid, run_number integer, scoring_format_snapshot text, completed boolean, score numeric, time_seconds numeric, hit_count integer, passed boolean, notes text, deficiency_observed boolean, remedial_training_recommended boolean, recorded_at timestamptz);
    create table public.range_day_roster (id uuid primary key, department_id uuid, range_day_id uuid, officer_user_id uuid, attendance_status text);
    create table public.department_rules (department_id uuid, spring_cycle_start text, spring_cycle_end text, fall_cycle_start text, fall_cycle_end text, qualification_valid_days integer, qualification_due_soon_days integer, inspection_interval_days integer, battery_check_interval_days integer, off_duty_renewal_days integer, range_qualification_rules jsonb);
    create table public.firearms (id uuid primary key, department_id uuid, make text, model text, serial_number text, firearm_type text, caliber text, asset_number text, condition_status text, notes text, needs_attention boolean, attention_reasons text, is_active boolean, archived_at timestamptz, archived_by_user_id uuid, archive_reason text, created_at timestamptz, updated_at timestamptz);
    create table public.firearm_assignments (id uuid primary key, department_id uuid, firearm_id uuid, assigned_to_user_id uuid, assigned_at timestamptz, magazines_issued integer, magazine_description text, magazines_returned integer, magazine_discrepancy_reason text, returned_at timestamptz);
    create table public.firearm_inspections (id uuid primary key, department_id uuid, firearm_id uuid, inspection_date date);
    create table public.firearm_inspection_items (id uuid primary key, department_id uuid, inspection_id uuid, section text, label text, status text, note text, critical boolean, sort_order integer);
    grant usage on schema public to authenticated;
    grant select on all tables in schema public to authenticated;
  `);
  const scoped = ["department_memberships", "department_membership_roles", "personal_rifles", "personal_rifle_status_history", "pilot_ammunition_workspaces", "pilot_range_workspaces", "pilot_remediation_workspaces", "department_qualification_standards", "department_qualification_standard_components", "qualification_results", "range_days", "range_day_drills", "drill_run_results", "range_day_roster", "department_rules", "firearms", "firearm_assignments", "firearm_inspections", "firearm_inspection_items"];
  for (const table of scoped) {
    await pool.query(`alter table public.${table} enable row level security`);
    await pool.query(`create policy tenant_read on public.${table} to authenticated using (department_id = current_setting('tracepoint.department_id')::uuid)`);
  }
  await pool.query(`alter table public.profiles enable row level security`);
  await pool.query(`create policy profile_read on public.profiles to authenticated using (id = current_setting('tracepoint.subject_id')::uuid or exists (select 1 from public.department_memberships m where m.user_id = profiles.id and m.department_id = current_setting('tracepoint.department_id')::uuid))`);
  await pool.query("insert into public.department_memberships(department_id,user_id,is_active,rank_title) values($1,$2,true,'Officer'),($3,$4,true,'Officer')", [department, user, otherDepartment, otherUser]);
  await pool.query("insert into public.profiles(id,full_name,email) values($1,'Shadow Tester','shadow@example.test'),($2,'Other Tenant','other@example.test')", [user, otherUser]);
  await pool.query("insert into public.personal_rifles(id,department_id,owner_user_id,manufacturer,model,status,updated_at) values($1,$2,$3,'Test','Rifle','Approved',now()),('30000000-0000-4000-8000-000000000002',$4,$5,'Other','Rifle','Approved',now())", [rifleId, department, user, otherDepartment, otherUser]);
  await pool.query("insert into public.personal_rifle_status_history(id,department_id,personal_rifle_id,actor_user_id,created_at) values('31000000-0000-4000-8000-000000000001',$1,$2,$3,now()),('31000000-0000-4000-8000-000000000002',$4,'30000000-0000-4000-8000-000000000002',$5,now())", [department, rifleId, user, otherDepartment, otherUser]);
  await pool.query("insert into public.pilot_ammunition_workspaces(department_id,workspace,updated_at) values($1,'{\"ammoTypes\":[]}',now()),($2,'{\"ammoTypes\":[{\"name\":\"hidden\"}]}',now())", [department, otherDepartment]);
  await pool.query("insert into public.pilot_range_workspaces(department_id,workspace,updated_at) values($1,'{\"rangeDays\":[]}',now()),($2,'{\"rangeDays\":[{\"title\":\"hidden\"}]}',now())", [department, otherDepartment]);
  await pool.query("insert into public.department_qualification_standards(id,department_id,name,firearm_type,is_active) values('32000000-0000-4000-8000-000000000001',$1,'Zulu','handgun',true),('32000000-0000-4000-8000-000000000002',$1,'Alpha','rifle',true),('32000000-0000-4000-8000-000000000003',$2,'Hidden','rifle',true)", [department, otherDepartment]);
  await pool.query("insert into public.department_qualification_standard_components(id,department_id,qualification_standard_id,name,is_required,is_active,sort_order) values('33000000-0000-4000-8000-000000000001',$1,'32000000-0000-4000-8000-000000000001','Day',true,true,1),('33000000-0000-4000-8000-000000000002',$2,'32000000-0000-4000-8000-000000000003','Hidden',true,true,1)", [department, otherDepartment]);
  await pool.query("insert into public.qualification_results(id,department_id,officer_user_id,qualification_date,passed) values('34000000-0000-4000-8000-000000000001',$1,$2,'2026-09-01',true),('34000000-0000-4000-8000-000000000002',$3,$4,'2026-09-01',true)", [department, user, otherDepartment, otherUser]);
  await pool.query("insert into public.department_rules(department_id,qualification_valid_days,range_qualification_rules) values($1,400,'{}'),($2,100,'{}')", [department, otherDepartment]);
  await pool.query("insert into public.firearms(id,department_id,make,model,is_active,condition_status) values($1,$2,'Test','Pistol',true,'In Service'),('40000000-0000-4000-8000-000000000002',$3,'Other','Pistol',true,'In Service')", [firearmId, department, otherDepartment]);
  await pool.query("insert into public.firearm_assignments(id,department_id,firearm_id,assigned_to_user_id,assigned_at) values('41000000-0000-4000-8000-000000000001',$1,$2,$3,now()),('41000000-0000-4000-8000-000000000002',$4,'40000000-0000-4000-8000-000000000002',$5,now())", [department, firearmId, user, otherDepartment, otherUser]);
  await pool.query("insert into public.firearm_inspections(id,department_id,firearm_id,inspection_date) values('50000000-0000-4000-8000-000000000001',$1,$2,'2026-09-01'),('50000000-0000-4000-8000-000000000002',$3,'40000000-0000-4000-8000-000000000002','2026-09-01')", [department, firearmId, otherDepartment]);
});

after(async () => { await pool?.end(); await server?.stop(); if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
const client = (subject = user, tenant = department) => new PostgresDataClient(pool, subject, tenant);

test("PostgreSQL personal rifle reads preserve department and owner scope", async () => {
  const repo = new TenantBoundPersonalRifleReadRepository(new SupabasePersonalRifleReadDataSource(client()), department, user);
  assert.deepEqual((await repo.listInbox(department, user)).map(row => row.id), [rifleId]);
  assert.deepEqual((await repo.listRifles(department, user, false)).map(row => row.id), [rifleId]);
  assert.equal((await repo.listHistory(department, user, [rifleId, "30000000-0000-4000-8000-000000000002"])).length, 1);
  assert.throws(() => repo.listInbox(otherDepartment, user), PersonalRifleReadAuthorizationError);
  assert.deepEqual(await repo.listInbox(department, user).then(rows => rows.filter(row => row.manufacturer === "Other")), []);
});

test("PostgreSQL range, ammunition, qualification and current rules preserve empty and tenant semantics", async () => {
  const data = client();
  const repo = new TenantBoundRangeReadRepository(new SupabaseRangeReadDataSource(data), department);
  assert.deepEqual((await repo.getAmmunition(department))?.workspace, { ammoTypes: [] });
  assert.deepEqual((await repo.getWorkspace(department)).workspace, { rangeDays: [] });
  assert.deepEqual((await repo.getWorkspace(department)).qualificationStandards.map(row => row.name), ["Alpha", "Zulu"]);
  assert.deepEqual((await repo.getWorkspace(department)).qualificationStandards[1].components.map(row => row.name), ["Day"]);
  assert.deepEqual((await repo.getPersonnel(department)).memberships.map(row => row.user_id), [user]);
  assert.equal((await repo.getPerformanceInputs(department)).qualificationResults.length, 1);
  await assert.rejects(repo.getWorkspace(otherDepartment), RangeReadAuthorizationError);
  const rules = createCurrentRulesRepository(data as unknown as CurrentRulesSupabaseClient, department, { TRACEPOINT_DATA_PROVIDER: "postgres" });
  assert.equal(mapCurrentRules(await rules.getCurrentRules({ departmentId: department })).qualification_valid_days, 400);
  await assert.rejects(rules.getCurrentRules({ departmentId: otherDepartment }));
  const other = new TenantBoundRangeReadRepository(new SupabaseRangeReadDataSource(client(otherUser, otherDepartment)), otherDepartment);
  assert.equal(((await other.getAmmunition(otherDepartment))?.workspace as { ammoTypes: { name: string }[] })?.ammoTypes?.[0]?.name, "hidden");
});

test("PostgreSQL armory inspection joins, inventory and profile directory stay tenant scoped", async () => {
  const data = client();
  const repo = new TenantBoundArmoryReadRepository(new PostgresArmoryReadDataSource(data as unknown as ConstructorParameters<typeof PostgresArmoryReadDataSource>[0]), department, user);
  const inspections = await repo.listInspections({ departmentId: department, userId: user });
  assert.equal(inspections.length, 1);
  assert.equal((inspections[0].firearm as { id: string }).id, firearmId);
  assert.deepEqual(inspections[0].items, []);
  const inventory = await repo.getFirearmInventory({ departmentId: department, userId: user, includeArchived: false, canViewAll: true, canManage: true, canInspect: true });
  assert.deepEqual(inventory.firearms.map(row => (row as unknown as { id: string }).id), [firearmId]);
  assert.equal((inventory.firearms[0].active_assignment as unknown as { assigned_to_user_id: string }).assigned_to_user_id, user);
  assert.equal(inventory.members[0].full_name, "Shadow Tester");
  await assert.rejects(repo.listInspections({ departmentId: otherDepartment, userId: user }), ArmoryReadAuthorizationError);
});
