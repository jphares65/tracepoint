const VERSION = 38;
const FILENAME = "038_default_module_entitlements.sql";

export const EXPECTED_MODULE_CATALOG = Object.freeze([
  { code: "ammunition", display_name: "Ammunition", description: "Ammunition inventory and transactions.", sort_order: 10 },
  { code: "analytics", display_name: "Analytics", description: "Agency analytics and reports.", sort_order: 20 },
  { code: "certifications", display_name: "Certifications", description: "Agency certification records and readiness.", sort_order: 30 },
  { code: "command_dashboard", display_name: "Command Dashboard", description: "Command dashboard and operational readiness.", sort_order: 40 },
  { code: "equipment_readiness", display_name: "Equipment Readiness", description: "Equipment inventory, assignment, and readiness.", sort_order: 50 },
  { code: "fleet", display_name: "Fleet", description: "Agency vehicle inspections, maintenance, and fleet records.", sort_order: 55 },
  { code: "firearms", display_name: "Firearms", description: "Agency and personally owned firearm records.", sort_order: 60 },
  { code: "inventory", display_name: "Inventory", description: "Agency supply inventory, locations, and checkouts.", sort_order: 65 },
  { code: "off_duty", display_name: "Off-duty Firearms", description: "Off-duty firearm requests and approvals.", sort_order: 70 },
  { code: "qualifications", display_name: "Qualifications", description: "Officer qualification records and standards.", sort_order: 80 },
  { code: "range_training", display_name: "Range and Training", description: "Range days, agency training, and digital packets.", sort_order: 90 },
]);

const REQUIRED_RELATIONS = [
  "public.tracepoint_aws_schema_migrations",
  "public.feature_catalog",
  "public.departments",
  "public.department_features",
  "public.department_feature_events",
];

const ROUTINE_NAMES = [
  "provision_missing_department_features",
  "provision_department_features_after_insert",
  "provision_feature_for_existing_departments",
];

function rows(result) { return Array.isArray(result?.rows) ? result.rows : []; }
function hasFunctionText(definition, fragments) {
  const normalized = String(definition ?? "").toLowerCase().replace(/\s+/g, " ");
  return fragments.every((fragment) => normalized.includes(fragment));
}

/**
 * Inspect migration 038 state using SELECT statements in a transaction that
 * PostgreSQL itself enforces as read-only. The transaction is always rolled
 * back, including on success.
 */
export async function readMigration038Diagnostics(client) {
  await client.query("begin read only");
  try {
    const relationResult = await client.query(
      "select relation_name, to_regclass(relation_name) is not null as present from unnest($1::text[]) as relations(relation_name)",
      [REQUIRED_RELATIONS],
    );
    const relationPresence = Object.fromEntries(rows(relationResult).map((item) => [item.relation_name, item.present === true]));

    let ledger = { status: "absent", record: null };
    if (relationPresence[REQUIRED_RELATIONS[0]]) {
      const ledgerResult = await client.query(
        `select filename, content_sha256, applied_at, application_git_sha, application_context, is_baseline
         from public.tracepoint_aws_schema_migrations where version = $1`,
        [VERSION],
      );
      ledger = { status: rows(ledgerResult).length ? "present" : "version_missing", record: rows(ledgerResult)[0] ?? null };
    }

    const expectedCodes = EXPECTED_MODULE_CATALOG.map(({ code }) => code);
    let catalog = { status: "unavailable", records: [], missing_codes: expectedCodes, mismatches: [] };
    let triggers = { status: "unavailable", records: [] };
    let functions = { status: "unavailable", records: [] };
    let entitlements = { status: "unavailable" };
    let eventHistory = { status: "unavailable" };

    if (relationPresence[REQUIRED_RELATIONS[1]]) {
      const result = await client.query(
        `select code, display_name, description, sort_order, is_active
         from public.feature_catalog where code = any($1::text[]) order by sort_order, code`,
        [expectedCodes],
      );
      const actualByCode = new Map(rows(result).map((item) => [item.code, item]));
      const missingCodes = expectedCodes.filter((code) => !actualByCode.has(code));
      const mismatches = EXPECTED_MODULE_CATALOG.flatMap((expected) => {
        const actual = actualByCode.get(expected.code);
        if (!actual) return [];
        const fields = ["display_name", "description", "sort_order"];
        return fields.filter((field) => actual[field] !== expected[field]).map((field) => ({ code: expected.code, field, expected: expected[field], actual: actual[field] }));
      });
      catalog = {
        status: missingCodes.length === 0 && mismatches.length === 0 ? "verified" : "mismatch",
        records: rows(result),
        missing_codes: missingCodes,
        mismatches,
        inactive_codes: rows(result).filter((item) => item.is_active !== true).map((item) => item.code),
      };
    }

    if (relationPresence[REQUIRED_RELATIONS[1]] && relationPresence[REQUIRED_RELATIONS[2]]) {
      const result = await client.query(
        `select trigger.tgname as trigger_name, trigger.tgenabled as enabled_state,
                pg_get_triggerdef(trigger.oid, true) as definition,
                function_namespace.nspname as function_schema, procedure.proname as function_name
         from pg_trigger trigger
         join pg_class relation on relation.oid = trigger.tgrelid
         join pg_namespace relation_namespace on relation_namespace.oid = relation.relnamespace
         join pg_proc procedure on procedure.oid = trigger.tgfoid
         join pg_namespace function_namespace on function_namespace.oid = procedure.pronamespace
         where not trigger.tgisinternal and relation_namespace.nspname = 'public'
           and trigger.tgname = any($1::text[])
         order by trigger.tgname`,
        [["departments_default_module_entitlements", "feature_catalog_default_department_entitlements"]],
      );
      const actualByName = new Map(rows(result).map((item) => [item.trigger_name, item]));
      const expected = [
        { trigger_name: "departments_default_module_entitlements", table: "public.departments", event: "after insert", function_name: "provision_department_features_after_insert" },
        { trigger_name: "feature_catalog_default_department_entitlements", table: "public.feature_catalog", event: "after insert or update of is_active", function_name: "provision_feature_for_existing_departments" },
      ];
      const checked = expected.map((item) => {
        const actual = actualByName.get(item.trigger_name);
        const definition = String(actual?.definition ?? "").toLowerCase().replace(/\s+/g, " ");
        return {
          ...item,
          present: Boolean(actual),
          enabled: actual?.enabled_state === "O",
          definition_matches: Boolean(actual)
            && actual.function_schema === "tracepoint_auth"
            && definition.includes(item.table)
            && definition.includes(item.event)
            && definition.includes(`tracepoint_auth.${item.function_name}`),
        };
      });
      triggers = { status: checked.every((item) => item.present && item.enabled && item.definition_matches) ? "verified" : "mismatch", records: checked };
    }

    if (relationPresence[REQUIRED_RELATIONS[3]]) {
      const result = await client.query(
        `select procedure.proname as function_name, procedure.prosecdef as security_definer,
                procedure.proconfig as function_settings,
                coalesce((select json_agg(json_build_object(
                  'grantee', case when acl.grantee = 0 then 'PUBLIC' else grantee_role.rolname end,
                  'privilege', acl.privilege_type, 'grantable', acl.is_grantable
                ) order by acl.grantee, acl.privilege_type)
                from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
                left join pg_roles grantee_role on grantee_role.oid = acl.grantee), '[]'::json) as acl,
                pg_get_functiondef(procedure.oid) as definition
         from pg_proc procedure
         join pg_namespace function_namespace on function_namespace.oid = procedure.pronamespace
         where function_namespace.nspname = 'tracepoint_auth' and procedure.proname = any($1::text[])
         order by procedure.proname`,
        [ROUTINE_NAMES],
      );
      const actualByName = new Map(rows(result).map((item) => [item.function_name, item]));
      const expectations = [
        { name: ROUTINE_NAMES[0], fragments: ["security definer", "where feature.is_active", "on conflict (department_id, feature_code) do nothing", "insert into public.department_feature_events"] },
        { name: ROUTINE_NAMES[1], fragments: ["security definer", "provision_missing_department_features", "default-enabled modules provisioned for a new agency"] },
        { name: ROUTINE_NAMES[2], fragments: ["security definer", "not new.is_active", "provision_missing_department_features", "new module enabled by the operational feature catalog"] },
      ];
      const checked = expectations.map((expected) => {
        const actual = actualByName.get(expected.name);
        const settings = Array.isArray(actual?.function_settings) ? actual.function_settings.join(" ").toLowerCase() : String(actual?.function_settings ?? "").toLowerCase();
        const acl = Array.isArray(actual?.acl) ? actual.acl : [];
        const forbiddenExec = acl.some((grant) => ["PUBLIC", "anon", "authenticated", "service_role"].includes(grant.grantee) && grant.privilege === "EXECUTE");
        return {
          function_name: expected.name,
          present: Boolean(actual),
          security_definer: actual?.security_definer === true,
          safe_search_path: settings.includes("search_path=pg_catalog, public"),
          definition_matches: Boolean(actual) && hasFunctionText(actual.definition, expected.fragments),
          forbidden_execute_grants: forbiddenExec,
          acl,
        };
      });
      functions = { status: checked.every((item) => item.present && item.security_definer && item.safe_search_path && item.definition_matches && !item.forbidden_execute_grants) ? "verified" : "mismatch", records: checked };
    }

    if (relationPresence[REQUIRED_RELATIONS[2]] && relationPresence[REQUIRED_RELATIONS[1]] && relationPresence[REQUIRED_RELATIONS[3]]) {
      const result = await client.query(
        `select (select count(*)::int from public.departments) as agency_count,
                (select count(*)::int from public.feature_catalog where is_active) as active_feature_count,
                count(*) filter (where feature.is_active)::int as expected_entitlement_pairs,
                count(*) filter (where feature.is_active and entitlement.department_id is null)::int as missing_entitlement_pairs,
                count(*) filter (where feature.is_active and entitlement.department_id is not null and entitlement.is_enabled)::int as enabled_entitlement_pairs,
                count(*) filter (where feature.is_active and entitlement.department_id is not null and not entitlement.is_enabled)::int as explicitly_disabled_entitlement_pairs
         from public.departments department
         cross join public.feature_catalog feature
         left join public.department_features entitlement
           on entitlement.department_id = department.id and entitlement.feature_code = feature.code
         where feature.is_active`,
      );
      const coverage = rows(result)[0] ?? {};
      entitlements = {
        status: Number(coverage.missing_entitlement_pairs ?? -1) === 0 ? "verified" : "mismatch",
        ...coverage,
      };
    }

    if (relationPresence[REQUIRED_RELATIONS[4]]) {
      const result = await client.query(
        `select count(*) filter (where reason = 'Default-enabled module entitlement backfill.')::int as backfill_events,
                count(*) filter (where reason = 'Default-enabled module entitlement backfill.' and (previous_enabled is not null or new_enabled is distinct from true))::int as malformed_backfill_events,
                count(*) filter (where reason = 'Default-enabled modules provisioned for a new agency.')::int as new_agency_provisioning_events,
                count(*) filter (where reason = 'New module enabled by the operational feature catalog.')::int as new_module_provisioning_events
         from public.department_feature_events`,
      );
      const summary = rows(result)[0] ?? {};
      eventHistory = { status: Number(summary.malformed_backfill_events ?? -1) === 0 ? "verified" : "mismatch", ...summary };
    }

    const record = ledger.record;
    return {
      ledger: ledger.status,
      diagnostic: "aws-native-migration-038",
      read_only: true,
      inspected_version: VERSION,
      expected_filename: FILENAME,
      expected_content_sha256: "857baa4ab02f99acb046a71a820c9d54bd0d69fd56cf6048fba22945685adff1",
      recorded: record,
      filename_matches: record?.filename === FILENAME,
      checksum_matches: record?.content_sha256 === "857baa4ab02f99acb046a71a820c9d54bd0d69fd56cf6048fba22945685adff1",
      relations: relationPresence,
      catalog,
      triggers,
      functions,
      entitlements,
      event_history: eventHistory,
    };
  } finally {
    await client.query("rollback");
  }
}
