import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { AUTHORIZATION_REFERENCE, MIGRATION_RELATIONS, PROJECT_URL, RELATION_ORDER_COLUMNS, RUN_ID, canonical, sha256 } from "./supabase-rest-ledger-core.mjs";
import { COPY_RELATIONS, DERIVED_RELATIONS, FIREARM_ASSIGNMENTS_SCHEMA_REPAIR, IMPORT_RELATIONS, OBJECT_MANIFEST, ROLE_PERMISSIONS_RECONCILIATION_MODE, SCHEMA_REPAIR_MODE, SCHEMA_SWEEP_MODE, TARGET_DATA_PREFLIGHT_MODE, TARGET_ACCOUNT, TARGET_BUCKET, TARGET_SEEDED_REFERENCE_RELATIONS, allAdminUsers, allRelationRows, canonicalRowsHash, classifySourceOnlyColumn, classifyTargetOnlyColumn, compareSourceColumns, importEvidence, insertSql, reconcileExactTargetSeededRelation, reconcileFeatureCatalog, reconcileRolePermissionDifferences, requireExactTargetSeededParity, requireTargetSeededFeatureCatalogParity, requireTargetSeededRolePermissionRule, sourceColumns, sourceHeaders, sourceObjectUrl, summarizeSourceColumn, targetRowsSql, topologicalImportOrder, validateColumnMapping, validateImportInvocation, validateObjectBytes, validateTargetSecret } from "./supabase-rest-import-core.mjs";

const mode = process.env.TRACEPOINT_REST_IMPORT_MODE;
assert.ok(mode === "database" || mode === "objects" || mode === "reconcile" || mode === "schema-contract" || mode === SCHEMA_REPAIR_MODE || mode === SCHEMA_SWEEP_MODE || mode === TARGET_DATA_PREFLIGHT_MODE || mode === ROLE_PERMISSIONS_RECONCILIATION_MODE, "A reviewed migration mode is required");
validateImportInvocation(process.env, mode);
const rawSource = process.env.SOURCE_SUPABASE_REST_SECRET_JSON;
delete process.env.SOURCE_SUPABASE_REST_SECRET_JSON;
assert.ok(rawSource, "Dedicated source REST secret was not injected");
const headers = sourceHeaders(JSON.parse(rawSource));

function safeError(error, phase) { const message=error instanceof Error?error.message:""; const detail=/^[A-Z_]+(?::[a-z0-9_]+)?$/.test(message)?message:undefined; return { status: "FAILED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mode, phase, errorName: error instanceof Error ? error.name : "Error", errorCode: typeof error === "object" && error && "code" in error ? String(error.code) : undefined, detail }; }
async function sourceSnapshot() {
  const rows = new Map();
  for (const relation of MIGRATION_RELATIONS) rows.set(relation, await allRelationRows(fetch, headers, relation));
  const users = await allAdminUsers(fetch, headers);
  const total = [...rows.values()].reduce((sum, relationRows) => sum + relationRows.length, 0);
  const memberships = rows.get("department_memberships") ?? [];
  assert.equal(total, 4723, "SOURCE_TOTAL_ROW_MISMATCH"); assert.equal(users.length, 96, "SOURCE_IDENTITY_COUNT_MISMATCH"); assert.equal(memberships.length, 95, "SOURCE_MEMBERSHIP_COUNT_MISMATCH");
  return { rows, users };
}
function jsonRows(rows) { return rows.map(row => canonical(row)); }
async function queryColumns(client, relation) { return (await client.query("select column_name,is_nullable,column_default,(is_identity='YES') as is_identity from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position", [relation])).rows; }
async function targetRelationKinds(client) { return new Map((await client.query("select c.relname as name,c.relkind as kind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])", [MIGRATION_RELATIONS])).rows.map(row => [row.name, row.kind])); }
async function targetForeignKeys(client) { return (await client.query("select child.relname as child,parent.relname as parent from pg_constraint fk join pg_class child on child.oid=fk.conrelid join pg_namespace cn on cn.oid=child.relnamespace join pg_class parent on parent.oid=fk.confrelid join pg_namespace pn on pn.oid=parent.relnamespace where fk.contype='f' and cn.nspname='public' and pn.nspname='public'")).rows; }
async function targetRows(client, relation, columns) { const order = RELATION_ORDER_COLUMNS[relation] ?? ["id"]; return (await client.query(targetRowsSql(relation, columns, order))).rows.map(item => item.row); }
async function preflightTarget(client, snapshot) {
  const kinds = await targetRelationKinds(client);
  for (const relation of COPY_RELATIONS) assert.equal(kinds.get(relation), "r", `TARGET_TABLE_MISSING:${relation}`);
  for (const relation of DERIVED_RELATIONS) assert.equal(kinds.get(relation), "v", `TARGET_VIEW_MISSING:${relation}`);
  const mappings = []; const targetBefore = new Map();
  for (const relation of IMPORT_RELATIONS) {
    const rows = snapshot.rows.get(relation) ?? []; const mapping = validateColumnMapping(relation, rows, await queryColumns(client, relation));
    const existing = await targetRows(client, relation, mapping.sourceColumns);
    if (existing.length && canonicalRowsHash(existing) !== canonicalRowsHash(rows)) throw new Error(`TARGET_UNEXPLAINED_ROWS:${relation}`);
    mappings.push(mapping); targetBefore.set(relation, existing.length);
  }
  const targetSeeded = await reconcileTargetSeededReferences(client, snapshot);
  const authUsers = Number((await client.query("select count(*)::int as count from auth.users")).rows[0].count);
  if (authUsers !== 0 && authUsers !== snapshot.users.length) throw new Error("TARGET_UNEXPLAINED_IDENTITY_ANCHORS");
  const lineage = Number((await client.query("select count(*)::int as count from tracepoint_migrations.applied_migrations")).rows[0].count);
  assert.equal(lineage, 97, "TARGET_MIGRATION_LINEAGE_MISMATCH");
  return { mappings, targetBefore, authUsers, targetSeeded, order: topologicalImportOrder(IMPORT_RELATIONS, await targetForeignKeys(client)) };
}
async function insertIdentityAnchors(client, users) {
  const profiles = new Set();
  const result = await client.query("select id::text from public.profiles");
  for (const row of result.rows) profiles.add(row.id);
  const sourceIds = new Set(users.map(user => String(user.id)));
  assert.equal(sourceIds.size, users.length, "SOURCE_DUPLICATE_IDENTITIES");
  for (const id of profiles) assert.ok(sourceIds.has(id), "TARGET_PROFILE_NOT_IN_SOURCE_IDENTITIES");
  if ((await client.query("select count(*)::int as count from auth.users")).rows[0].count === 0) {
    await client.query("begin");
    try {
      for (const user of users) {
        assert.ok(typeof user.id === "string" && typeof user.email === "string" && user.email.length > 0, "SOURCE_IDENTITY_MAPPING_AMBIGUOUS");
        await client.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)", [user.id, user.email, JSON.stringify({ identity_provider: "migration_anchor", source_user_metadata: user.user_metadata ?? {} })]);
      }
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; }
  }
  assert.equal(Number((await client.query("select count(*)::int as count from auth.users")).rows[0].count), users.length, "TARGET_IDENTITY_ANCHOR_COUNT_MISMATCH");
}
async function importRelation(client, relation, rows, mapping, alreadyPresent) {
  if (alreadyPresent) return { relation, imported: 0, resumed: rows.length };
  if (!rows.length) return { relation, imported: 0, resumed: 0 };
  const sql = insertSql(relation, mapping.sourceColumns);
  for (let start = 0; start < rows.length; start += 200) {
    await client.query("begin");
    try { for (const row of rows.slice(start, start + 200)) await client.query(sql, [JSON.stringify(row)]); await client.query("commit"); }
    catch (error) { await client.query("rollback"); throw error; }
  }
  return { relation, imported: rows.length, resumed: 0 };
}
async function repairSequences(client) {
  await client.query("do $repair$ declare item record; begin for item in select n.nspname as schemaname,c.relname as tablename,a.attname as columnname from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped and pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),a.attname) is not null loop execute format('select setval(pg_get_serial_sequence(%L,%L),coalesce((select max(%I) from %I.%I),1),true)',item.schemaname||'.'||item.tablename,item.columnname,item.columnname,item.schemaname,item.tablename); end loop; end $repair$");
}
async function verifyDatabase(client, snapshot, preflight) {
  const sourceTables = []; const targetTables = [];
  for (const relation of IMPORT_RELATIONS) {
    const mapping = preflight.mappings.find(item => item.relation === relation); const sourceRows = snapshot.rows.get(relation) ?? []; const target = await targetRows(client, relation, mapping.sourceColumns);
    assert.equal(target.length, sourceRows.length, `TARGET_ROW_COUNT_MISMATCH:${relation}`); assert.equal(canonicalRowsHash(target), canonicalRowsHash(sourceRows), `TARGET_ROW_HASH_MISMATCH:${relation}`);
    sourceTables.push({ name: relation, rows: sourceRows.length, canonicalDataSha256: canonicalRowsHash(sourceRows) }); targetTables.push({ name: relation, rows: target.length, canonicalDataSha256: canonicalRowsHash(target) });
  }
  for (const relation of TARGET_SEEDED_REFERENCE_RELATIONS) {
    const sourceRows = snapshot.rows.get(relation) ?? [], reconciliation = preflight.targetSeeded.get(relation);
    sourceTables.push({ name: relation, rows: sourceRows.length, canonicalDataSha256: canonicalRowsHash(sourceRows), reconciliation: relation === "feature_catalog" ? "target-seeded reference data — excluded by design" : "target-seeded reference data — exact security/catalog parity required" });
    targetTables.push({ name: relation, rows: reconciliation.targetCount, canonicalDataSha256: reconciliation.targetCanonicalSha256, reconciliation: relation === "feature_catalog" ? "target-seeded reference data — excluded by design" : "target-seeded reference data — exact security/catalog parity required" });
  }
  for (const relation of DERIVED_RELATIONS) {
    const sourceRows = snapshot.rows.get(relation) ?? []; const columns = sourceRows.length ? Object.keys(sourceRows[0]).sort() : (RELATION_ORDER_COLUMNS[relation] ?? ["id"]); const target = await targetRows(client, relation, columns);
    assert.equal(target.length, sourceRows.length, `TARGET_VIEW_ROW_COUNT_MISMATCH:${relation}`); assert.equal(canonicalRowsHash(target), canonicalRowsHash(sourceRows), `TARGET_VIEW_HASH_MISMATCH:${relation}`);
    sourceTables.push({ name: relation, rows: sourceRows.length, canonicalDataSha256: canonicalRowsHash(sourceRows) }); targetTables.push({ name: relation, rows: target.length, canonicalDataSha256: canonicalRowsHash(target) });
  }
  const invalidForeignKeys = Number((await client.query("select count(*)::int as count from pg_constraint where contype='f' and not convalidated")).rows[0].count); assert.equal(invalidForeignKeys, 0, "TARGET_INVALID_FOREIGN_KEYS");
  const memberships = snapshot.rows.get("department_memberships") ?? [];
  return importEvidence({ mappings: preflight.mappings.map(({ relation, mapping }) => ({ relation, mapping })), sourceTables, targetTables, featureCatalog: preflight.featureCatalog, identities: { count: snapshot.users.length, canonicalDataSha256: canonicalRowsHash(snapshot.users) }, memberships: { count: memberships.length, canonicalDataSha256: canonicalRowsHash(memberships) } });
}
async function runDatabase() {
  const rawTarget = process.env.TARGET_DATABASE_SECRET_JSON; delete process.env.TARGET_DATABASE_SECRET_JSON; assert.ok(rawTarget, "Target migrator secret was not injected");
  const target = validateTargetSecret(JSON.parse(rawTarget)); const ca = await readFile("/app/rds-ca.pem", "utf8"); const client = new pg.Client({ ...target, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 15_000, statement_timeout: 60_000, application_name: "tracepoint-rest-initial-import" });
  let phase = "source snapshot";
  try { const snapshot = await sourceSnapshot(); phase = "target TLS preflight"; await client.connect(); const preflight = await preflightTarget(client, snapshot); phase = "identity anchors"; await insertIdentityAnchors(client, snapshot.users); phase = "relational import"; const results = []; for (const relation of preflight.order) results.push(await importRelation(client, relation, snapshot.rows.get(relation) ?? [], preflight.mappings.find(item => item.relation === relation), preflight.targetBefore.get(relation) > 0)); phase = "target sequence repair"; await repairSequences(client); phase = "target reconciliation"; const evidence = await verifyDatabase(client, snapshot, preflight); console.log(JSON.stringify({ status: "PASSED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mode, sourceReadOnly: true, targetWriteScope: "approved-initial-import", importedRelations: results, evidence, targetClientsInitialized: true, cognitoClientsInitialized: false })); }
  catch (error) { console.error(JSON.stringify(safeError(error, phase))); process.exitCode = 1; } finally { await client.end().catch(() => undefined); }
}
async function runFeatureCatalogReconciliation() {
  const rawTarget = process.env.TARGET_DATABASE_SECRET_JSON; delete process.env.TARGET_DATABASE_SECRET_JSON; assert.ok(rawTarget, "Target migrator secret was not injected");
  const target = validateTargetSecret(JSON.parse(rawTarget)); const ca = await readFile("/app/rds-ca.pem", "utf8");
  const client = new pg.Client({ ...target, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 15_000, statement_timeout: 60_000, application_name: "tracepoint-feature-catalog-reconciliation" });
  let phase = "source feature_catalog read";
  try {
    const sourceRows = await allRelationRows(fetch, headers, "feature_catalog");
    phase = "target read-only transaction"; await client.connect();
    await client.query("begin transaction isolation level repeatable read read only");
    const columns = (await queryColumns(client, "feature_catalog")).map(column => column.column_name);
    const targetRows = await targetRowsForReconciliation(client, columns);
    await client.query("commit");
    const reconciliation = reconcileFeatureCatalog(sourceRows, targetRows, columns);
    console.log(JSON.stringify({ status: "PASSED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mode, sourceReadOnly: true, targetReadOnly: true, sourceClientsInitialized: true, targetClientsInitialized: true, targetWriteClientsInitialized: false, targetTransaction: { isolation: "repeatable read", readOnly: true }, reconciliation }));
  } catch (error) { await client.query("rollback").catch(() => undefined); console.error(JSON.stringify(safeError(error, phase))); process.exitCode = 1; }
  finally { await client.end().catch(() => undefined); }
}
async function runRolePermissionsReconciliation() {
  const rawTarget = process.env.TARGET_DATABASE_SECRET_JSON; delete process.env.TARGET_DATABASE_SECRET_JSON; assert.ok(rawTarget, "Target migrator secret was not injected");
  const target = validateTargetSecret(JSON.parse(rawTarget)); const ca = await readFile("/app/rds-ca.pem", "utf8");
  const client = new pg.Client({ ...target, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 15_000, statement_timeout: 60_000, application_name: "tracepoint-role-permissions-reconciliation" });
  let phase = "source role_permissions read";
  try {
    const [sourceRows, sourceRoles, sourcePermissions] = await Promise.all([allRelationRows(fetch, headers, "role_permissions"), allRelationRows(fetch, headers, "roles"), allRelationRows(fetch, headers, "permissions")]);
    phase = "target role_permissions read-only transaction"; await client.connect(); await client.query("begin transaction isolation level repeatable read read only");
    const targetRows = await targetRowsForRelation(client, "role_permissions", ["role_code", "permission_code"]);
    const targetRoles = await targetRowsForRelation(client, "roles", ["code"]), targetPermissions = await targetRowsForRelation(client, "permissions", ["code"]);
    await client.query("commit");
    const reconciliation = reconcileRolePermissionDifferences(sourceRows, targetRows);
    const known = { sourceRoles: new Set(sourceRoles.map(row => row.code)), sourcePermissions: new Set(sourcePermissions.map(row => row.code)), targetRoles: new Set(targetRoles.map(row => row.code)), targetPermissions: new Set(targetPermissions.map(row => row.code)) };
    const annotate = row => ({ ...row, sourceRoleKnown: known.sourceRoles.has(row.roleCode), sourcePermissionKnown: known.sourcePermissions.has(row.permissionCode), targetRoleKnown: known.targetRoles.has(row.roleCode), targetPermissionKnown: known.targetPermissions.has(row.permissionCode) });
    console.log(JSON.stringify({ status: reconciliation.stableKeyParity ? "PASSED" : "BLOCKED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mode, sourceReadOnly: true, targetReadOnly: true, sourceClientsInitialized: true, targetClientsInitialized: true, targetWriteClientsInitialized: false, targetTransaction: { isolation: "repeatable read", readOnly: true }, reconciliation: { ...reconciliation, sourceOnly: reconciliation.sourceOnly.map(annotate), targetOnly: reconciliation.targetOnly.map(annotate) }, provenance: "supabase/migrations/202606220001_tracepoint_foundation.sql plus subsequent permission-matrix migrations" }));
  } catch (error) { await client.query("rollback").catch(() => undefined); console.error(JSON.stringify(safeError(error, phase))); process.exitCode = 1; }
  finally { await client.end().catch(() => undefined); }
}
async function targetRowsForReconciliation(client, columns) { return (await client.query(targetRowsSql("feature_catalog", columns, ["code"]))).rows.map(item => item.row); }
const TARGET_SEEDED_STABLE_COLUMNS = Object.freeze({ roles: ["code"], permissions: ["code"], role_permissions: ["role_code", "permission_code"] });
async function targetRowsForRelation(client, relation, columns) { return (await client.query(targetRowsSql(relation, columns, RELATION_ORDER_COLUMNS[relation] ?? ["id"]))).rows.map(item => item.row); }
async function reconcileTargetSeededReferences(client, snapshot) {
  const results = new Map();
  for (const relation of TARGET_SEEDED_REFERENCE_RELATIONS) {
    const columns = (await queryColumns(client, relation)).map(column => column.column_name), sourceRows = snapshot.rows.get(relation) ?? [], targetRows = await targetRowsForRelation(client, relation, columns);
    if (relation === "feature_catalog") {
      const reconciliation = requireTargetSeededFeatureCatalogParity(reconcileFeatureCatalog(sourceRows, targetRows, columns));
      results.set(relation, { ...reconciliation, targetCanonicalSha256: reconciliation.targetCanonicalSha256 });
    } else if (relation === "role_permissions") results.set(relation, requireTargetSeededRolePermissionRule(reconcileRolePermissionDifferences(sourceRows, targetRows)));
    else results.set(relation, requireExactTargetSeededParity(reconcileExactTargetSeededRelation(relation, sourceRows, targetRows, TARGET_SEEDED_STABLE_COLUMNS[relation])));
  }
  return results;
}
function relationScope(columns) { return columns.includes("department_id") ? "tenant-scoped" : "global"; }
function relationProvenance(relation) {
  if (relation === "feature_catalog") return "target bootstrap catalog; reviewed target-owned reference rule";
  if (["roles", "permissions", "role_permissions"].includes(relation)) return "supabase/migrations/202606220001_tracepoint_foundation.sql plus subsequent permission-matrix migrations";
  return "none";
}
function securitySensitive(relation) { return relation === "roles" || relation === "permissions" || relation === "role_permissions" || relation === "department_role_permissions" || relation === "department_membership_roles"; }
async function runTargetDataPreflight() {
  const rawTarget = process.env.TARGET_DATABASE_SECRET_JSON; delete process.env.TARGET_DATABASE_SECRET_JSON; assert.ok(rawTarget, "Target migrator secret was not injected");
  const target = validateTargetSecret(JSON.parse(rawTarget)); const ca = await readFile("/app/rds-ca.pem", "utf8");
  const client = new pg.Client({ ...target, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 15_000, statement_timeout: 60_000, application_name: "tracepoint-target-data-preflight" });
  let phase = "canonical REST source snapshot";
  try {
    const snapshot = await sourceSnapshot(); phase = "target repeatable-read data preflight"; await client.connect(); await client.query("begin transaction isolation level repeatable read read only");
    const kinds = await targetRelationKinds(client), nonempty = [];
    for (const relation of MIGRATION_RELATIONS) {
      const expectedKind = DERIVED_RELATIONS.includes(relation) ? "v" : "r"; if (targetKindForRelation(kinds, relation) !== expectedKind) continue;
      const targetColumns = (await queryColumns(client, relation)).map(column => column.column_name), targetRows = await targetRowsForRelation(client, relation, targetColumns); if (!targetRows.length) continue;
      const sourceRows = snapshot.rows.get(relation) ?? [], stableColumns = RELATION_ORDER_COLUMNS[relation] ?? ["id"], sourceKeys = sourceRows.map(row => stableColumns.map(column => row[column])), targetKeys = targetRows.map(row => stableColumns.map(column => row[column]));
      let classification = "UNKNOWN", authorizationSemanticParity = null;
      if (relation === "feature_catalog") { const value = reconcileFeatureCatalog(sourceRows, targetRows, targetColumns); classification = value.hasInvariantFailure ? "UNKNOWN" : "TARGET_SEEDED_EXCLUDED"; }
      else if (relation === "role_permissions") { const value = requireTargetSeededRolePermissionRule(reconcileRolePermissionDifferences(sourceRows, targetRows)); authorizationSemanticParity = true; classification = "TARGET_SEEDED_EXCLUDED"; }
      else if (["roles", "permissions"].includes(relation)) { const value = reconcileExactTargetSeededRelation(relation, sourceRows, targetRows, TARGET_SEEDED_STABLE_COLUMNS[relation]); authorizationSemanticParity = value.canonicalParity; classification = value.stableKeyParity && value.canonicalParity ? "TARGET_SEEDED_PARITY_REQUIRED" : "UNKNOWN"; }
      else if (canonicalRowsHash(sourceRows) === canonicalRowsHash(targetRows)) classification = "TARGET_SYSTEM_INTERNAL";
      else if (relationScope(sourceColumns(sourceRows)) === "tenant-scoped") classification = "CUSTOMER_DATA_CONFLICT";
      nonempty.push({ relation, classification, sourceCount: sourceRows.length, targetCount: targetRows.length, stableColumns, sourceStableKeySha256: sha256(sourceKeys), targetStableKeySha256: sha256(targetKeys), stableKeyParity: canonical(sourceKeys) === canonical(targetKeys), sourceCanonicalSha256: canonicalRowsHash(sourceRows), targetCanonicalSha256: canonicalRowsHash(targetRows), scope: relationScope(sourceColumns(sourceRows)), provenance: relationProvenance(relation), securitySensitive: securitySensitive(relation), authorizationSemanticParity });
    }
    await client.query("commit"); const blockers = nonempty.filter(item => !["TARGET_SEEDED_EXCLUDED", "TARGET_SEEDED_PARITY_REQUIRED", "TARGET_SYSTEM_INTERNAL"].includes(item.classification));
    console.log(JSON.stringify({ status: blockers.length ? "BLOCKED" : "PASSED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mode, sourceReadOnly: true, targetReadOnly: true, targetTransaction: { isolation: "repeatable read", readOnly: true }, nonempty, blockers, targetWriteClientsInitialized: false }));
  } catch (error) { await client.query("rollback").catch(() => undefined); console.error(JSON.stringify(safeError(error, phase))); process.exitCode = 1; }
  finally { await client.end().catch(() => undefined); }
}
async function querySchemaContract(client, relation) {
  const columns = await client.query("select column_name,data_type,udt_name,is_nullable,column_default,(is_identity='YES') as is_identity from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position", [relation]);
  const primary = await client.query("select a.attname as column_name from pg_index i join pg_class t on t.oid=i.indrelid join pg_namespace n on n.oid=t.relnamespace join unnest(i.indkey) with ordinality as k(attnum,position) on true join pg_attribute a on a.attrelid=t.oid and a.attnum=k.attnum where i.indisprimary and n.nspname='public' and t.relname=$1 order by k.position", [relation]);
  const foreign = await client.query("select a.attname as column_name,rn.nspname||'.'||rt.relname as referenced_table,ra.attname as referenced_column from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace join pg_class rt on rt.oid=c.confrelid join pg_namespace rn on rn.oid=rt.relnamespace join unnest(c.conkey) with ordinality as ck(attnum,position) on true join unnest(c.confkey) with ordinality as fk(attnum,position) on fk.position=ck.position join pg_attribute a on a.attrelid=t.oid and a.attnum=ck.attnum join pg_attribute ra on ra.attrelid=rt.oid and ra.attnum=fk.attnum where c.contype='f' and n.nspname='public' and t.relname=$1 order by a.attname,rn.nspname,rt.relname,ra.attname", [relation]);
  const primaryColumns = new Set(primary.rows.map(row => row.column_name)); const foreignByColumn = new Map();
  for (const row of foreign.rows) foreignByColumn.set(row.column_name, [...(foreignByColumn.get(row.column_name) ?? []), { table: row.referenced_table, column: row.referenced_column }]);
  return columns.rows.map(column => ({ ...column, primaryKey: primaryColumns.has(column.column_name), foreignKeys: foreignByColumn.get(column.column_name) ?? [] }));
}
async function targetSchemaRepairPreflight(client) {
  const column = await client.query("select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2", [FIREARM_ASSIGNMENTS_SCHEMA_REPAIR.relation, FIREARM_ASSIGNMENTS_SCHEMA_REPAIR.column]);
  const constraint = await client.query("select 1 from pg_constraint where conrelid='public.firearm_assignments'::regclass and conname=$1", [FIREARM_ASSIGNMENTS_SCHEMA_REPAIR.constraint]);
  return { columnExists: column.rowCount > 0, constraintExists: constraint.rowCount > 0 };
}
async function runFirearmAssignmentsSchemaRepair() {
  const rawTarget = process.env.TARGET_DATABASE_SECRET_JSON; delete process.env.TARGET_DATABASE_SECRET_JSON; assert.ok(rawTarget, "Target migrator secret was not injected");
  const target = validateTargetSecret(JSON.parse(rawTarget)); const ca = await readFile("/app/rds-ca.pem", "utf8");
  const client = new pg.Client({ ...target, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 15_000, statement_timeout: 60_000, application_name: "tracepoint-firearm-assignments-schema-repair" });
  let phase = "schema repair preflight";
  try {
    await client.connect(); const before = await targetSchemaRepairPreflight(client);
    assert.equal(before.columnExists, false, "SCHEMA_REPAIR_COLUMN_ALREADY_EXISTS"); assert.equal(before.constraintExists, false, "SCHEMA_REPAIR_CONSTRAINT_ALREADY_EXISTS");
    phase = "approved schema repair"; await client.query("begin");
    try { for (const statement of FIREARM_ASSIGNMENTS_SCHEMA_REPAIR.statements) await client.query(statement); await client.query("commit"); }
    catch (error) { await client.query("rollback"); throw error; }
    phase = "schema repair verification"; const after = await targetSchemaRepairPreflight(client);
    assert.equal(after.columnExists, true, "SCHEMA_REPAIR_COLUMN_MISSING_AFTER_APPLY"); assert.equal(after.constraintExists, true, "SCHEMA_REPAIR_CONSTRAINT_MISSING_AFTER_APPLY");
    console.log(JSON.stringify({ status: "PASSED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mode, target: { host: target.host, database: target.database, tlsVerified: true }, before, after, appliedStatements: FIREARM_ASSIGNMENTS_SCHEMA_REPAIR.statements, sourceClientsInitialized: false, targetWriteScope: "approved-firearm-assignments-schema-repair", targetRowsPopulated: false, checkConstraintValidated: false }));
  } catch (error) { console.error(JSON.stringify(safeError(error, phase))); process.exitCode = 1; }
  finally { await client.end().catch(() => undefined); }
}
function targetKindForRelation(kinds, relation) { return kinds.get(relation) ?? null; }
async function runFullSchemaContractSweep() {
  const rawTarget = process.env.TARGET_DATABASE_SECRET_JSON; delete process.env.TARGET_DATABASE_SECRET_JSON; assert.ok(rawTarget, "Target migrator secret was not injected");
  const target = validateTargetSecret(JSON.parse(rawTarget)); const ca = await readFile("/app/rds-ca.pem", "utf8");
  const client = new pg.Client({ ...target, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 15_000, statement_timeout: 60_000, application_name: "tracepoint-full-schema-contract-sweep" });
  let phase = "canonical REST source contract";
  try {
    const snapshot = await sourceSnapshot(); phase = "target repeatable-read schema contract"; await client.connect(); await client.query("begin transaction isolation level repeatable read read only");
    const kinds = await targetRelationKinds(client), relations = [], blockers = [];
    for (const relation of MIGRATION_RELATIONS) {
      const sourceRows = snapshot.rows.get(relation) ?? [], source = sourceColumns(sourceRows), targetKind = targetKindForRelation(kinds, relation);
      const expectedKind = DERIVED_RELATIONS.includes(relation) ? "v" : "r";
      if (targetKind !== expectedKind) { const item={ relation, classification:"UNKNOWN_CONFLICT", expectedKind, targetKind, sourceColumns: source, targetColumns: [] }; relations.push(item); blockers.push(item); continue; }
      const targetColumns = await querySchemaContract(client, relation), targetNames = new Set(targetColumns.map(column => column.column_name));
      // PostgREST cannot reveal a typed source projection for an empty relation.
      // It is safe to defer this shape check: no row can be imported now, and the
      // final-delta sweep repeats this contract after the controlled write freeze.
      if (sourceRows.length === 0) { relations.push({ relation, classification: "EXACT_MATCH", expectedKind, targetKind, sourceColumns: [], targetColumns, sourceSchemaEvidence: "empty-relation-rest-schema-unobservable" }); continue; }
      if (relation === "feature_catalog") {
        const feature = requireTargetSeededFeatureCatalogParity(reconcileFeatureCatalog(sourceRows, await targetRowsForReconciliation(client, targetColumns.map(column => column.column_name)), targetColumns.map(column => column.column_name)));
        relations.push({ relation, classification: "TARGET_SEEDED_EXCLUDED", expectedKind, targetKind, sourceColumns: source, targetColumns, featureCatalog: { sourceCount: feature.sourceCount, targetCount: feature.targetCount, codeSetParity: !feature.hasSourceOnlyRows && !feature.hasTargetOnlyRows, activeStateParity: !feature.hasActiveStateMismatch } }); continue;
      }
      const sourceOnly = source.filter(column => !targetNames.has(column)).map(column => ({ sourceColumn: column, classification: classifySourceOnlyColumn(relation, column, summarizeSourceColumn(sourceRows, column)), statistics: summarizeSourceColumn(sourceRows, column) }));
      const targetOnly = targetColumns.filter(column => !source.includes(column.column_name)).map(column => ({ targetColumn: column.column_name, classification: classifyTargetOnlyColumn(column), dataType: column.data_type, nullable: column.is_nullable, default: column.column_default, primaryKey: column.primaryKey, foreignKeys: column.foreignKeys }));
      const classifications = [...sourceOnly, ...targetOnly].map(item => item.classification);
      const classification = classifications.length === 0 ? "EXACT_MATCH" : classifications.includes("TARGET_SCHEMA_MISSING_COLUMN") ? "TARGET_SCHEMA_MISSING_COLUMN" : classifications.includes("UNKNOWN_CONFLICT") || classifications.includes("REQUIRED_IMPORT_VALUE") ? "UNKNOWN_CONFLICT" : classifications.every(value => value === "TARGET_ONLY_DEFAULTED") ? "TARGET_ONLY_DEFAULTED" : "TRANSFORM_REQUIRED";
      const item = { relation, classification, expectedKind, targetKind, sourceColumns: source, sourceColumnStatistics: source.map(column => summarizeSourceColumn(sourceRows, column)), targetColumns, sourceOnly, targetOnly };
      relations.push(item); if (classification !== "EXACT_MATCH" && classification !== "TARGET_ONLY_DEFAULTED") blockers.push(item);
    }
    await client.query("commit");
    console.log(JSON.stringify({ status: blockers.length ? "BLOCKED" : "PASSED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mode, sourceReadOnly: true, targetReadOnly: true, targetTransaction: { isolation: "repeatable read", readOnly: true }, source: { totalRelationalRows: [...snapshot.rows.values()].reduce((sum, rows) => sum + rows.length, 0), identities: snapshot.users.length, memberships: (snapshot.rows.get("department_memberships") ?? []).length }, relations, blockers, targetClientsInitialized: true, targetWriteClientsInitialized: false }));
  } catch (error) { await client.query("rollback").catch(() => undefined); console.error(JSON.stringify(safeError(error, phase))); process.exitCode = 1; }
  finally { await client.end().catch(() => undefined); }
}
async function runFirearmAssignmentsSchemaContract() {
  const rawTarget = process.env.TARGET_DATABASE_SECRET_JSON; delete process.env.TARGET_DATABASE_SECRET_JSON; assert.ok(rawTarget, "Target migrator secret was not injected");
  const target = validateTargetSecret(JSON.parse(rawTarget)); const ca = await readFile("/app/rds-ca.pem", "utf8");
  const client = new pg.Client({ ...target, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 15_000, statement_timeout: 60_000, application_name: "tracepoint-firearm-assignments-schema-contract" });
  let phase = "source firearm_assignments contract";
  try {
    const sourceRows = await allRelationRows(fetch, headers, "firearm_assignments"); const source = sourceColumns(sourceRows);
    phase = "target read-only schema transaction"; await client.connect(); await client.query("begin transaction isolation level repeatable read read only");
    const targetColumns = await querySchemaContract(client, "firearm_assignments"); await client.query("commit");
    const targetNames = new Set(targetColumns.map(column => column.column_name)), sourceNames = new Set(source);
    const expectedReturnComparison = sourceNames.has("magazines_expected_return") && sourceNames.has("magazines_issued") ? compareSourceColumns(sourceRows, "magazines_expected_return", "magazines_issued") : null;
    const sourceOnly = source.filter(column => !targetNames.has(column)).map(column => ({ sourceColumn: column, classification: column === "magazines_expected_return" && expectedReturnComparison?.unequalRowCount === 0 ? "MAP_TO_EXISTING_TARGET_COLUMN" : "UNKNOWN_CONFLICT", targetEquivalent: column === "magazines_expected_return" && expectedReturnComparison?.unequalRowCount === 0 ? "magazines_issued" : null, statistics: summarizeSourceColumn(sourceRows, column) }));
    const targetOnly = targetColumns.filter(column => !sourceNames.has(column.column_name)).map(column => ({ ...column, classification: classifyTargetOnlyColumn(column) }));
    console.log(JSON.stringify({ status: "PASSED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mode, sourceReadOnly: true, targetReadOnly: true, targetTransaction: { isolation: "repeatable read", readOnly: true }, relation: "firearm_assignments", sourceContract: { columns: source, statistics: source.map(column => summarizeSourceColumn(sourceRows, column)) }, targetContract: { columns: targetColumns }, sourceOnly, targetOnly, sourceEquivalenceChecks: expectedReturnComparison ? [expectedReturnComparison] : [], commonColumns: source.filter(column => targetNames.has(column)), sourceCanonicalSha256: canonicalRowsHash(sourceRows), targetClientsInitialized: true, targetWriteClientsInitialized: false }));
  } catch (error) { await client.query("rollback").catch(() => undefined); console.error(JSON.stringify(safeError(error, phase))); process.exitCode = 1; }
  finally { await client.end().catch(() => undefined); }
}
function assertSourceObjectUrl(url, object) { const parsed = new URL(url); assert.equal(parsed.origin, PROJECT_URL); assert.equal(parsed.protocol, "https:"); assert.equal(parsed.pathname, `/storage/v1/object/${object.sourceBucket}/${object.sourceKey}`); }
async function fetchObject(object) { const url = sourceObjectUrl(object); assertSourceObjectUrl(url, object); const response = await fetch(url, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(30_000) }); if (!response.ok) throw new Error(`SOURCE_OBJECT_GET_FAILED:${response.status}`); const bytes = new Uint8Array(await response.arrayBuffer()); validateObjectBytes(object, bytes); return bytes; }
async function getTargetObject(s3, object) { try { const response = await s3.send(new GetObjectCommand({ Bucket: TARGET_BUCKET, Key: object.destinationKey, ExpectedBucketOwner: TARGET_ACCOUNT, ChecksumMode: "ENABLED" })); const bytes = new Uint8Array(await response.Body.transformToByteArray()); return bytes; } catch (error) { if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null; throw error; } }
async function runObjects() {
  const s3 = new S3Client({ region: "us-east-1", maxAttempts: 3 }); let phase = "object preflight";
  try { const results=[]; for (const object of OBJECT_MANIFEST) { assert.ok(object.destinationKey.startsWith(`department-assets/${object.departmentId}/`), "OBJECT_TENANT_SCOPE_MISMATCH"); let target = await getTargetObject(s3, object); if (target) { validateObjectBytes(object, target); results.push({ keySha256: sha256(object.destinationKey), status: "verified-existing", bytes: object.bytes, sha256: object.sha256 }); continue; } phase = "source object read"; const bytes = await fetchObject(object); phase = "create-only target write"; try { await s3.send(new PutObjectCommand({ Bucket: TARGET_BUCKET, Key: object.destinationKey, ExpectedBucketOwner: TARGET_ACCOUNT, Body: bytes, ContentLength: bytes.byteLength, ContentType: object.contentType, ChecksumSHA256: createHash("sha256").update(bytes).digest("base64"), IfNoneMatch: "*", Metadata: { "tracepoint-department-id": object.departmentId, "tracepoint-domain": "department-patch" } })); } catch (error) { if (error?.name !== "PreconditionFailed" && error?.$metadata?.httpStatusCode !== 412) throw error; } phase = "target object verification"; target = await getTargetObject(s3, object); assert.ok(target, "TARGET_OBJECT_MISSING_AFTER_CREATE"); validateObjectBytes(object, target); results.push({ keySha256: sha256(object.destinationKey), status: "created-and-verified", bytes: object.bytes, sha256: object.sha256 }); } console.log(JSON.stringify({ status: "PASSED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mode, sourceReadOnly: true, objects: results, objectCount: OBJECT_MANIFEST.length, totalBytes: OBJECT_MANIFEST.reduce((total, object) => total + object.bytes, 0), targetBucket: TARGET_BUCKET, targetVersioningRequired: true, targetClientsInitialized: true, databaseClientsInitialized: false })); }
  catch (error) { console.error(JSON.stringify(safeError(error, phase))); process.exitCode = 1; } finally { s3.destroy(); }
}
await (mode === "database" ? runDatabase() : mode === "objects" ? runObjects() : mode === "reconcile" ? runFeatureCatalogReconciliation() : mode === ROLE_PERMISSIONS_RECONCILIATION_MODE ? runRolePermissionsReconciliation() : mode === "schema-contract" ? runFirearmAssignmentsSchemaContract() : mode === SCHEMA_REPAIR_MODE ? runFirearmAssignmentsSchemaRepair() : mode === SCHEMA_SWEEP_MODE ? runFullSchemaContractSweep() : runTargetDataPreflight());
