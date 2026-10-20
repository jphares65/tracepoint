import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";
import { MODULE_FEATURE, OPERATIONAL_MODULE_CATALOG } from "./module-catalog.ts";

const existing = "10000000-0000-4000-8000-000000000001";
const later = "10000000-0000-4000-8000-000000000002";
const admin = "20000000-0000-4000-8000-000000000001";
let server: EmbeddedPostgres;
let owner: pg.Pool;
let runtime: pg.Pool;
let directory: string;
const migration = (name: string) => readFile(path.join("database/aws", name), "utf8");

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-module-toggle-test-"));
  const port = await localPostgresPort();
  server = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "local-test-only", port, persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  owner = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "local-test-only", database: "postgres" });
  // The minimum of the platform schema that 015, 042 and 046 touch, with the runtime login and identity stubs.
  await owner.query(`
    create role anon; create role authenticated; create role service_role;
    create role tracepoint_runtime login password 'local-test-only';
    create schema tracepoint_auth;
    create function tracepoint_auth.subject_id() returns uuid language sql stable as $$ select '${admin}'::uuid $$;
    create function public.is_platform_admin() returns boolean language sql stable as $$ select true $$;
    create table public.departments (id uuid primary key, name text not null, short_name text);
    create table public.feature_catalog (code text primary key, display_name text not null, description text, sort_order integer not null default 0, is_active boolean not null default true, created_at timestamptz not null default now());
    create table public.department_features (department_id uuid not null references public.departments(id) on delete cascade, feature_code text not null references public.feature_catalog(code), is_enabled boolean not null default false, enabled_at timestamptz, disabled_at timestamptz, updated_at timestamptz not null default now(), updated_by uuid, primary key(department_id, feature_code));
    create table public.department_feature_events (id uuid primary key default gen_random_uuid(), department_id uuid not null references public.departments(id) on delete cascade, feature_code text not null references public.feature_catalog(code), previous_enabled boolean, new_enabled boolean not null, actor_user_id uuid, reason text, created_at timestamptz not null default now());
    insert into public.departments values ('${existing}', 'Demo Township PD', 'Demo PD');
  `);
  for (const name of ["015_platform_entitlements.sql", "042_default_module_entitlements.sql", "046_agency_documents_module_toggle.sql"]) await owner.query(await migration(name));
  await owner.query("grant execute on function public.get_platform_entitlements(), public.set_platform_entitlement(uuid, text, boolean, text) to tracepoint_runtime");
  runtime = new pg.Pool({ host: "127.0.0.1", port, user: "tracepoint_runtime", password: "local-test-only", database: "postgres" });
});

after(async () => {
  await runtime?.end();
  await owner?.end();
  await server?.stop();
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function entitlement(departmentId: string, code: string) {
  const { rows } = await owner.query("select is_enabled, enabled_at, disabled_at from public.department_features where department_id = $1 and feature_code = $2", [departmentId, code]);
  return rows[0] as { is_enabled: boolean; enabled_at: Date | null; disabled_at: Date | null } | undefined;
}

test("the catalog migrations seed every canonical module with its default", async () => {
  const { rows } = await owner.query("select code, display_name, sort_order, is_active, default_enabled from public.feature_catalog order by code");
  assert.deepEqual(rows.map((row) => row.code), OPERATIONAL_MODULE_CATALOG.map((module) => module.code).sort());
  for (const module of OPERATIONAL_MODULE_CATALOG) {
    const row = rows.find((candidate) => candidate.code === module.code);
    assert.deepEqual([row.display_name, row.sort_order, row.is_active, row.default_enabled], [module.displayName, module.sortOrder, true, module.defaultEnabled ?? true], module.code);
  }
});

test("existing agencies get Agency Documents disabled, with an audit event, and keep every 042 module", async () => {
  const documents = await entitlement(existing, MODULE_FEATURE.AGENCY_DOCUMENTS);
  assert.equal(documents?.is_enabled, false);
  assert.equal(documents?.enabled_at, null);
  assert.ok(documents?.disabled_at instanceof Date);
  assert.equal((await entitlement(existing, MODULE_FEATURE.FIREARMS))?.is_enabled, true);
  const events = await owner.query("select previous_enabled, new_enabled, actor_user_id, reason from public.department_feature_events where department_id = $1 and feature_code = 'agency_documents'", [existing]);
  assert.deepEqual(events.rows, [{ previous_enabled: null, new_enabled: false, actor_user_id: admin, reason: "New module added to the operational feature catalog; disabled until a platform administrator enables it." }]);
});

test("a new agency starts with Agency Documents off and the other modules on", async () => {
  await owner.query("insert into public.departments values ($1, 'Pilot PD', null)", [later]);
  assert.equal((await entitlement(later, MODULE_FEATURE.AGENCY_DOCUMENTS))?.is_enabled, false);
  assert.equal((await entitlement(later, MODULE_FEATURE.QUALIFICATIONS))?.is_enabled, true);
});

test("the platform administrator turns Agency Documents on and off per agency, and replays never re-enable it", async () => {
  const features = (await runtime.query("select public.get_platform_entitlements() as value")).rows[0].value.features as { code: string }[];
  assert.ok(features.some((feature) => feature.code === MODULE_FEATURE.AGENCY_DOCUMENTS), "listed in the platform catalog");
  await runtime.query("select public.set_platform_entitlement($1, 'agency_documents', true, 'Pilot agency')", [existing]);
  assert.equal((await entitlement(existing, MODULE_FEATURE.AGENCY_DOCUMENTS))?.is_enabled, true);
  assert.equal((await entitlement(later, MODULE_FEATURE.AGENCY_DOCUMENTS))?.is_enabled, false, "only the chosen agency changes");
  await owner.query(await migration("046_agency_documents_module_toggle.sql"));
  assert.equal((await entitlement(existing, MODULE_FEATURE.AGENCY_DOCUMENTS))?.is_enabled, true, "a replay keeps the administrator's choice");
  assert.equal((await entitlement(later, MODULE_FEATURE.AGENCY_DOCUMENTS))?.is_enabled, false);
  await runtime.query("select public.set_platform_entitlement($1, 'agency_documents', false, 'Pilot ended')", [existing]);
  assert.equal((await entitlement(existing, MODULE_FEATURE.AGENCY_DOCUMENTS))?.is_enabled, false);
  const events = await owner.query("select previous_enabled, new_enabled, reason from public.department_feature_events where department_id = $1 and feature_code = 'agency_documents' order by created_at, id", [existing]);
  assert.deepEqual(events.rows.slice(1).map((row) => [row.previous_enabled, row.new_enabled, row.reason]), [[false, true, "Pilot agency"], [true, false, "Pilot ended"]]);
});
