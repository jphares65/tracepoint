import { createHash } from "node:crypto";

// Guarded, ledger-free release units for the live final-cutover database.
// Its schema lineage is partial (001-026 plus 028, 029, 032, 038), so the
// ledgered apply path cannot target it. Each unit runs its pinned migration
// files as one transaction and commits only after its postconditions hold.

export const liveOwnerActions = Object.freeze(["precheck", "inventory-035-037", "password-scope-039"]);

export const liveReleaseUnits = Object.freeze({
  "inventory-035-037": Object.freeze([
    { version: 35, filename: "035_inventory_phase1.sql", sha256: "e617ea34b4403e0af34934de77b66f589940066f85faa5e04eb10062cdc39861" },
    { version: 36, filename: "036_inventory_checkout_phase2a.sql", sha256: "e9298b65d290293c66a2f2420a7775a55a342b5c111db9b9cbaab6f8dc3ad7fc" },
    { version: 37, filename: "037_inventory_management_runtime_grants.sql", sha256: "8aad48a4378d7b69e392e0cdd2869e1e8a55226c0feb47e137b8006e21064f97" },
  ]),
  "password-scope-039": Object.freeze([
    { version: 39, filename: "039_cognito_password_global_scope.sql", sha256: "3916971b7ffee8e9aa0b44269ab251c1a6f780aae1b4ac9cbc450c98be3dc987" },
  ]),
});

const inventoryTables = ["inventory_items", "inventory_locations", "inventory_balances", "inventory_transactions", "inventory_checkouts", "inventory_checkout_returns"];
const passwordScopeTables = ["authentication_lifecycle_operations", "department_memberships", "platform_admins"];

// Line endings depend on the checkout that built the image; pins use LF.
export function normalizedSha256(contents) {
  return createHash("sha256").update(String(contents).replace(/\r\n/g, "\n")).digest("hex");
}

export function transactionBody(contents) {
  const match = String(contents).match(/^\s*begin;([\s\S]*)commit;\s*$/i);
  if (!match) throw new Error("LIVE_RELEASE_UNIT_FILE_NOT_TRANSACTIONAL");
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

export function assertLiveOwnerIdentity(identity, { expectedPort = 5432 } = {}) {
  if (identity?.database_name !== "tracepoint" || identity?.database_user !== "tracepoint_migrator"
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
    to_regclass('public.tracepoint_aws_schema_migrations') is not null as aws_native_ledger_present,
    to_regclass('tracepoint_migrations.applied_migrations') is not null as imported_ledger_present`;

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
  if (precheck.unresolved_password_operation_users !== 0) passwordScope.push("unresolved_password_operations_present");
  return { inventory: { ready: inventory.length === 0, blockers: inventory }, passwordScope: { ready: passwordScope.length === 0, blockers: passwordScope } };
}

export async function runLivePrecheck(client, options = {}) {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const identity = (await client.query(liveOwnerIdentitySql)).rows[0];
    assertLiveOwnerIdentity(identity, options);
    const transaction = (await client.query("select current_setting('transaction_read_only') as read_only")).rows[0];
    if (transaction?.read_only !== "on") throw new Error("LIVE_PRECHECK_NOT_READ_ONLY");
    const precheck = (await client.query(livePrecheckSql)).rows[0];
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

const passwordScopePostconditionsSql = `select
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'tracepoint_auth' and p.prosecdef
    and p.proname in ('guard_cognito_password_global_scope','guard_cognito_scope_membership_write','guard_cognito_scope_platform_admin_write')
    and not exists (select 1 from pg_roles r where r.rolname in ('anon','authenticated','service_role','tracepoint_runtime') and has_function_privilege(r.rolname, p.oid, 'EXECUTE'))
    and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl where acl.grantee = 0)) as guarded_functions,
  (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal and t.tgenabled = 'O' and (c.relname, t.tgname) in (
      ('authentication_lifecycle_operations','authentication_lifecycle_password_global_scope'),
      ('department_memberships','department_memberships_password_scope_guard'),
      ('platform_admins','platform_admins_password_scope_guard'))) as enabled_triggers`;

export function assertPasswordScopePostconditions(row) {
  const failures = [];
  if (row.guarded_functions !== 3) failures.push(`guarded_functions=${row.guarded_functions}`);
  if (row.enabled_triggers !== 3) failures.push(`enabled_triggers=${row.enabled_triggers}`);
  if (failures.length) throw new Error(`LIVE_PASSWORD_SCOPE_POSTCONDITION_FAILED: ${failures.join(", ")}`);
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

export function applyPasswordScopeUnit(client, files, options = {}) {
  return applyLiveUnit(client, files, options, "password-scope-039", "passwordScope", passwordScopePostconditionsSql, assertPasswordScopePostconditions);
}
