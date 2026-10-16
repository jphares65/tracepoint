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
  [40, [relation("public.authentication_lifecycle_resolutions"), routine("tracepoint_auth.password_scope_hold_exists"), routine("tracepoint_auth.resolve_password_operation_provider_unchanged"), trigger("public.authentication_lifecycle_resolutions.authentication_lifecycle_resolutions_append_only")]],
].map(([version, checks]) => ({ version, checks }));

export function assertExpectedDatabaseHost(actualHost, expectedHost) {
  const normalize = value => String(value ?? "").trim().toLowerCase().replace(/\.$/, "");
  const actual = normalize(actualHost);
  const expected = normalize(expectedHost);
  if (!actual || !expected || actual !== expected) throw new Error("DATABASE_TARGET_MISMATCH");
  return true;
}

export function assertDatabaseTargetIdentity(identity, { expectedDatabase = "tracepoint", expectedUser = "tracepoint_runtime", expectedPort = 5432 } = {}) {
  if (
    identity?.database_name !== expectedDatabase
    || typeof identity?.server_address !== "string"
    || identity.server_address.length === 0
    || Number(identity?.server_port) !== expectedPort
    || identity?.database_user !== expectedUser
    || identity?.session_user !== expectedUser
    || identity?.search_path !== "pg_catalog"
    || !Array.isArray(identity?.effective_schemas)
    || identity.effective_schemas.length !== 1
    || identity.effective_schemas[0] !== "pg_catalog"
  ) throw new Error("DATABASE_TARGET_MISMATCH");
  return true;
}

export const inspectionSearchPathSql = "SET LOCAL search_path = pg_catalog";

// Identity of a host-pinned inspection connection, read inside its read-only
// transaction after the search path is fixed to pg_catalog.
export const inspectionTargetIdentitySql = `select current_database() as database_name,
  inet_server_addr()::text as server_address, inet_server_port() as server_port,
  current_setting('search_path') as search_path, array_to_json(current_schemas(true)) as effective_schemas,
  current_user as database_user, session_user as session_user`;

export const migrationLedgerDiscoverySql = `select
  to_regclass('public.tracepoint_aws_schema_migrations')::text as aws_native_relation,
  to_regclass('tracepoint_migrations.applied_migrations')::text as imported_relation`;

export const awsNativeMigrationLedgerSql = `select version::int as version, filename, content_sha256 as sha256
  from public.tracepoint_aws_schema_migrations order by version, filename`;

export const importedAwsMigrationLedgerSql = `select kind, name as filename, sha256
  from tracepoint_migrations.applied_migrations where kind = 'aws' order by name`;

const migrationLedgerPermissionSql = `select
  has_schema_privilege(current_user, $1, 'USAGE') as schema_usage,
  case when to_regclass($2) is null then null
    else has_table_privilege(current_user, to_regclass($2), 'SELECT') end as ledger_select`;
const migrationLedgerSchemaPermissionSql = `select
  has_schema_privilege(current_user, 'public', 'USAGE') as public_schema_usage,
  has_schema_privilege(current_user, 'tracepoint_migrations', 'USAGE') as imported_schema_usage`;

export const migrationLedgerTransactionSql = `select current_setting('transaction_read_only') as read_only,
  current_setting('transaction_isolation') as isolation`;

const migrationLedgerSources = Object.freeze({
  awsNative: "public.tracepoint_aws_schema_migrations",
  imported: "tracepoint_migrations.applied_migrations",
});

function normalizedLedgerSource(source, rows, files) {
  if (rows === null) return { relation: source, status: "absent", entries: [], issues: [] };
  if (!rows.length) return { relation: source, status: "empty", entries: [], issues: [] };

  const expectedByVersion = new Map(files.map(file => [Number(file.version), file]));
  const entries = [];
  const issues = [];
  const seenVersions = new Set();
  for (const row of rows) {
    const filename = String(row.filename ?? "");
    const parsedVersion = source === migrationLedgerSources.imported
      ? Number(filename.match(/^(\d{3})_[a-z0-9_]+\.sql$/)?.[1] ?? NaN)
      : Number(row.version);
    const sha256 = String(row.sha256 ?? "");
    const expected = expectedByVersion.get(parsedVersion);
    if (!Number.isInteger(parsedVersion) || parsedVersion < 1 || !expected) {
      issues.push({ code: "UNKNOWN_MIGRATION", version: Number.isFinite(parsedVersion) ? parsedVersion : null, filename, sha256 });
      continue;
    }
    if (seenVersions.has(parsedVersion)) {
      issues.push({ code: "DUPLICATE_VERSION", version: parsedVersion, filename, sha256 });
      continue;
    }
    seenVersions.add(parsedVersion);
    if (filename !== expected.filename || sha256.toLowerCase() !== String(expected.sha256).toLowerCase()) {
      issues.push({ code: "REPOSITORY_MISMATCH", version: parsedVersion, filename, sha256, expectedFilename: expected.filename, expectedSha256: expected.sha256 });
    }
    entries.push({ version: parsedVersion, filename, sha256, expectedFilename: expected.filename, expectedSha256: expected.sha256 });
  }
  entries.sort((left, right) => left.version - right.version);
  let highestContiguousVersion = 0;
  for (const entry of entries) {
    if (entry.version !== highestContiguousVersion + 1) break;
    highestContiguousVersion = entry.version;
  }
  const gaps = entries.filter(entry => entry.version > highestContiguousVersion).map(entry => entry.version);
  const status = issues.length ? "divergent" : gaps.length ? "partial" : "verified";
  return { relation: source, status, entries, issues, highestContiguousVersion, outOfOrderVersions: gaps };
}

function sameLedgerEntries(left, right) {
  return left.length === right.length && left.every((entry, index) => entry.version === right[index].version
    && entry.filename === right[index].filename && entry.sha256.toLowerCase() === right[index].sha256.toLowerCase());
}

function conflictingLedgerEntries(left, right) {
  const rightByVersion = new Map(right.map(entry => [entry.version, entry]));
  return left.some(entry => {
    const other = rightByVersion.get(entry.version);
    return other && (entry.filename !== other.filename || entry.sha256.toLowerCase() !== other.sha256.toLowerCase());
  });
}

export function classifyMigrationLedgerEvidence({ awsNativeRows = null, importedRows = null }, files) {
  const awsNative = normalizedLedgerSource(migrationLedgerSources.awsNative, awsNativeRows, files);
  const imported = normalizedLedgerSource(migrationLedgerSources.imported, importedRows, files);
  const present = [awsNative, imported].filter(source => source.status !== "absent");
  let status = "unknown";
  let source = null;
  let appliedVersions = null;
  let pending = null;
  let latestAppliedVersion = null;
  let highestContiguousVersion = null;
  let comparison = "no-recognized-ledger";

  if (present.length === 1) {
    const only = present[0];
    source = only.relation;
    status = only.status;
    comparison = "single-ledger";
    highestContiguousVersion = only.highestContiguousVersion ?? (only.status === "empty" ? 0 : null);
    if (only.status === "verified") {
      appliedVersions = only.entries.map(entry => entry.version);
      highestContiguousVersion = only.highestContiguousVersion;
      latestAppliedVersion = only.entries.at(-1)?.version ?? null;
      pending = files.filter(file => !appliedVersions.includes(Number(file.version))).map(file => ({ version: Number(file.version), filename: file.filename, content_sha256: file.sha256 }));
      if (!appliedVersions.length) status = "empty";
    }
  } else if (present.length === 2) {
    comparison = "coverage-differs";
    if (awsNative.status === "divergent" || imported.status === "divergent"
      || conflictingLedgerEntries(awsNative.entries, imported.entries)) {
      status = "divergent";
      comparison = "conflicts";
    } else if (awsNative.status === "empty" && imported.status === "empty") {
      status = "empty";
      comparison = "both-agree";
    } else if (sameLedgerEntries(awsNative.entries, imported.entries)) {
      source = "both";
      comparison = "both-agree";
      status = awsNative.status === "verified" && imported.status === "verified" ? "verified" : "partial";
      if (status === "verified") {
        appliedVersions = awsNative.entries.map(entry => entry.version);
        highestContiguousVersion = awsNative.highestContiguousVersion;
        latestAppliedVersion = awsNative.entries.at(-1)?.version ?? null;
        pending = files.filter(file => !appliedVersions.includes(Number(file.version))).map(file => ({ version: Number(file.version), filename: file.filename, content_sha256: file.sha256 }));
        if (!appliedVersions.length) status = "empty";
      }
    } else {
      status = "partial";
    }
  }

  return {
    status,
    source,
    comparison,
    blocked: status !== "verified",
    latestAppliedVersion,
    appliedVersions,
    pending,
    highestContiguousVersion,
    ledgers: { awsNative, imported },
  };
}

export async function inspectMigrationLedgerEvidence(client, files) {
  for (const sql of [migrationLedgerTransactionSql, migrationLedgerDiscoverySql, awsNativeMigrationLedgerSql, importedAwsMigrationLedgerSql]) {
    assertInspectionSql(sql);
  }
  const query = async (operation, sql, values) => {
    try {
      return await client.query(sql, values);
    } catch (cause) {
      const sqlState = typeof cause?.code === "string" && /^[0-9A-Z]{5}$/.test(cause.code) ? cause.code : "UNKNOWN";
      const error = new Error(`MIGRATION_LEDGER_${operation}_FAILED_${sqlState}`);
      error.code = `MIGRATION_LEDGER_${operation}_FAILED_${sqlState}`;
      throw error;
    }
  };
  const transaction = (await query("TRANSACTION_CHECK", migrationLedgerTransactionSql)).rows[0];
  if (transaction?.read_only !== "on" || transaction?.isolation !== "repeatable read") {
    throw new Error("MIGRATION_LEDGER_READ_ONLY_TRANSACTION_REQUIRED");
  }
  assertInspectionSql("SAVEPOINT migration_ledger_permission_probe");
  await client.query("SAVEPOINT migration_ledger_permission_probe");
  let relations;
  try {
    relations = (await client.query(migrationLedgerDiscoverySql)).rows[0] ?? {};
    await client.query("RELEASE SAVEPOINT migration_ledger_permission_probe");
  } catch (cause) {
    const sqlState = typeof cause?.code === "string" && /^[0-9A-Z]{5}$/.test(cause.code) ? cause.code : "UNKNOWN";
    await client.query("ROLLBACK TO SAVEPOINT migration_ledger_permission_probe");
    await client.query("RELEASE SAVEPOINT migration_ledger_permission_probe");
    if (sqlState === "42501") {
      try {
        const permissions = (await client.query(migrationLedgerSchemaPermissionSql)).rows[0];
        const deniedSchema = permissions?.public_schema_usage !== true ? "PUBLIC"
          : permissions?.imported_schema_usage !== true ? "IMPORTED"
            : null;
        if (deniedSchema) {
          const error = new Error(`MIGRATION_LEDGER_${deniedSchema}_SCHEMA_USAGE_DENIED`);
          error.code = `MIGRATION_LEDGER_${deniedSchema}_SCHEMA_USAGE_DENIED`;
          throw error;
        }
      } catch (diagnosticError) {
        if (diagnosticError?.code?.startsWith("MIGRATION_LEDGER_")) throw diagnosticError;
      }
    }
    const error = new Error(`MIGRATION_LEDGER_DISCOVERY_FAILED_${sqlState}`);
    error.code = `MIGRATION_LEDGER_DISCOVERY_FAILED_${sqlState}`;
    throw error;
  }
  const readLedger = async (operation, sql, relation, schemaName) => {
    assertInspectionSql("SAVEPOINT migration_ledger_permission_probe");
    await client.query("SAVEPOINT migration_ledger_permission_probe");
    try {
      const rows = (await client.query(sql)).rows;
      await client.query("RELEASE SAVEPOINT migration_ledger_permission_probe");
      return rows;
    } catch (cause) {
      const sqlState = typeof cause?.code === "string" && /^[0-9A-Z]{5}$/.test(cause.code) ? cause.code : "UNKNOWN";
      try {
        assertInspectionSql("ROLLBACK TO SAVEPOINT migration_ledger_permission_probe");
        await client.query("ROLLBACK TO SAVEPOINT migration_ledger_permission_probe");
        await client.query("RELEASE SAVEPOINT migration_ledger_permission_probe");
      } catch (recoveryError) {
        const recoverySqlState = typeof recoveryError?.code === "string" && /^[0-9A-Z]{5}$/.test(recoveryError.code) ? recoveryError.code : "UNKNOWN";
        const error = new Error(`MIGRATION_LEDGER_${operation}_SAVEPOINT_RECOVERY_FAILED_${recoverySqlState}`);
        error.code = `MIGRATION_LEDGER_${operation}_SAVEPOINT_RECOVERY_FAILED_${recoverySqlState}`;
        throw error;
      }
      if (sqlState === "42501") {
        let permission;
        try {
          permission = (await client.query(migrationLedgerPermissionSql, [schemaName, relation])).rows[0];
        } catch (diagnosticError) {
          const diagnosticSqlState = typeof diagnosticError?.code === "string" && /^[0-9A-Z]{5}$/.test(diagnosticError.code) ? diagnosticError.code : "UNKNOWN";
          const error = new Error(`MIGRATION_LEDGER_${operation}_PERMISSION_DIAGNOSTIC_FAILED_${diagnosticSqlState}`);
          error.code = `MIGRATION_LEDGER_${operation}_PERMISSION_DIAGNOSTIC_FAILED_${diagnosticSqlState}`;
          throw error;
        }
        const reason = permission?.schema_usage !== true ? "SCHEMA_USAGE_DENIED"
          : permission?.ledger_select !== true ? "SELECT_DENIED"
            : "PERMISSION_STATE_UNRESOLVED";
        const error = new Error(`MIGRATION_LEDGER_${operation}_${reason}`);
        error.code = `MIGRATION_LEDGER_${operation}_${reason}`;
        throw error;
      }
      const error = new Error(`MIGRATION_LEDGER_${operation}_SELECT_FAILED_${sqlState}`);
      error.code = `MIGRATION_LEDGER_${operation}_SELECT_FAILED_${sqlState}`;
      throw error;
    }
  };
  const awsNativeRows = relations.aws_native_relation
    ? await readLedger("AWS_NATIVE", awsNativeMigrationLedgerSql, "public.tracepoint_aws_schema_migrations", "public")
    : null;
  const importedRows = relations.imported_relation
    ? await readLedger("IMPORTED", importedAwsMigrationLedgerSql, "tracepoint_migrations.applied_migrations", "tracepoint_migrations")
    : null;
  return classifyMigrationLedgerEvidence({ awsNativeRows, importedRows }, files);
}

export const mobileApiDependenciesSql = `with required(relation_name, required_columns, require_rls) as (values
  ('fleet_vehicles', array['id','department_id','unit_number','vin','status']::text[], false),
  ('fleet_rules', array['department_id','inspection_role_codes']::text[], false),
  ('equipment_assets', array['id','department_id','manufacturer','model','serial_number','asset_number','lifecycle_status']::text[], false),
  ('firearms', array['id','department_id','make','model','serial_number','asset_number','condition_status','is_active']::text[], false),
  ('inventory_items', array['id','department_id','name','category','sku','tracking_mode','unit_of_measure','is_active']::text[], false),
  ('inventory_balances', array['id','department_id','inventory_item_id','inventory_location_id','on_hand_quantity']::text[], false),
  ('inventory_locations', array['id','department_id','name']::text[], false),
  ('notification_events', array['id','department_id','user_id','notification_key','title','detail','href','priority','source','kind','source_created_at','acknowledged_at','snoozed_until','last_seen_at','resolved_at']::text[], false),
  ('drill_documents', array['id','department_id','drill_template_id','storage_path','original_filename']::text[], false),
  ('pilot_range_workspaces', array['department_id','workspace','updated_by_user_id','updated_at']::text[], true),
  ('department_memberships', array['department_id','user_id','is_active','badge_number']::text[], false),
  ('profiles', array['id','full_name','email']::text[], false),
  ('range_days', array['id','department_id','title','range_date','status','range_type','packet_status']::text[], false),
  ('range_day_drills', array['id','department_id','range_day_id','name','category','scoring_format','passing_score','max_score','passing_time_seconds']::text[], false),
  ('drill_run_results', array['id','department_id','range_day_id','range_day_drill_id','officer_user_id','run_number','completed','score','time_seconds','hit_count','passed','notes']::text[], false),
  ('range_day_roster', array['id','department_id','range_day_id','officer_user_id','attendance_status']::text[], false),
  ('department_qualification_standards', array['id','department_id','name','firearm_type','is_active']::text[], false),
  ('department_qualification_standard_components', array['department_id','qualification_standard_id','name','scoring_basis','passing_score','passing_time_seconds','minimum_hits','is_required','is_active','sort_order']::text[], false),
  ('department_membership_roles', array['department_id','user_id','role_code']::text[], false)
)
select required.relation_name,
  to_regclass(format('public.%I', required.relation_name)) is not null as relation_present,
  not exists (
    select 1 from unnest(required.required_columns) as expected(column_name)
    where not exists (
      select 1 from pg_attribute actual
      join pg_class relation on relation.oid=actual.attrelid
      join pg_namespace relation_schema on relation_schema.oid=relation.relnamespace
      where relation_schema.nspname='public' and relation.relname=required.relation_name
        and actual.attname=expected.column_name and actual.attnum>0 and not actual.attisdropped
    )
  ) as required_columns_present,
  not required.require_rls or coalesce((select relrowsecurity from pg_class where oid=to_regclass(format('public.%I', required.relation_name))), false) as rls_enabled,
  case when to_regclass(format('public.%I', required.relation_name)) is not null then has_table_privilege('tracepoint_runtime', to_regclass(format('public.%I', required.relation_name)), 'select') else false end as runtime_select_privilege_present,
  case when to_regclass(format('public.%I', required.relation_name)) is not null then has_table_privilege('authenticated', to_regclass(format('public.%I', required.relation_name)), 'select') else false end as authenticated_select_privilege_present,
  case when required.relation_name='pilot_range_workspaces' then has_table_privilege('authenticated', to_regclass('public.pilot_range_workspaces'), 'select') else true end as read_privilege_present,
  case when required.relation_name='pilot_range_workspaces' then
    has_table_privilege('authenticated', to_regclass('public.pilot_range_workspaces'), 'insert')
    and has_table_privilege('authenticated', to_regclass('public.pilot_range_workspaces'), 'update')
    else true end as write_privileges_present,
  case when required.relation_name='pilot_range_workspaces' then
    exists(select 1 from pg_policies where schemaname='public' and tablename='pilot_range_workspaces' and cmd in ('SELECT','ALL') and 'authenticated'=any(roles))
    and exists(select 1 from pg_policies where schemaname='public' and tablename='pilot_range_workspaces' and cmd in ('INSERT','ALL') and 'authenticated'=any(roles))
    and exists(select 1 from pg_policies where schemaname='public' and tablename='pilot_range_workspaces' and cmd in ('UPDATE','ALL') and 'authenticated'=any(roles))
    else true end as policies_present,
  case when required.relation_name='pilot_range_workspaces' then
    exists(select 1 from pg_trigger where tgrelid=to_regclass('public.pilot_range_workspaces') and tgname='pilot_range_workspaces_accountability_audit' and not tgisinternal)
    else true end as accountability_trigger_present
from required order by required.relation_name`;

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
  if (/^(begin transaction read only|begin transaction isolation level repeatable read read only|set transaction read only|set local search_path = pg_catalog|commit|savepoint migration_ledger_permission_probe|release savepoint migration_ledger_permission_probe|rollback to savepoint migration_ledger_permission_probe)$/.test(normalized)) return;
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
