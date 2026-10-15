const check = (kind, value, label = value) => ({ kind, value, label });
const schema = (value, label) => check("schema", value, label);
const relation = (value, label) => check("relation", value, label);
const column = (value, label) => check("column", value, label);
const routine = (value, label) => check("routine", value, label);
const index = (value, label) => check("index", value, label);
const policy = (value, label) => check("policy", value, label);
const constraint = (value, label) => check("constraint", value, label);
const role = (value, label) => check("role", value, label);
const privilege = (value, label) => check("privilege", value, label);
const trigger = (value, label) => check("trigger", value, label);

// Each entry is a deliberately conservative catalog anchor. A migration is
// "present" only when every selected durable effect is present; this never
// treats application code or tenant rows as evidence.
export const migrationInspectionManifest = [
  [1, [schema("tracepoint_auth"), routine("tracepoint_auth.subject_id"), routine("tracepoint_auth.department_id")]],
  [2, [column("public.authentication_refresh_sessions.last_seen_at"), column("public.authentication_refresh_sessions.idle_expires_at"), index("authentication_refresh_ready_session")]],
  [3, [role("tracepoint_runtime"), policy("public.authentication_refresh_sessions.authentication_refresh_sessions_runtime")]],
  [4, [routine("tracepoint_auth.subject_id"), role("tracepoint_runtime")]],
  [5, [policy("public.fleet_vehicles.fleet_vehicles_select_scoped")]],
  [6, [relation("public.authentication_identity_events"), relation("public.authentication_lifecycle_operations"), routine("tracepoint_auth.upsert_application_user_anchor")]],
  [7, [policy("public.notification_email_queue.notification_email_queue_runtime"), policy("public.notification_events.notification_events_runtime_dispatch")]],
  [8, [routine("public.close_agency_training_event"), routine("public.reopen_agency_training_event")]],
  [9, [routine("tracepoint_auth.prepare_cognito_membership_operation"), routine("tracepoint_auth.finish_cognito_membership_operation")]],
  [10, [trigger("public.department_memberships.department_memberships_prevent_self_deactivation"), routine("public.attach_existing_cognito_personnel_import")]],
  [11, [routine("public.record_onboarding_import_audit")]],
  [12, [policy("public.off_duty_firearm_requests.off_duty_requests_insert_onboarding_manager"), policy("public.qualification_results.qualification_results_historical_import_range_manager")]],
  [13, [routine("tracepoint_auth.prepare_existing_cognito_migration"), routine("public.record_cognito_activation_delivery")]],
  [14, [routine("public.list_platform_agencies")]],
  [15, [routine("public.get_platform_entitlements"), routine("public.set_platform_entitlement")]],
  [16, [routine("tracepoint_auth.is_platform_supporting"), routine("public.platform_support_context")]],
  [17, [routine("public.record_off_duty_firearm_inspection"), routine("public.update_firearm_with_audit")]],
  [18, [policy("public.fleet_vehicles.fleet_vehicles_read"), policy("public.off_duty_firearm_history.off_duty_history_read")]],
  [19, [privilege("public.fleet_vehicles.authenticated.SELECT"), privilege("public.off_duty_firearm_requests.authenticated.INSERT")]],
  [20, [policy("public.off_duty_firearm_inspections.off_duty_inspections_read"), privilege("public.off_duty_firearm_inspections.authenticated.SELECT")]],
  [21, [routine("tracepoint_auth.list_exceptional_cognito_identities"), routine("tracepoint_auth.commit_exceptional_cognito_migration")]],
  [22, [constraint("public.authentication_flow_transactions.authentication_flow_transactions_check")]],
  [23, [policy("public.audit_log.audit_log_select_authorized"), privilege("public.audit_log.authenticated.SELECT")]],
  [24, [routine("tracepoint_auth.enqueue_notification_email")]],
  [25, [routine("tracepoint_auth.confirm_cognito_provider_username"), routine("tracepoint_auth.prepare_cognito_activation_resend")]],
  [26, [routine("tracepoint_auth.prepare_cognito_invite")]],
  [27, [routine("tracepoint_auth.claim_cognito_invite_retry")]],
  [28, [relation("public.firearm_storage_locations"), relation("public.firearm_current_custody"), relation("public.firearm_possession_restrictions"), relation("public.firearm_custody_events"), routine("public.transfer_firearm_custody"), routine("public.create_firearm_storage_location"), routine("public.create_firearm_possession_restriction"), relation("public.available_firearms_for_assignment")]],
  [29, [routine("public.create_firearm_storage_location"), routine("public.create_firearm_possession_restriction")]],
  [30, [routine("public.set_firearm_restricted_use"), routine("public.clear_firearm_possession_restriction")]],
  [31, [column("public.firearm_possession_restrictions.restriction_type"), index("firearm_possession_restrictions_one_active"), routine("public.operate_restricted_firearm_custody")]],
  [32, [policy("public.audit_log.audit_log_select_authorized"), privilege("public.audit_log.authenticated.SELECT")]],
  [33, [column("public.attachments.expiration_date"), index("attachments_fleet_vehicle_document_active_idx")]],
  [34, [index("firearm_storage_locations_active_name_normalized"), routine("public.update_firearm_storage_location"), routine("public.deactivate_firearm_storage_location")]],
  [35, [relation("public.inventory_items"), relation("public.inventory_locations"), relation("public.inventory_balances"), relation("public.inventory_transactions"), routine("public.record_inventory_transaction")]],
  [36, [relation("public.inventory_checkouts"), relation("public.inventory_checkout_returns"), routine("public.checkout_inventory"), routine("public.return_inventory_checkout")]],
  [37, [privilege("public.inventory_items.authenticated.INSERT"), privilege("public.inventory_items.authenticated.UPDATE"), privilege("public.inventory_locations.authenticated.INSERT"), privilege("public.inventory_locations.authenticated.UPDATE")]],
  [38, [relation("public.pilot_range_workspaces"), column("public.pilot_range_workspaces.workspace"), column("public.pilot_range_workspaces.updated_by_user_id"), privilege("public.pilot_range_workspaces.authenticated.INSERT"), privilege("public.pilot_range_workspaces.authenticated.UPDATE")]],
  [39, [routine("tracepoint_auth.guard_cognito_password_global_scope"), routine("tracepoint_auth.guard_cognito_scope_membership_write"), routine("tracepoint_auth.guard_cognito_scope_platform_admin_write"), trigger("public.authentication_lifecycle_operations.authentication_lifecycle_password_global_scope"), trigger("public.department_memberships.department_memberships_password_scope_guard"), trigger("public.platform_admins.platform_admins_password_scope_guard")]],
].map(([version, checks]) => ({ version, checks }));

export function assertExpectedDatabaseHost(actualHost, expectedHost) {
  const normalize = value => String(value ?? "").trim().toLowerCase().replace(/\.$/, "");
  const actual = normalize(actualHost);
  const expected = normalize(expectedHost);
  if (!actual || !expected || actual !== expected) throw new Error("DATABASE_TARGET_MISMATCH");
  return true;
}

export function assertDatabaseTargetIdentity(identity, { expectedDatabase = "tracepoint", expectedUser = "tracepoint_runtime" } = {}) {
  if (
    identity?.database_name !== expectedDatabase
    || typeof identity?.server_address !== "string"
    || identity.server_address.length === 0
    || Number(identity?.server_port) !== 5432
    || identity?.database_user !== expectedUser
    || identity?.session_user !== expectedUser
    || typeof identity?.search_path !== "string"
    || !Array.isArray(identity?.effective_schemas)
  ) throw new Error("DATABASE_TARGET_MISMATCH");
  return true;
}

export const inspectionCatalogQueries = Object.freeze([
  ["schemas", "select nspname as name from pg_namespace where nspname in ('public','tracepoint_auth') order by nspname"],
  ["relations", "select n.nspname as schema, c.relname as name, c.relkind as kind, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','tracepoint_auth') and c.relkind in ('r','p','v','m') order by n.nspname,c.relname"],
  ["columns", "select n.nspname as schema, c.relname as relation, a.attname as column_name, format_type(a.atttypid,a.atttypmod) as data_type, a.atttypid::regtype::text as udt_name, not a.attnotnull as is_nullable from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','tracepoint_auth') and c.relkind in ('r','p','v','m') and a.attnum>0 and not a.attisdropped order by n.nspname,c.relname,a.attnum"],
  ["routines", "select n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as identity_arguments, p.prosecdef as security_definer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','tracepoint_auth') order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)"],
  ["indexes", "select n.nspname as schema, t.relname as relation, i.relname as name, pg_get_indexdef(i.oid) as indexdef from pg_index x join pg_class t on t.oid=x.indrelid join pg_class i on i.oid=x.indexrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname in ('public','tracepoint_auth') order by n.nspname,t.relname,i.relname"],
  ["constraints", "select n.nspname as schema, c.relname as relation, con.conname as name, con.contype as type, pg_get_constraintdef(con.oid,true) as definition from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','tracepoint_auth') order by n.nspname,c.relname,con.conname"],
  ["policies", "select schemaname as schema, tablename as relation, policyname as name, roles, cmd from pg_policies where schemaname in ('public','tracepoint_auth') order by schemaname,tablename,policyname"],
  ["privileges", "select n.nspname as schema, c.relname as relation, grantee.name as grantee, privilege.privilege_type from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join (values ('authenticated'::text),('tracepoint_runtime'::text),('anon'::text),('service_role'::text)) as grantee(name) cross join (values ('SELECT'::text),('INSERT'::text),('UPDATE'::text),('DELETE'::text),('TRUNCATE'::text),('REFERENCES'::text),('TRIGGER'::text)) as privilege(privilege_type) where n.nspname in ('public','tracepoint_auth') and c.relkind in ('r','p','v','m') and exists(select 1 from pg_roles r where r.rolname=grantee.name) and has_table_privilege(grantee.name,c.oid,privilege.privilege_type) order by n.nspname,c.relname,grantee.name,privilege.privilege_type"],
  ["roles", "select rolname as name from pg_roles where rolname in ('authenticated','tracepoint_runtime','anon','service_role') order by rolname"],
  ["triggers", "select n.nspname as schema, c.relname as relation, t.tgname as name from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','tracepoint_auth') and not t.tgisinternal order by n.nspname,c.relname,t.tgname"],
]);

export function assertInspectionSql(sql) {
  const normalized = sql.trim().replace(/\s+/g, " ").toLowerCase();
  if (/^(begin transaction read only|begin transaction isolation level repeatable read read only|set transaction read only|commit)$/.test(normalized)) return;
  const withoutStringLiterals = normalized.replace(/'(?:''|[^'])*'/g, "''");
  const fixedReadOnlyCte = /^with required\s*\(relation_name, required_columns, require_rls\) as \(values\b/.test(withoutStringLiterals);
  if (!(/^select\b/.test(withoutStringLiterals) || fixedReadOnlyCte) || /\b(insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|call|do|copy|vacuum|analyze|lock)\b/.test(withoutStringLiterals)) throw new Error("READ_ONLY_INSPECTION_SQL_REJECTED");
}

function catalogMaps(snapshot) {
  const rows = key => snapshot[key] ?? [];
  const map = (key, makeKey) => {
    const result = new Map();
    for (const row of rows(key)) {
      const entry = makeKey(row);
      result.set(entry, [...(result.get(entry) ?? []), row]);
    }
    return result;
  };
  return {
    schema: map("schemas", row => row.name),
    relation: map("relations", row => `${row.schema}.${row.name}`),
    column: map("columns", row => `${row.schema}.${row.relation}.${row.column_name}`),
    routine: map("routines", row => `${row.schema}.${row.name}`),
    index: map("indexes", row => row.name),
    constraint: map("constraints", row => `${row.schema}.${row.relation}.${row.name}`),
    policy: map("policies", row => `${row.schema}.${row.relation}.${row.name}`),
    privilege: map("privileges", row => `${row.schema}.${row.relation}.${row.grantee}.${row.privilege_type}`),
    role: map("roles", row => row.name),
    trigger: map("triggers", row => `${row.schema}.${row.relation}.${row.name}`),
  };
}

export function classifyMigrationInspection(snapshot) {
  const catalogs = catalogMaps(snapshot);
  const migrations = migrationInspectionManifest.map(({ version, checks }) => {
    const evidence = checks.map(item => {
      const observed = catalogs[item.kind]?.get(item.value) ?? [];
      return { check: item.label, present: observed.length > 0, observed };
    });
    const count = evidence.filter(item => item.present).length;
    return { version, status: count === checks.length ? "present" : count === 0 ? "absent" : "partial", evidence };
  });
  let highestContiguousVersion = 0;
  for (const migration of migrations) { if (migration.version !== highestContiguousVersion + 1 || migration.status !== "present") break; highestContiguousVersion = migration.version; }
  const outOfOrderPresent = migrations.filter(migration => migration.version > highestContiguousVersion + 1 && migration.status === "present").map(migration => migration.version);
  const phaseA = migrations.find(migration => migration.version === 28);
  const later = migrations.filter(migration => migration.version >= 30 && migration.version <= 37).map(({ version, status }) => ({ version, status }));
  const recommendation = highestContiguousVersion === 37
    ? "Adopt the verified 001-037 ledger only; apply migrations 038 and 039 in order."
    : highestContiguousVersion === 38
      ? "Apply migration 039 after verifying the complete 001-038 chain."
    : "Do not adopt beyond the highest contiguous verified version. Reconcile against a production-specific anchor only after every missing or partial migration has a reviewed, dependency-ordered, idempotency-validated plan.";
  return { migrations, highestContiguousVersion, outOfOrderPresent, missingPhaseAObjects: phaseA.evidence.filter(item => !item.present).map(item => item.check), migrations030to037: later, recommendation };
}
