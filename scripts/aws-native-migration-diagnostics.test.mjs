import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { EXPECTED_MODULE_CATALOG, readMigration038Diagnostics } from "./aws-native-migration-diagnostics.mjs";

function fakeClient() {
  const statements = [];
  const client = {
    async query(sql, parameters = []) {
      statements.push({ sql: String(sql).trim(), parameters });
      if (/^begin read only$/i.test(String(sql).trim())) return { rows: [] };
      if (/^rollback$/i.test(String(sql).trim())) return { rows: [] };
      if (/from unnest\(/i.test(sql)) return { rows: parameters[0].map((relation_name) => ({ relation_name, present: true })) };
      if (/from public\.tracepoint_aws_schema_migrations/i.test(sql)) return { rows: [{
        filename: "038_agency_documents_template_builder.sql",
        content_sha256: "83f1ffdb10c646d4b7ac7e1d0478b009d53da214cbc4407c12f6b9db6edf1e3a",
        applied_at: "2026-10-13T12:00:00.000Z",
        application_git_sha: "a".repeat(40),
        application_context: "apply",
        is_baseline: false,
      }] };
      if (/from public\.feature_catalog/i.test(sql) && /where code = any/i.test(sql)) return { rows: EXPECTED_MODULE_CATALOG.map((item) => ({ ...item, is_active: true })) };
      if (/from pg_trigger/i.test(sql)) return { rows: [
        { trigger_name: "departments_default_module_entitlements", enabled_state: "O", definition: "CREATE TRIGGER departments_default_module_entitlements AFTER INSERT ON public.departments FOR EACH ROW EXECUTE FUNCTION tracepoint_auth.provision_department_features_after_insert()", function_schema: "tracepoint_auth", function_name: "provision_department_features_after_insert" },
        { trigger_name: "feature_catalog_default_department_entitlements", enabled_state: "O", definition: "CREATE TRIGGER feature_catalog_default_department_entitlements AFTER INSERT OR UPDATE OF is_active ON public.feature_catalog FOR EACH ROW EXECUTE FUNCTION tracepoint_auth.provision_feature_for_existing_departments()", function_schema: "tracepoint_auth", function_name: "provision_feature_for_existing_departments" },
      ] };
      if (/from pg_proc procedure/i.test(sql)) return { rows: [
        { function_name: "provision_missing_department_features", security_definer: true, function_settings: ["search_path=pg_catalog, public"], acl: [], definition: "SECURITY DEFINER where feature.is_active on conflict (department_id, feature_code) do nothing insert into public.department_feature_events" },
        { function_name: "provision_department_features_after_insert", security_definer: true, function_settings: ["search_path=pg_catalog, public"], acl: [], definition: "SECURITY DEFINER provision_missing_department_features default-enabled modules provisioned for a new agency" },
        { function_name: "provision_feature_for_existing_departments", security_definer: true, function_settings: ["search_path=pg_catalog, public"], acl: [], definition: "SECURITY DEFINER not new.is_active provision_missing_department_features new module enabled by the operational feature catalog" },
      ] };
      if (/from public\.departments department/i.test(sql)) return { rows: [{ agency_count: 2, active_feature_count: 11, expected_entitlement_pairs: 22, missing_entitlement_pairs: 0, enabled_entitlement_pairs: 20, explicitly_disabled_entitlement_pairs: 2 }] };
      if (/from public\.department_feature_events/i.test(sql)) return { rows: [{ backfill_events: 20, malformed_backfill_events: 0, new_agency_provisioning_events: 0, new_module_provisioning_events: 0 }] };
      throw new Error(`Unexpected query in test: ${sql}`);
    },
  };
  return { client, statements };
}

test("migration 038 diagnostics verify restored Agency Documents lineage and module state read-only", async () => {
  const { client, statements } = fakeClient();
  const report = await readMigration038Diagnostics(client);

  assert.equal(report.ledger, "present");
  assert.equal(report.recorded.filename, "038_agency_documents_template_builder.sql");
  assert.equal(report.filename_matches, true);
  assert.equal(report.checksum_matches, true);
  assert.equal(report.catalog.status, "verified");
  assert.equal(report.catalog.records.length, 11);
  assert.equal(report.triggers.status, "verified");
  assert.equal(report.functions.status, "verified");
  assert.equal(report.entitlements.status, "verified");
  assert.equal(report.entitlements.missing_entitlement_pairs, 0);
  assert.equal(report.entitlements.explicitly_disabled_entitlement_pairs, 2);
  assert.equal(report.event_history.status, "verified");
  assert.equal(report.event_history.backfill_events, 20);

  assert.equal(statements[0].sql, "begin read only");
  assert.equal(statements.at(-1).sql, "rollback");
  assert.ok(statements.slice(1, -1).every(({ sql }) => /^select\b/i.test(sql)), "all statements inside the transaction are SELECT queries");
});

test("diagnostic expectations stay aligned with the restored 038 source and version 042 catalog migration", async () => {
  // Staging's ledger records hashes of the canonical archive bytes (git archive with core.autocrlf=true, i.e. CRLF),
  // whatever line endings this checkout uses.
  const archiveBytes = (contents) => contents.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  const historicalMigration = await readFile(new URL("../database/aws/038_agency_documents_template_builder.sql", import.meta.url), "utf8");
  assert.equal(createHash("sha256").update(archiveBytes(historicalMigration)).digest("hex"), "83f1ffdb10c646d4b7ac7e1d0478b009d53da214cbc4407c12f6b9db6edf1e3a");

  const migration = await readFile(new URL("../database/aws/042_default_module_entitlements.sql", import.meta.url), "utf8");
  assert.equal(createHash("sha256").update(archiveBytes(migration)).digest("hex"), "f24425f5370f1ab32ec7074b13dd56f5b00afa5ab757039ca431f7312c27a4b4");
  assert.equal(createHash("sha256").update(migration.replace(/\r\n/g, "\n")).digest("hex"), "857baa4ab02f99acb046a71a820c9d54bd0d69fd56cf6048fba22945685adff1");

  const seededRows = [...migration.matchAll(/^\s*\('([a-z_]+)', '([^']+)', '([^']*)', (\d+), true\),?$/gm)]
    .map(([, code, display_name, description, sort_order]) => ({ code, display_name, description, sort_order: Number(sort_order) }));
  assert.deepEqual(seededRows, EXPECTED_MODULE_CATALOG);
  assert.match(migration, /Existing[\s\S]*?rows, including disabled rows, are deliberately preserved by DO NOTHING/);
  assert.match(migration, /on conflict \(department_id, feature_code\) do nothing/);
});

test("diagnose is staging-only and leaves normal migration drift checks in place", async () => {
  const [runner, taskWrapper, releaseWrapper, dockerfile] = await Promise.all([
    readFile(new URL("./run-aws-native-migrations.mjs", import.meta.url), "utf8"),
    readFile(new URL("./apply-app-migrations.ps1", import.meta.url), "utf8"),
    readFile(new URL("./migrate-db.ps1", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
  ]);
  assert.match(runner, /action === "diagnose"/);
  assert.match(runner, /requestedEnvironment !== "staging"/);
  assert.match(runner, /MIGRATION_DRIFT/);
  // Staging apply: contiguous 001-045, 001-041 recorded, exactly 042-045 pending.
  assert.match(runner, /versions\.length !== 45/);
  assert.match(runner, /report\.applied\.length !== 41/);
  assert.match(runner, /"042_default_module_entitlements\.sql",\s+"043_range_workspace_authenticated_writes\.sql",\s+"044_cognito_password_global_scope\.sql",\s+"045_password_operation_resolution\.sql"/);
  assert.match(runner, /await import\("\.\/aws-native-migration-diagnostics\.mjs"\)/);
  assert.match(runner, /STAGING_DATABASE_DIAGNOSTIC_FAILED: database connection details suppressed/);
  assert.match(runner, /STAGING_DATABASE_DIAGNOSTIC_FAILED: query details suppressed/);
  // Every action closes its connection without letting a close error replace the real outcome.
  assert.match(runner, /if \(client\) await client\.end\(\)\.catch\(\(\) => undefined\)/);
  assert.match(taskWrapper, /if \(\$Action -eq 'diagnose' -and \$Environment -ne 'staging'\)/);
  assert.match(taskWrapper, /\$ImageCommit -cne 'a3fa9855f4c797dfb7b4dd16144cf6c85a445946'/);
  assert.match(taskWrapper, /ValidateSet\('status','baseline','reconcile','apply','diagnose'[,)]/);
  assert.match(taskWrapper, /if \(\$TaskAction -ne 'diagnose'\)/);
  assert.match(taskWrapper, /scripts\/aws-native-migration-diagnostics\.mjs/);
  assert.match(taskWrapper, /'database\/aws'/);
  assert.match(taskWrapper, /\$container\.command = @\('scripts\/run-aws-native-migrations\.mjs',\$TaskAction,\$Environment\)/);
  assert.match(releaseWrapper, /ValidateSet\('status','baseline','apply','diagnose'\)/);
  assert.match(releaseWrapper, /apply-app-migrations\.ps1'\) -Environment \$Environment -Action \$Action/);
  assert.match(releaseWrapper, /if \(\$Action -eq 'diagnose' -and \$Environment -ne 'staging'\)/);
  assert.match(releaseWrapper, /\$ImageCommit -cne 'a3fa9855f4c797dfb7b4dd16144cf6c85a445946'/);
  assert.match(releaseWrapper, /-ImageCommit \$commit -MigrationSourceCommit \$toolingCommit/);
  assert.match(taskWrapper, /\$applicationCommit = if \(\$ImageCommit\) \{ \$ImageCommit \} else \{ \$toolingCommit \}/);
  assert.match(taskWrapper, /Migration image must use the exact reviewed release-tooling commit/);
  assert.match(dockerfile, /aws-native-migration-diagnostics\.mjs/);
  assert.match(dockerfile, /\/app\/database\/aws \.\/database\/aws/);
});
