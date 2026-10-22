import { createHash } from "node:crypto";

// Guarded, ledger-free release units for the live final-cutover database.
// Its schema lineage is partial (001-026 plus 028, 029, 032, and the range
// workspace migration now numbered 043), so the
// ledgered apply path cannot target it. Each unit runs its pinned migration
// files as one transaction and commits only after its postconditions hold.

export const liveOwnerActions = Object.freeze(["precheck", "inventory-035-037", "password-scope-039-040", "agency-documents-038-048"]);

export const liveReleaseUnits = Object.freeze({
  "inventory-035-037": Object.freeze([
    { version: 35, filename: "035_inventory_phase1.sql", sha256: "e617ea34b4403e0af34934de77b66f589940066f85faa5e04eb10062cdc39861" },
    { version: 36, filename: "036_inventory_checkout_phase2a.sql", sha256: "e9298b65d290293c66a2f2420a7775a55a342b5c111db9b9cbaab6f8dc3ad7fc" },
    { version: 37, filename: "037_inventory_management_runtime_grants.sql", sha256: "8aad48a4378d7b69e392e0cdd2869e1e8a55226c0feb47e137b8006e21064f97" },
  ]),
  // The unit keeps its original name (it is recorded in release evidence); its
  // files were renumbered 039/040 -> 044/045 with identical contents when the
  // Agency Documents lineage kept 038-041.
  "password-scope-039-040": Object.freeze([
    { version: 44, filename: "044_cognito_password_global_scope.sql", sha256: "3916971b7ffee8e9aa0b44269ab251c1a6f780aae1b4ac9cbc450c98be3dc987" },
    { version: 45, filename: "045_password_operation_resolution.sql", sha256: "3a6e582e16afc402696ee162cbd046e27703a0dc0ed36701031ff84604033e6b" },
  ]),
  // Agency Documents (038-041), its default-off module toggle (046), the Fleet/Inventory catalog rows (047) and
  // their activation (048; production imported them inactive).
  // 042 (default module entitlements) is deliberately absent: its triggers and backfill would enable every
  // module for every production agency.
  "agency-documents-038-048": Object.freeze([
    { version: 38, filename: "038_agency_documents_template_builder.sql", sha256: "e5d9731e6eef405945ca1c222c69bdd76559646fc97c393beec537cd656eee89" },
    { version: 39, filename: "039_document_template_analysis.sql", sha256: "894c51ea4d74e8e6d4a6b988a4bf3add34266cf5fde9a199f18a2660ecfa6086" },
    { version: 40, filename: "040_document_template_structured_bindings.sql", sha256: "908c2e8704c331d4122ee820143ab645f851761c9747b6d65dee8743e3007525" },
    { version: 41, filename: "041_document_template_write_authority.sql", sha256: "e0d5cb1b4abb1257debff25c6de00785e7853b9b5157b459cae592f8545ca06c" },
    { version: 46, filename: "046_agency_documents_module_toggle.sql", sha256: "f308741ec52ab2947cc5cf8a08bde0e20e0dd7d89c25b633ccc0c714f1457f4b" },
    { version: 47, filename: "047_fleet_inventory_feature_catalog.sql", sha256: "b1ca090ad5fb0f5b09f20cb6620cc59737b03303798bd0c21b911906138338ab" },
    { version: 48, filename: "048_activate_fleet_inventory_catalog.sql", sha256: "a62ff9e684fb9f5ce1ba79d1ca59e9b1cbc00c8989967dfd643df7c4fdcc20ea" },
  ]),
});

const inventoryTables = ["inventory_items", "inventory_locations", "inventory_balances", "inventory_transactions", "inventory_checkouts", "inventory_checkout_returns"];
const passwordScopeTables = ["authentication_lifecycle_operations", "department_memberships", "platform_admins"];
const agencyDocumentTables = ["document_templates", "document_template_versions", "document_template_fields", "generated_documents",
  "document_template_analysis_proposals", "document_template_structured_bindings"];
const agencyDocumentPermissions = ["view_agency_documents", "generate_agency_documents", "manage_document_templates"];
// 042's auto-enable triggers; production must never have them.
const moduleEntitlementTriggers = ["departments_default_module_entitlements", "feature_catalog_default_department_entitlements"];
const entitlementDigestSql = "select md5(coalesce(string_agg(department_id::text || ':' || feature_code || ':' || coalesce(is_enabled::text, 'null'), ',' order by department_id, feature_code), '')) from public.department_features";

// Line endings depend on the checkout that built the image; pins use LF.
export function normalizedSha256(contents) {
  return createHash("sha256").update(String(contents).replace(/\r\n/g, "\n")).digest("hex");
}

// Files own one outer BEGIN/COMMIT. A unit strips it and runs every body in
// its own single transaction, so a body must contain no other transaction
// control outside quoted text, comments, or function bodies.
export function transactionBody(contents) {
  const match = String(contents).match(/^\s*begin;([\s\S]*)commit;\s*$/i);
  if (!match) throw new Error("LIVE_RELEASE_UNIT_FILE_NOT_TRANSACTIONAL");
  const statementsOnly = match[1]
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, " ")
    .replace(/'(?:''|[^'])*'/g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  if (/(^|;)\s*(begin|commit|rollback|end|abort|savepoint|release|start\s+transaction|set\s+transaction|prepare\s+transaction)\b/i.test(statementsOnly)) {
    throw new Error("LIVE_RELEASE_UNIT_FILE_HAS_NESTED_TRANSACTION_CONTROL");
  }
  return match[1];
}

export function selectUnitFiles(unit, files) {
  const pinned = liveReleaseUnits[unit];
  if (!pinned) throw new Error("LIVE_RELEASE_UNIT_UNKNOWN");
  return pinned.map(pin => {
    const matches = files.filter(file => file.version === pin.version);
    if (matches.length !== 1 || matches[0].filename !== pin.filename || normalizedSha256(matches[0].contents) !== pin.sha256) {
      throw new Error(`LIVE_RELEASE_UNIT_FILE_MISMATCH: ${pin.filename}`);
    }
    return { ...pin, body: transactionBody(matches[0].contents) };
  });
}

export const liveOwnerIdentitySql = `select current_database() as database_name, current_user as database_user,
  session_user as session_user, inet_server_port() as server_port`;

export function assertLiveOwnerIdentity(identity, { expectedPort = 5432, expectedDatabase = "tracepoint" } = {}) {
  if (identity?.database_name !== expectedDatabase || identity?.database_user !== "tracepoint_migrator"
    || identity?.session_user !== "tracepoint_migrator" || Number(identity?.server_port) !== expectedPort) {
    throw new Error("LIVE_OWNER_IDENTITY_MISMATCH");
  }
  return true;
}

const textArray = values => `array[${values.map(value => `'${value}'`).join(",")}]::text[]`;

// Aggregates only: no identities, emails, or row contents leave the database.
export const livePrecheckSql = `with password_operations as (
    select state, tracepoint_user_id, department_id from public.authentication_lifecycle_operations
    where operation_kind in ('assign_password','reset_password') and state <> 'committed'
  ), owned as (
    select c.relname, pg_get_userbyid(c.relowner) as owner, pg_has_role(current_user, c.relowner, 'USAGE') as owner_member
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any(${textArray(["permissions", "departments", "profiles", ...passwordScopeTables])})
  )
  select
    (select coalesce(jsonb_object_agg(state, total), '{}'::jsonb) from (select state, count(*) as total from password_operations group by state) states) as unresolved_password_operations_by_state,
    (select count(distinct tracepoint_user_id)::int from password_operations) as unresolved_password_operation_users,
    (select count(distinct o.tracepoint_user_id)::int from password_operations o where exists (
      select 1 from public.department_memberships m where m.user_id = o.tracepoint_user_id and m.department_id is distinct from o.department_id)) as users_with_blocked_membership_writes,
    (select count(*)::int from public.platform_admins pa where pa.is_active and exists (
      select 1 from password_operations o where o.tracepoint_user_id = pa.user_id)) as platform_admins_with_unresolved_operations,
    (select count(*)::int from (select user_id from public.department_memberships group by user_id having count(distinct department_id) > 1) users) as multi_agency_users_any,
    (select count(*)::int from (select user_id from public.department_memberships where is_active group by user_id having count(distinct department_id) > 1) users) as multi_agency_users_active,
    (select count(*)::int from public.platform_admins where is_active) as active_platform_admins,
    (select count(distinct pa.user_id)::int from public.platform_admins pa join public.department_memberships m on m.user_id = pa.user_id where pa.is_active) as active_platform_admins_with_membership,
    (select coalesce(jsonb_agg(name order by name), '[]'::jsonb) from unnest(${textArray(inventoryTables)}) as name where to_regclass('public.' || name) is not null) as inventory_tables_present,
    exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
      where i.indrelid = to_regclass('public.permissions') and i.indisunique and i.indnkeyatts = 1 and i.indpred is null and a.attname = 'code') as permissions_code_unique,
    case when to_regclass('public.permissions') is null then false
      else has_table_privilege(current_user, 'public.permissions', 'INSERT') and has_table_privilege(current_user, 'public.permissions', 'UPDATE') end as permissions_writable,
    has_schema_privilege(current_user, 'public', 'CREATE') as public_schema_create,
    case when to_regnamespace('tracepoint_auth') is null then false else has_schema_privilege(current_user, 'tracepoint_auth', 'CREATE') end as tracepoint_auth_schema_create,
    (to_regclass('public.departments') is not null and to_regclass('public.profiles') is not null
      and to_regprocedure('public.is_department_member(uuid)') is not null and to_regprocedure('public.has_department_permission(uuid,text)') is not null
      and to_regprocedure('tracepoint_auth.subject_id()') is not null and to_regprocedure('tracepoint_auth.department_id()') is not null) as inventory_prerequisites_present,
    (select coalesce(jsonb_object_agg(relname, owner), '{}'::jsonb) from owned) as table_owners,
    (select coalesce(bool_and(owner_member), false) from owned where relname = any(${textArray(passwordScopeTables)})) as password_scope_tables_owned,
    (select count(*)::int from owned where relname = any(${textArray(passwordScopeTables)})) as password_scope_tables_present,
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'tracepoint_auth'
      and p.proname in ('guard_cognito_password_global_scope','guard_cognito_scope_membership_write','guard_cognito_scope_platform_admin_write')) as password_scope_functions_present,
    (select count(*)::int from pg_trigger t where not t.tgisinternal and t.tgname in
      ('authentication_lifecycle_password_global_scope','department_memberships_password_scope_guard','platform_admins_password_scope_guard')) as password_scope_triggers_present,
    (select count(*)::int from pg_default_acl d where d.defaclrole = (select oid from pg_roles where rolname = current_user)
      and (d.defaclnamespace = 0 or d.defaclnamespace = to_regnamespace('public'))) as owner_default_privilege_entries,
    to_regclass('public.authentication_lifecycle_resolutions') is not null as password_operation_resolutions_present,
    to_regclass('public.tracepoint_aws_schema_migrations') is not null as aws_native_ledger_present,
    to_regclass('tracepoint_migrations.applied_migrations') is not null as imported_ledger_present`;

const agencyDocumentsPrerequisitesSql = `select (${["departments", "permissions", "feature_catalog", "department_features", "department_feature_events", "fleet_vehicles", "inventory_items"]
  .map(name => `to_regclass('public.${name}') is not null`).join(" and ")}) as present`;

// Agency names and IDs (no people) with each agency's entitlement rows and its Fleet and Inventory usage, so the
// owner can keep every module an agency uses before this release gates Fleet and Inventory on entitlements.
export const agencyDocumentsPrecheckSql = `select
    (select coalesce(jsonb_agg(name order by name), '[]'::jsonb) from unnest(${textArray(agencyDocumentTables)}) as name where to_regclass('public.' || name) is not null) as agency_documents_tables_present,
    (select count(*)::int from public.permissions where code = any(${textArray(agencyDocumentPermissions)})) as agency_documents_permissions_present,
    (to_regclass('public.feature_catalog') is not null and to_regclass('public.department_features') is not null
      and to_regclass('public.department_feature_events') is not null) as entitlement_tables_present,
    (select coalesce(jsonb_agg(code order by code), '[]'::jsonb) from public.feature_catalog) as feature_catalog_codes,
    (select coalesce(jsonb_agg(code order by code), '[]'::jsonb) from public.feature_catalog where not is_active) as inactive_feature_catalog_codes,
    exists (select 1 from pg_attribute where attrelid = to_regclass('public.feature_catalog') and attname = 'default_enabled' and not attisdropped) as feature_catalog_default_enabled_present,
    (select count(*)::int from pg_trigger where not tgisinternal and tgname = any(${textArray(moduleEntitlementTriggers)})) as module_entitlement_triggers,
    (select count(*)::int from public.department_features) as department_features_rows,
    (${entitlementDigestSql}) as department_features_digest,
    (select count(*)::int from public.departments) as departments_total,
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name,
        'entitlements', (select coalesce(jsonb_object_agg(f.feature_code, f.is_enabled), '{}'::jsonb) from public.department_features f where f.department_id = d.id),
        'fleet_vehicles', (select count(*) from public.fleet_vehicles v where v.department_id = d.id),
        'inventory_items', (select count(*) from public.inventory_items i where i.department_id = d.id)
      ) order by d.name, d.id), '[]'::jsonb) from public.departments d) as agencies`;

const resolutionAwarePrecheckSql = `with holding as (
    select o.tracepoint_user_id, o.department_id from public.authentication_lifecycle_operations o
    where o.operation_kind in ('assign_password','reset_password') and o.state <> 'committed'
      and not exists (select 1 from public.authentication_lifecycle_resolutions r where r.operation_id = o.id)
  )
  select
    (select count(*)::int from holding) as unresolved_password_operations,
    (select count(distinct tracepoint_user_id)::int from holding) as unresolved_password_operation_users,
    (select count(*)::int from public.authentication_lifecycle_resolutions) as resolutions,
    (select count(*)::int from public.authentication_lifecycle_resolutions where resolution_source = 'owner_verified') as owner_verified_resolutions`;

export function liveUnitReadiness(precheck) {
  const inventory = [];
  if (precheck.inventory_tables_present?.length) inventory.push("inventory_tables_already_present");
  if (precheck.permissions_code_unique !== true) inventory.push("permissions_code_not_unique");
  if (precheck.permissions_writable !== true) inventory.push("permissions_not_writable");
  if (precheck.public_schema_create !== true) inventory.push("public_schema_create_denied");
  if (precheck.inventory_prerequisites_present !== true) inventory.push("inventory_prerequisites_missing");
  const passwordScope = [];
  if (precheck.password_scope_functions_present !== 0 || precheck.password_scope_triggers_present !== 0) passwordScope.push("password_scope_objects_already_present");
  if (precheck.password_scope_tables_present !== passwordScopeTables.length) passwordScope.push("password_scope_tables_missing");
  if (precheck.password_scope_tables_owned !== true) passwordScope.push("password_scope_tables_not_owned");
  if (precheck.tracepoint_auth_schema_create !== true) passwordScope.push("tracepoint_auth_schema_create_denied");
  if (precheck.password_operation_resolutions_present !== false) passwordScope.push("password_operation_resolutions_already_present");
  // Unfinished password operations are not a readiness blocker here: the
  // unit requires every one of them to be on the reviewed resolution list.
  const agencyDocuments = [];
  const documents = precheck.agency_documents ?? {};
  if (documents.prerequisite_tables_present === false) {
    agencyDocuments.push("agency_documents_prerequisite_tables_missing");
  } else {
    if (documents.agency_documents_tables_present?.length) agencyDocuments.push("agency_documents_tables_already_present");
    if (documents.agency_documents_permissions_present !== 0) agencyDocuments.push("agency_documents_permissions_already_present");
    if (documents.entitlement_tables_present !== true) agencyDocuments.push("entitlement_tables_missing");
    if (documents.feature_catalog_default_enabled_present !== false) agencyDocuments.push("feature_catalog_default_enabled_already_present");
    if (documents.feature_catalog_codes?.includes("agency_documents")) agencyDocuments.push("agency_documents_catalog_row_already_present");
    if (documents.module_entitlement_triggers !== 0) agencyDocuments.push("module_entitlement_triggers_present");
  }
  if (precheck.permissions_code_unique !== true) agencyDocuments.push("permissions_code_not_unique");
  if (precheck.permissions_writable !== true) agencyDocuments.push("permissions_not_writable");
  if (precheck.public_schema_create !== true) agencyDocuments.push("public_schema_create_denied");
  if (precheck.tracepoint_auth_schema_create !== true) agencyDocuments.push("tracepoint_auth_schema_create_denied");
  if (precheck.inventory_prerequisites_present !== true) agencyDocuments.push("agency_documents_prerequisites_missing");
  return {
    inventory: { ready: inventory.length === 0, blockers: inventory },
    passwordScope: { ready: passwordScope.length === 0, blockers: passwordScope },
    agencyDocuments: { ready: agencyDocuments.length === 0, blockers: agencyDocuments },
  };
}

export async function runLivePrecheck(client, options = {}) {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const identity = (await client.query(liveOwnerIdentitySql)).rows[0];
    assertLiveOwnerIdentity(identity, options);
    const transaction = (await client.query("select current_setting('transaction_read_only') as read_only")).rows[0];
    if (transaction?.read_only !== "on") throw new Error("LIVE_PRECHECK_NOT_READ_ONLY");
    const precheck = (await client.query(livePrecheckSql)).rows[0];
    // Once 040 exists, report what still holds password scope after resolutions.
    if (precheck.password_operation_resolutions_present === true) {
      precheck.resolution_aware = (await client.query(resolutionAwarePrecheckSql)).rows[0];
    }
    // The Agency Documents report reads tables a partial database may lack; report them missing rather than fail.
    const documentsPrerequisites = (await client.query(agencyDocumentsPrerequisitesSql)).rows[0];
    precheck.agency_documents = documentsPrerequisites.present
      ? (await client.query(agencyDocumentsPrecheckSql)).rows[0]
      : { entitlement_tables_present: false, prerequisite_tables_present: false };
    await client.query("COMMIT");
    return { status: "PASSED", inspection: "read-only", identity, precheck, readiness: liveUnitReadiness(precheck) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

const inventoryPostconditionsSql = `select
  (select count(*)::int from unnest(${textArray(inventoryTables)}) as name where to_regclass('public.' || name) is not null) as tables_present,
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any(${textArray(inventoryTables)}) and c.relrowsecurity) as tables_with_rls,
  (select count(*)::int from pg_policies where schemaname = 'public' and policyname = any(${textArray([
    "inventory_items_read", "inventory_items_manage", "inventory_locations_read", "inventory_locations_manage", "inventory_balances_read",
    "inventory_transactions_read", "inventory_checkouts_read", "inventory_checkout_returns_read"])})) as policies_present,
  (select count(*)::int from unnest(${textArray(inventoryTables)}) as name where has_table_privilege('authenticated', 'public.' || name, 'SELECT')) as authenticated_select_tables,
  has_table_privilege('authenticated', 'public.inventory_items', 'INSERT') and has_table_privilege('authenticated', 'public.inventory_items', 'UPDATE')
    and has_table_privilege('authenticated', 'public.inventory_locations', 'INSERT') and has_table_privilege('authenticated', 'public.inventory_locations', 'UPDATE') as authenticated_management_writes,
  not has_table_privilege('authenticated', 'public.inventory_balances', 'INSERT') and not has_table_privilege('authenticated', 'public.inventory_transactions', 'INSERT') as ledger_writes_rpc_only,
  (select count(*)::int from unnest(${textArray(inventoryTables)}) as name cross join (select rolname from pg_roles where rolname in ('anon','tracepoint_runtime')) roles
    where has_table_privilege(roles.rolname, 'public.' || name, 'SELECT') or has_table_privilege(roles.rolname, 'public.' || name, 'INSERT')
      or has_table_privilege(roles.rolname, 'public.' || name, 'UPDATE') or has_table_privilege(roles.rolname, 'public.' || name, 'DELETE')) as unexpected_role_privileges,
  (select count(*)::int from unnest(array['public.record_inventory_transaction(uuid,text,numeric,uuid,uuid,text,text)',
    'public.checkout_inventory(uuid,uuid,text,uuid,text,uuid,numeric,timestamptz,text,text)','public.return_inventory_checkout(uuid,numeric,text,text)']) as signature
    where to_regprocedure(signature) is not null and has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE')
      and not exists (select 1 from pg_roles r where r.rolname in ('anon','tracepoint_runtime') and has_function_privilege(r.rolname, to_regprocedure(signature), 'EXECUTE'))) as functions_authenticated_only,
  (select count(*)::int from public.permissions where code in ('view_inventory','manage_inventory','adjust_inventory')) as inventory_permissions`;

export function assertInventoryPostconditions(row) {
  const failures = Object.entries({
    tables_present: row.tables_present === inventoryTables.length,
    tables_with_rls: row.tables_with_rls === inventoryTables.length,
    policies_present: row.policies_present === 8,
    authenticated_select_tables: row.authenticated_select_tables === inventoryTables.length,
    authenticated_management_writes: row.authenticated_management_writes === true,
    ledger_writes_rpc_only: row.ledger_writes_rpc_only === true,
    unexpected_role_privileges: row.unexpected_role_privileges === 0,
    functions_authenticated_only: row.functions_authenticated_only === 3,
    inventory_permissions: row.inventory_permissions === 3,
  }).filter(([, passed]) => !passed).map(([name]) => name);
  if (failures.length) throw new Error(`LIVE_INVENTORY_POSTCONDITION_FAILED: ${failures.join(", ")}`);
  return true;
}

// One transaction for the whole unit: a failure, a lock wait, or an unmet
// postcondition rolls every file back.
export async function runAtomicLiveUnit(client, bodies, postconditionsSql, assertPostconditions) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    for (const body of bodies) await client.query(body);
    const postconditions = (await client.query(postconditionsSql)).rows[0];
    assertPostconditions(postconditions);
    await client.query("COMMIT");
    return postconditions;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function applyLiveUnit(client, files, options, unit, readinessKey, postconditionsSql, assertPostconditions) {
  const selected = selectUnitFiles(unit, files);
  const before = await runLivePrecheck(client, options);
  if (!before.readiness[readinessKey].ready) {
    throw new Error(`LIVE_RELEASE_UNIT_PRECONDITION_FAILED: ${before.readiness[readinessKey].blockers.join(", ")}`);
  }
  const postconditions = await runAtomicLiveUnit(client, selected.map(file => file.body), postconditionsSql, assertPostconditions);
  return {
    action: unit,
    status: "APPLIED",
    executed_at: new Date().toISOString(),
    files: selected.map(({ version, filename, sha256 }) => ({ version, filename, sha256 })),
    ledger_modified: false,
    identity: before.identity,
    postconditions,
  };
}

export function applyInventoryUnit(client, files, options = {}) {
  return applyLiveUnit(client, files, options, "inventory-035-037", "inventory", inventoryPostconditionsSql, assertInventoryPostconditions);
}

// Owner-verified resolutions for historical password operations. Each entry
// is reviewed evidence that Cognito was not changed; no personal data.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const preWriteRefusalCodes = ["initial_password_required", "recovery_unavailable"];

export function parsePasswordScopeResolutions(raw) {
  let resolutions;
  try { resolutions = JSON.parse(String(raw ?? "")); } catch { throw new Error("PASSWORD_SCOPE_RESOLUTIONS_INVALID"); }
  if (!Array.isArray(resolutions) || resolutions.length > 20) throw new Error("PASSWORD_SCOPE_RESOLUTIONS_INVALID");
  if (/@/.test(JSON.stringify(resolutions))) throw new Error("PASSWORD_SCOPE_RESOLUTIONS_CONTAIN_PERSONAL_DATA");
  const seen = new Set();
  for (const entry of resolutions) {
    const evidence = entry?.evidence;
    if (!uuidPattern.test(String(entry?.operation_id ?? "")) || seen.has(entry.operation_id)
      || entry.operation_kind !== "reset_password" || !preWriteRefusalCodes.includes(entry.safe_error_code)
      || typeof entry.basis !== "string" || entry.basis.trim().length < 20 || entry.basis.trim().length > 1000
      || !evidence || typeof evidence !== "object" || Array.isArray(evidence)
      || evidence.cognito_writes_by_operation !== "none" || !String(evidence.cloudtrail_window ?? "").trim()
      || !String(evidence.code_path ?? "").trim()) {
      throw new Error("PASSWORD_SCOPE_RESOLUTIONS_INVALID");
    }
    seen.add(entry.operation_id);
  }
  return resolutions;
}

const unresolvedPasswordOperationsSql = `select id::text as operation_id, operation_kind, state, safe_error_code, attempts
  from public.authentication_lifecycle_operations
  where operation_kind in ('assign_password','reset_password') and state <> 'committed'
  order by id`;

// Every unfinished password operation must be on the reviewed list, and the
// list must name nothing else, before any SQL in the unit runs.
export function assertAuthorizedResolutionSet(unresolved, resolutions) {
  const authorized = new Map(resolutions.map(entry => [entry.operation_id, entry]));
  const failures = [];
  for (const operation of unresolved) {
    const entry = authorized.get(operation.operation_id);
    if (!entry) { failures.push("unauthorized_unresolved_operation"); continue; }
    if (operation.operation_kind !== entry.operation_kind || operation.state !== "compensation_required"
      || operation.safe_error_code !== entry.safe_error_code || Number(operation.attempts) !== 1) {
      failures.push("operation_does_not_match_authorized_evidence");
    }
    authorized.delete(operation.operation_id);
  }
  if (authorized.size) failures.push("authorized_operation_not_unresolved");
  if (failures.length) throw new Error(`PASSWORD_SCOPE_RESOLUTION_SET_MISMATCH: ${[...new Set(failures)].join(", ")}`);
  return true;
}

const passwordScopeResolutionPostconditionsSql = `with app_roles as (
    select rolname from pg_roles where rolname in ('anon','authenticated','service_role','tracepoint_runtime')
  ), scope_functions as (
    select p.oid, p.proname, p.prosrc, p.prosecdef, p.proacl, p.proowner from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tracepoint_auth' and p.proname in ('guard_cognito_password_global_scope','guard_cognito_scope_membership_write',
      'guard_cognito_scope_platform_admin_write','password_scope_hold_exists','resolve_password_operation_provider_unchanged','reject_lifecycle_resolution_change',
      'audit_lifecycle_resolution')
  ), finish as (
    select p.oid, pg_get_function_identity_arguments(p.oid) as arguments, p.pronargdefaults from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tracepoint_auth' and p.proname = 'finish_cognito_password_operation'
  )
  select
    (select count(*)::int from scope_functions) as scope_functions_present,
    (select count(*)::int from scope_functions f where f.proname <> 'reject_lifecycle_resolution_change' and not f.prosecdef) as scope_functions_not_definer,
    (select count(*)::int from scope_functions f cross join app_roles r where has_function_privilege(r.rolname, f.oid, 'EXECUTE')) as scope_functions_app_executable,
    (select count(*)::int from scope_functions f where exists (select 1 from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) acl where acl.grantee = 0)) as scope_functions_public_executable,
    (select count(*)::int from scope_functions f where f.proname in ('guard_cognito_scope_membership_write','guard_cognito_scope_platform_admin_write')
      and f.prosrc like '%password_scope_hold_exists(%' and f.prosrc not like '%state <> ''committed''%') as guards_using_shared_predicate,
    (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal and t.tgenabled = 'O' and (c.relname, t.tgname) in (
        ('authentication_lifecycle_operations','authentication_lifecycle_password_global_scope'),
        ('department_memberships','department_memberships_password_scope_guard'),
        ('platform_admins','platform_admins_password_scope_guard'),
        ('authentication_lifecycle_resolutions','authentication_lifecycle_resolutions_append_only'),
        ('authentication_lifecycle_resolutions','authentication_lifecycle_resolutions_no_truncate'),
        ('authentication_lifecycle_resolutions','authentication_lifecycle_resolutions_audit'))) as enabled_triggers,
    coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.authentication_lifecycle_resolutions')), false) as resolutions_rls,
    (select count(*)::int from app_roles r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as privilege
      where has_table_privilege(r.rolname, 'public.authentication_lifecycle_resolutions', privilege)) as resolutions_app_privileges,
    (select count(*)::int from finish) as finish_overloads,
    (select arguments from finish limit 1) as finish_arguments,
    (select pronargdefaults from finish limit 1) as finish_defaults,
    (select has_function_privilege('tracepoint_runtime', oid, 'EXECUTE') from finish limit 1) as finish_runtime_executable,
    (select count(*)::int from finish f cross join app_roles r where r.rolname <> 'tracepoint_runtime' and has_function_privilege(r.rolname, f.oid, 'EXECUTE')) as finish_other_app_executable,
    (select count(*)::int from public.authentication_lifecycle_operations o where o.operation_kind in ('assign_password','reset_password')
      and o.state <> 'committed' and not exists (select 1 from public.authentication_lifecycle_resolutions r where r.operation_id = o.id)) as unresolved_remaining,
    (select count(*)::int from public.authentication_lifecycle_resolutions where operation_id = any($1::uuid[]) and resolution_source = 'owner_verified') as owner_resolutions,
    (select count(*)::int from public.audit_events where entity_id = any($1::uuid[]) and action = 'password_operation_resolved'
      and entity_type = 'authentication_lifecycle_operation') as resolution_audit_rows,
    (select count(*)::int from public.authentication_lifecycle_operations where id = any($1::uuid[]) and state = 'compensation_required') as original_operations_preserved`;

export function assertPasswordScopeResolutionPostconditions(row, expectedResolutions) {
  const failures = Object.entries({
    scope_functions_present: row.scope_functions_present === 7,
    scope_functions_not_definer: row.scope_functions_not_definer === 0,
    scope_functions_app_executable: row.scope_functions_app_executable === 0,
    scope_functions_public_executable: row.scope_functions_public_executable === 0,
    guards_using_shared_predicate: row.guards_using_shared_predicate === 2,
    enabled_triggers: row.enabled_triggers === 6,
    resolutions_rls: row.resolutions_rls === true,
    resolutions_app_privileges: row.resolutions_app_privileges === 0,
    finish_overloads: row.finish_overloads === 1,
    finish_arguments: row.finish_arguments === "p_operation_id uuid, p_succeeded boolean, p_error_code text, p_provider_unchanged boolean",
    finish_defaults: row.finish_defaults === 2,
    finish_runtime_executable: row.finish_runtime_executable === true,
    finish_other_app_executable: row.finish_other_app_executable === 0,
    unresolved_remaining: row.unresolved_remaining === 0,
    owner_resolutions: row.owner_resolutions === expectedResolutions,
    resolution_audit_rows: row.resolution_audit_rows === expectedResolutions,
    original_operations_preserved: row.original_operations_preserved === expectedResolutions,
  }).filter(([, passed]) => !passed).map(([name]) => name);
  if (failures.length) throw new Error(`LIVE_PASSWORD_SCOPE_POSTCONDITION_FAILED: ${failures.join(", ")}`);
  return true;
}

// 039, 040, and the reviewed resolutions commit together or not at all. The
// operations table is locked so no new password operation can appear between
// the authorization check and the commit.
export async function applyPasswordScopeResolutionUnit(client, files, resolutions, options = {}) {
  const authorized = parsePasswordScopeResolutions(JSON.stringify(resolutions));
  const selected = selectUnitFiles("password-scope-039-040", files);
  const before = await runLivePrecheck(client, options);
  if (!before.readiness.passwordScope.ready) {
    throw new Error(`LIVE_RELEASE_UNIT_PRECONDITION_FAILED: ${before.readiness.passwordScope.blockers.join(", ")}`);
  }
  const ids = authorized.map(entry => entry.operation_id);
  await client.query("BEGIN");
  let postconditions;
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("LOCK TABLE public.authentication_lifecycle_operations IN SHARE ROW EXCLUSIVE MODE");
    assertAuthorizedResolutionSet((await client.query(unresolvedPasswordOperationsSql)).rows, authorized);
    for (const file of selected) await client.query(file.body);
    for (const entry of authorized) {
      await client.query("select tracepoint_auth.resolve_password_operation_provider_unchanged($1::uuid,'owner_verified',$2,$3::jsonb)",
        [entry.operation_id, entry.basis, JSON.stringify(entry.evidence)]);
    }
    postconditions = (await client.query(passwordScopeResolutionPostconditionsSql, [ids])).rows[0];
    assertPasswordScopeResolutionPostconditions(postconditions, ids.length);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  return {
    action: "password-scope-039-040",
    status: "APPLIED",
    executed_at: new Date().toISOString(),
    files: selected.map(({ version, filename, sha256 }) => ({ version, filename, sha256 })),
    resolved_operations: ids.length,
    ledger_modified: false,
    identity: before.identity,
    postconditions,
  };
}

// $1 is the department_features digest read inside the unit's transaction: the unit adds catalog rows but must
// not change any agency's entitlements (Agency Documents, Fleet and Inventory stay off until enabled).
const agencyDocumentsPostconditionsSql = `select
  (select count(*)::int from unnest(${textArray(agencyDocumentTables)}) as name where to_regclass('public.' || name) is not null) as tables_present,
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any(${textArray(agencyDocumentTables)}) and c.relrowsecurity) as tables_with_rls,
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = any(${textArray(agencyDocumentTables)})) as policies_present,
  (select count(*)::int from public.permissions where code = any(${textArray(agencyDocumentPermissions)})) as permissions_present,
  (select count(*)::int from unnest(${textArray(agencyDocumentTables)}) as name where has_table_privilege('authenticated', 'public.' || name, 'SELECT')) as authenticated_select_tables,
  (select count(*)::int from unnest(${textArray(agencyDocumentTables)}) as name cross join (select rolname from pg_roles where rolname = 'anon') roles
    where has_table_privilege(roles.rolname, 'public.' || name, 'SELECT') or has_table_privilege(roles.rolname, 'public.' || name, 'INSERT')
      or has_table_privilege(roles.rolname, 'public.' || name, 'UPDATE') or has_table_privilege(roles.rolname, 'public.' || name, 'DELETE')) as anon_privileges,
  exists (select 1 from public.feature_catalog where code = 'agency_documents' and is_active and default_enabled = false) as agency_documents_catalog_default_off,
  (select count(*)::int from public.feature_catalog where code in ('fleet','inventory') and is_active) as fleet_inventory_catalog_rows,
  (select count(*)::int from public.department_features where feature_code = 'agency_documents') as agency_documents_entitlement_rows,
  (${entitlementDigestSql}) = $1 as entitlements_unchanged,
  (select count(*)::int from pg_trigger where not tgisinternal and tgname = any(${textArray(moduleEntitlementTriggers)})) as module_entitlement_triggers`;

export function assertAgencyDocumentsPostconditions(row) {
  const failures = Object.entries({
    tables_present: row.tables_present === agencyDocumentTables.length,
    tables_with_rls: row.tables_with_rls === agencyDocumentTables.length,
    policies_present: row.policies_present === 12,
    permissions_present: row.permissions_present === agencyDocumentPermissions.length,
    authenticated_select_tables: row.authenticated_select_tables === agencyDocumentTables.length,
    anon_privileges: row.anon_privileges === 0,
    agency_documents_catalog_default_off: row.agency_documents_catalog_default_off === true,
    fleet_inventory_catalog_rows: row.fleet_inventory_catalog_rows === 2,
    agency_documents_entitlement_rows: row.agency_documents_entitlement_rows === 0,
    entitlements_unchanged: row.entitlements_unchanged === true,
    module_entitlement_triggers: row.module_entitlement_triggers === 0,
  }).filter(([, passed]) => !passed).map(([name]) => name);
  if (failures.length) throw new Error(`LIVE_AGENCY_DOCUMENTS_POSTCONDITION_FAILED: ${failures.join(", ")}`);
  return true;
}

// 038-041 and 046-048 commit together or not at all. The entitlement table is locked so no platform admin
// toggle can land between the digest read and the commit.
export async function applyAgencyDocumentsUnit(client, files, options = {}) {
  const selected = selectUnitFiles("agency-documents-038-048", files);
  if (selected.some(file => file.version === 42)) throw new Error("LIVE_RELEASE_UNIT_INCLUDES_042");
  const before = await runLivePrecheck(client, options);
  if (!before.readiness.agencyDocuments.ready) {
    throw new Error(`LIVE_RELEASE_UNIT_PRECONDITION_FAILED: ${before.readiness.agencyDocuments.blockers.join(", ")}`);
  }
  await client.query("BEGIN");
  let postconditions;
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("LOCK TABLE public.department_features IN SHARE ROW EXCLUSIVE MODE");
    const digest = (await client.query(entitlementDigestSql)).rows[0].md5;
    for (const file of selected) await client.query(file.body);
    postconditions = (await client.query(agencyDocumentsPostconditionsSql, [digest])).rows[0];
    assertAgencyDocumentsPostconditions(postconditions);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  return {
    action: "agency-documents-038-048",
    status: "APPLIED",
    executed_at: new Date().toISOString(),
    files: selected.map(({ version, filename, sha256 }) => ({ version, filename, sha256 })),
    ledger_modified: false,
    identity: before.identity,
    postconditions,
  };
}
