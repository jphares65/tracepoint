import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { AUTHORIZATION_REFERENCE, MIGRATION_RELATIONS, PROJECT_URL, RELATION_ORDER_COLUMNS, RUN_ID, canonical, sha256 } from "./supabase-rest-ledger-core.mjs";
import { AUDIT_ARTIFACT_CLEANUP_MODE } from "./supabase-rest-import-core.mjs";
import { AUDIT_IDENTITY_COLLISION_DIAGNOSTIC_MODE, COPY_RELATIONS, DERIVED_RELATIONS, FIREARM_ASSIGNMENTS_SCHEMA_REPAIR, FOREIGN_KEY_CYCLE_DIAGNOSIS_MODE, IDENTITY_PRESERVATION_RELATIONS, IMPORT_RELATIONS, NULLABLE_TRAINING_CERTIFICATION_CYCLE, OBJECT_MANIFEST, ROLE_PERMISSIONS_RECONCILIATION_MODE, SCHEMA_REPAIR_MODE, SCHEMA_SWEEP_MODE, TARGET_DATA_PREFLIGHT_MODE, TARGET_GENERATED_COLUMN_DIAGNOSTIC_MODE, TARGET_PROVENANCE_SWEEP_MODE, TARGET_ACCOUNT, TARGET_BUCKET, TARGET_SEEDED_REFERENCE_RELATIONS, allAdminUsers, allRelationRows, assertDiagnosticReadOnlySql, canonicalRowsHash, classifyArtifactResumeRelation, classifySourceOnlyColumn, classifyTargetGeneratedInput, classifyTargetOnlyColumn, compareSourceColumns, executeNullableTrainingCertificationCycle, foreignKeyCycles, identityPreservingInsertSql, importEvidence, insertSql, nullableTrainingCertificationCyclePlan, reconcileExactTargetSeededRelation, reconcileFeatureCatalog, reconcileRolePermissionDifferences, requireExactTargetSeededParity, requireIdentityPreservationPreflight, requireMigrationAnchorProfileParity, requireTargetSeededFeatureCatalogParity, requireTargetSeededRolePermissionRule, sourceColumns, sourceHeaders, sourceObjectUrl, summarizeSourceColumn, targetRowsSql, topologicalImportOrder, updateByIdSql, validateColumnMapping, validateImportInvocation, validateObjectBytes, validateTargetSecret, verifyIdentitySequenceAdvance } from "./supabase-rest-import-core.mjs";

const mode = process.env.TRACEPOINT_REST_IMPORT_MODE;
assert.ok(mode === "database" || mode === "objects" || mode === "reconcile" || mode === "schema-contract" || mode === SCHEMA_REPAIR_MODE || mode === SCHEMA_SWEEP_MODE || mode === TARGET_DATA_PREFLIGHT_MODE || mode === ROLE_PERMISSIONS_RECONCILIATION_MODE || mode === FOREIGN_KEY_CYCLE_DIAGNOSIS_MODE || mode === TARGET_GENERATED_COLUMN_DIAGNOSTIC_MODE || mode === TARGET_PROVENANCE_SWEEP_MODE || mode === AUDIT_IDENTITY_COLLISION_DIAGNOSTIC_MODE || mode === AUDIT_ARTIFACT_CLEANUP_MODE, "A reviewed migration mode is required");
validateImportInvocation(process.env, mode);
const rawSource = process.env.SOURCE_SUPABASE_REST_SECRET_JSON;
delete process.env.SOURCE_SUPABASE_REST_SECRET_JSON;
assert.ok(rawSource, "Dedicated source REST secret was not injected");
const headers = sourceHeaders(JSON.parse(rawSource));
function targetClient(target, ca, application_name) { return new pg.Client({ ...target, host: process.env.TARGET_PGHOST, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 15_000, statement_timeout: 60_000, application_name }); }

function safeError(error, phase) { const message=error instanceof Error?error.message:""; const detail=/^[A-Z_]+(?::[a-z0-9_]+)?$/.test(message)?message:undefined; return { status: "FAILED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mode, phase, errorName: error instanceof Error ? error.name : "Error", errorCode: typeof error === "object" && error && "code" in error ? String(error.code) : undefined, detail, ...(typeof error === "object" && error && "safeDiagnostic" in error ? { diagnostic: error.safeDiagnostic } : {}) }; }
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
async function queryTargetGenerationColumns(query, relation) {
  const sql = "select c.column_name,c.data_type,c.udt_name,c.is_nullable,c.is_identity,c.identity_generation,c.is_generated,c.generation_expression,c.column_default,pg_get_serial_sequence(format('%I.%I',c.table_schema,c.table_name),c.column_name) as sequence_name from information_schema.columns c where c.table_schema='public' and c.table_name=$1 order by c.ordinal_position";
  return (await query(sql, [relation])).rows;
}
async function queryTargetTriggers(query, relations) {
  const sql = "select rel.relname as relation,t.tgname as trigger_name,fnn.nspname as function_schema,fn.proname as function_name,pg_get_functiondef(t.tgfoid) as function_definition from pg_trigger t join pg_class rel on rel.oid=t.tgrelid join pg_namespace ns on ns.oid=rel.relnamespace join pg_proc fn on fn.oid=t.tgfoid join pg_namespace fnn on fnn.oid=fn.pronamespace where ns.nspname='public' and rel.relname=any($1::text[]) and not t.tgisinternal and t.tgenabled <> 'D' order by rel.relname,t.tgname";
  return (await query(sql, [relations])).rows;
}
function triggerAssignments(triggers) {
  const assignments = new Map();
  for (const trigger of triggers) {
    const columns = new Set();
    for (const match of String(trigger.function_definition ?? "").matchAll(/new\.([a-z][a-z0-9_]*)\s*(?::=|=)/giu)) columns.add(match[1].toLowerCase());
    for (const column of columns) {
      const key = `${trigger.relation}\u0000${column}`;
      const names = assignments.get(key) ?? [];
      names.push(`${trigger.function_schema}.${trigger.function_name}:${trigger.trigger_name}`);
      assignments.set(key, names);
    }
  }
  return assignments;
}
function generatedColumnRepositoryProvenance(relation, column, triggerNames) {
  if (relation === "profiles" && ["created_at", "updated_at"].includes(column) && triggerNames.length) return "supabase/migrations/202606220001_tracepoint_foundation.sql: public.handle_new_auth_user and public.profiles_set_updated_at; reviewed migration-anchor exception";
  if (triggerNames.length) return "target PostgreSQL catalog trigger metadata; no reviewed importer exclusion";
  return "target PostgreSQL catalog metadata; no reviewed importer exclusion";
}
function safeGenerationConflict(conflict, provenance) {
  return { relation: conflict.relation, column: conflict.column, targetType: conflict.targetType, targetGeneration: conflict.targetGeneration, sourcePresence: conflict.sourceStatistics, repositoryProvenance: provenance, classification: conflict.classification, acceptsExplicitSourceValue: conflict.acceptsExplicitSourceValue };
}
async function targetRelationKinds(client) { return new Map((await client.query("select c.relname as name,c.relkind as kind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])", [MIGRATION_RELATIONS])).rows.map(row => [row.name, row.kind])); }
async function targetForeignKeys(client) { return (await client.query("select child.relname as child,parent.relname as parent from pg_constraint fk join pg_class child on child.oid=fk.conrelid join pg_namespace cn on cn.oid=child.relnamespace join pg_class parent on parent.oid=fk.confrelid join pg_namespace pn on pn.oid=parent.relnamespace where fk.contype='f' and cn.nspname='public' and pn.nspname='public'")).rows; }
async function profilesAreMigrationAnchors(client, sourceProfiles, targetProfiles) {
  if (!targetProfiles.length) return false;
  const sourceIds = new Set(sourceProfiles.map(row => String(row.id))), targetIds = new Set(targetProfiles.map(row => String(row.id)));
  if (sourceIds.size !== sourceProfiles.length || targetIds.size !== targetProfiles.length || sourceIds.size !== targetIds.size || [...sourceIds].some(id => !targetIds.has(id))) return false;
  const anchors = (await client.query("select id::text as id,raw_user_meta_data->>'identity_provider' as identity_provider from auth.users")).rows;
  return anchors.length === sourceProfiles.length && anchors.every(row => sourceIds.has(row.id) && row.identity_provider === "migration_anchor");
}
async function runForeignKeyCycleDiagnosis(){const rawTarget=process.env.TARGET_DATABASE_SECRET_JSON;delete process.env.TARGET_DATABASE_SECRET_JSON;const target=validateTargetSecret(JSON.parse(rawTarget)),ca=await readFile('/app/rds-ca.pem','utf8'),client=targetClient(target,ca,'tracepoint-fk-cycle-diagnosis');try{await client.connect();await client.query('begin transaction isolation level repeatable read read only');const keys=(await client.query("select c.conname as constraint_name,child.relname as child,parent.relname as parent,ca.attname as child_column,pa.attname as parent_column,ca.attnotnull as child_not_null,c.condeferrable,c.condeferred,c.confdeltype,c.confupdtype from pg_constraint c join pg_class child on child.oid=c.conrelid join pg_namespace n on n.oid=child.relnamespace join pg_class parent on parent.oid=c.confrelid join unnest(c.conkey) with ordinality ck(attnum,pos) on true join unnest(c.confkey) with ordinality pk(attnum,pos) on pk.pos=ck.pos join pg_attribute ca on ca.attrelid=child.oid and ca.attnum=ck.attnum join pg_attribute pa on pa.attrelid=parent.oid and pa.attnum=pk.attnum where c.contype='f' and n.nspname='public' and child.relname=any($1::text[]) and parent.relname=any($1::text[])",[IMPORT_RELATIONS])).rows;await client.query('commit');console.log(JSON.stringify({status:'PASSED',mode,sourceReadOnly:true,targetReadOnly:true,targetWriteClientsInitialized:false,cycles:foreignKeyCycles(IMPORT_RELATIONS,keys),foreignKeys:keys}));}finally{await client.end().catch(()=>undefined);}}
async function runTargetGeneratedColumnDiagnostic() {
  const rawTarget = process.env.TARGET_DATABASE_SECRET_JSON;
  delete process.env.TARGET_DATABASE_SECRET_JSON;
  assert.ok(rawTarget, "Target migrator secret was not injected");
  const target = validateTargetSecret(JSON.parse(rawTarget));
  const ca = await readFile("/app/rds-ca.pem", "utf8");
  const client = targetClient(target, ca, "tracepoint-target-generated-column-diagnostic");
  let phase = "source contract snapshot";
  try {
    const snapshot = await sourceSnapshot();
    phase = "target read-only transaction";
    await client.connect();
    const query = (sql, values = []) => client.query(assertDiagnosticReadOnlySql(sql), values);
    await query("begin transaction isolation level repeatable read read only");
    const triggers = await queryTargetTriggers(query, MIGRATION_RELATIONS);
    const assignments = triggerAssignments(triggers);
    const relations = [];
    const conflicts = [];
    for (const relation of MIGRATION_RELATIONS) {
      const rows = snapshot.rows.get(relation) ?? [];
      const source = sourceColumns(rows);
      const targetColumns = await queryTargetGenerationColumns(query, relation);
      const targetByName = new Map(targetColumns.map(column => [column.column_name, column]));
      const relationConflicts = [];
      for (const column of source) {
        const targetColumn = targetByName.get(column);
        if (!targetColumn) continue;
        const triggerNames = assignments.get(`${relation}\u0000${column}`) ?? [];
        const assessment = classifyTargetGeneratedInput(relation, summarizeSourceColumn(rows, column), targetColumn, triggerNames);
        const isCandidate = assessment.acceptsExplicitSourceValue === false || assessment.classification === "TARGET_GENERATED_EXCLUDE_FROM_IMPORT";
        if (!isCandidate) continue;
        const sanitized = safeGenerationConflict(assessment, generatedColumnRepositoryProvenance(relation, column, triggerNames));
        relationConflicts.push(sanitized);
        conflicts.push(sanitized);
      }
      relations.push({ relation, sourceColumnCount: source.length, targetColumnCount: targetColumns.length, candidateConflictCount: relationConflicts.length, candidateConflicts: relationConflicts });
    }
    await query("commit");
    const blockers = conflicts.filter(conflict => conflict.classification !== "TARGET_GENERATED_EXCLUDE_FROM_IMPORT");
    console.log(JSON.stringify({ status: blockers.length ? "BLOCKED" : "PASSED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mode, sourceReadOnly: true, targetReadOnly: true, sourceClientsInitialized: true, targetClientsInitialized: true, targetWriteClientsInitialized: false, targetTransaction: { isolation: "repeatable read", readOnly: true }, sourceContract: { totalRelationalRows: [...snapshot.rows.values()].reduce((sum, rows) => sum + rows.length, 0), identities: snapshot.users.length, memberships: (snapshot.rows.get("department_memberships") ?? []).length }, relations, conflicts, blockers, importerCanResumeWithoutSemanticChange: blockers.length === 0 }));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    console.error(JSON.stringify(safeError(error, phase)));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}
async function targetRows(client, relation, columns) { const order = RELATION_ORDER_COLUMNS[relation] ?? ["id"]; return (await client.query(targetRowsSql(relation, columns, order))).rows.map(item => item.row); }
const CLEAN_TARGET_RESTORE_TIME = Date.parse("2026-09-20T09:53:11.000Z");
function hasProvenGeneratedArtifactProvenance(relation, targetRows) {
  if (!targetRows.length || !["department_rules", "department_security_settings"].includes(relation)) return false;
  return targetRows.every(row => typeof row.created_at === "string" && Number.isFinite(Date.parse(row.created_at)) && Date.parse(row.created_at) > CLEAN_TARGET_RESTORE_TIME);
}
async function preflightTarget(client, snapshot) {
  const kinds = await targetRelationKinds(client);
  for (const relation of COPY_RELATIONS) assert.equal(kinds.get(relation), "r", `TARGET_TABLE_MISSING:${relation}`);
  for (const relation of DERIVED_RELATIONS) assert.equal(kinds.get(relation), "v", `TARGET_VIEW_MISSING:${relation}`);
  const mappings = []; const targetBefore = new Map(); const identityPreservation = new Map(); const resumePlan = new Map();
  for (const relation of IMPORT_RELATIONS) {
    const rows = snapshot.rows.get(relation) ?? []; const mapping = validateColumnMapping(relation, rows, await queryColumns(client, relation));
    const existing = await targetRows(client, relation, mapping.sourceColumns);
    if (IDENTITY_PRESERVATION_RELATIONS.includes(relation)) identityPreservation.set(relation, requireIdentityPreservationPreflight(relation, rows, existing, await queryTargetGenerationColumns((sql, values) => client.query(sql, values), relation)));
    if (relation === "profiles" && existing.length) {
      const approvedAnchorProfiles = await profilesAreMigrationAnchors(client, rows, existing);
      if (!approvedAnchorProfiles) throw new Error("TARGET_PROFILES_NOT_MIGRATION_ANCHORS");
      resumePlan.set(relation, { relation, strategy: "preserve-migration-anchor-profiles", targetRowCount: existing.length });
    } else {
      resumePlan.set(relation, classifyArtifactResumeRelation({ relation, sourceRows: rows, targetRows: existing, stableColumns: RELATION_ORDER_COLUMNS[relation] ?? ["id"], generatedArtifactProven: hasProvenGeneratedArtifactProvenance(relation, existing) }));
    }
    mappings.push(mapping); targetBefore.set(relation, existing.length);
  }
  const targetSeeded = await reconcileTargetSeededReferences(client, snapshot);
  const authUsers = Number((await client.query("select count(*)::int as count from auth.users")).rows[0].count);
  if (authUsers !== 0 && authUsers !== snapshot.users.length) throw new Error("TARGET_UNEXPLAINED_IDENTITY_ANCHORS");
  const lineage = Number((await client.query("select count(*)::int as count from tracepoint_migrations.applied_migrations")).rows[0].count);
  assert.equal(lineage, 97, "TARGET_MIGRATION_LINEAGE_MISMATCH");
  const foreignKeys = await targetForeignKeys(client);
  const cyclePlan = nullableTrainingCertificationCyclePlan(IMPORT_RELATIONS, foreignKeys, snapshot.rows);
  return { mappings, targetBefore, resumePlan, identityPreservation, authUsers, targetSeeded, cyclePlan, order: cyclePlan.order };
}
async function cleanupProvenMigrationArtifacts(client, snapshot, preflight) {
  const cleanup = [...preflight.resumePlan.values()].filter(item => item.strategy === "cleanup-and-import-full");
  if (!cleanup.length) return [];
  await client.query("begin");
  try {
    const deleted = [];
    for (const item of cleanup.sort((left, right) => left.relation.localeCompare(right.relation))) {
      const mapping = preflight.mappings.find(value => value.relation === item.relation);
      const existing = await targetRows(client, item.relation, mapping.sourceColumns);
      const current = classifyArtifactResumeRelation({ relation: item.relation, sourceRows: snapshot.rows.get(item.relation) ?? [], targetRows: existing, stableColumns: RELATION_ORDER_COLUMNS[item.relation] ?? ["id"], generatedArtifactProven: hasProvenGeneratedArtifactProvenance(item.relation, existing) });
      assert.equal(current.strategy, "cleanup-and-import-full", `ARTIFACT_CLEANUP_PROVENANCE_CHANGED:${item.relation}`);
      assert.equal(existing.length, item.targetRowCount, `ARTIFACT_CLEANUP_ROW_COUNT_CHANGED:${item.relation}`);
      const result = await client.query(`delete from public.${item.relation}`);
      assert.equal(result.rowCount, item.targetRowCount, `ARTIFACT_CLEANUP_DELETE_COUNT_MISMATCH:${item.relation}`);
      const remaining = Number((await client.query(`select count(*)::int as count from public.${item.relation}`)).rows[0].count);
      assert.equal(remaining, 0, `ARTIFACT_CLEANUP_REMAINING_ROWS:${item.relation}`);
      deleted.push({ relation: item.relation, classification: item.classification, deleted: result.rowCount });
    }
    await client.query("commit"); return deleted;
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
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
async function hydrateMigrationAnchorProfiles(client, snapshot, preflight) {
  const relation = "profiles", sourceRows = snapshot.rows.get(relation) ?? [];
  const mapping = preflight.mappings.find(item => item.relation === relation);
  const targetRowsBefore = await targetRows(client, relation, mapping.sourceColumns);
  if (!targetRowsBefore.length) return { relation, imported: 0, resumed: 0, strategy: "no-anchor-profile-trigger" };
  assert.equal(await profilesAreMigrationAnchors(client, sourceRows, targetRowsBefore), true, "TARGET_PROFILES_NOT_MIGRATION_ANCHORS");
  const anchorsConfirmed = await profilesAreMigrationAnchors(client, sourceRows, targetRowsBefore);
  if (canonicalRowsHash(targetRowsBefore) === canonicalRowsHash(sourceRows)) return { relation, imported: 0, resumed: sourceRows.length, strategy: "already-hydrated-migration-anchors", reconciliation: requireMigrationAnchorProfileParity(sourceRows, targetRowsBefore, anchorsConfirmed) };
  const sql = updateByIdSql(relation, mapping.sourceColumns);
  await client.query("begin");
  try {
    for (const row of sourceRows) {
      const result = await client.query(sql, [JSON.stringify(row)]);
      assert.equal(result.rowCount, 1, "MIGRATION_ANCHOR_PROFILE_UPDATE_MISMATCH");
    }
    const targetRowsAfter = await targetRows(client, relation, mapping.sourceColumns);
    const reconciliation = requireMigrationAnchorProfileParity(sourceRows, targetRowsAfter, anchorsConfirmed);
    await client.query("commit");
    return { relation, imported: sourceRows.length, resumed: 0, strategy: "hydrate-proven-migration-anchor-profiles", reconciliation };
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
}
async function importRelation(client, relation, rows, mapping, resume) {
  if (resume.strategy === "retain-exact-source-match") return { relation, imported: 0, resumed: rows.length, strategy: resume.strategy };
  assert.ok(["import-full", "cleanup-and-import-full"].includes(resume.strategy), `UNEXPECTED_RESUME_STRATEGY:${relation}`);
  if (!rows.length) return { relation, imported: 0, resumed: 0 };
  const sql = IDENTITY_PRESERVATION_RELATIONS.includes(relation) ? identityPreservingInsertSql(relation, mapping.sourceColumns) : insertSql(relation, mapping.sourceColumns);
  for (let start = 0; start < rows.length; start += 200) {
    await client.query("begin");
    try { for (const row of rows.slice(start, start + 200)) await client.query(sql, [JSON.stringify(row)]); await client.query("commit"); }
    catch (error) {
      await client.query("rollback");
      if (error && typeof error === "object" && error.code === "428C9") {
        const column = /column "([a-z0-9_]+)"/i.exec(String(error.message))?.[1];
        const metadata = column ? (await client.query("select column_name,data_type,udt_name,is_identity,identity_generation,is_generated,generation_expression,column_default from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2", [relation, column])).rows[0] : null;
        const sourceStatistics = column && rows.some(row => Object.hasOwn(row, column)) ? summarizeSourceColumn(rows, column) : null;
        const diagnostic = { relation, column: column ?? null, targetGeneration: metadata ? { dataType: metadata.data_type, udtName: metadata.udt_name, isIdentity: metadata.is_identity, identityGeneration: metadata.identity_generation, isGenerated: metadata.is_generated, generationExpression: metadata.generation_expression, defaultExpression: metadata.column_default } : null, sourceStatistics, repositoryClassification: "requires-source-contract-and-target-catalog-review", classification: "UNKNOWN_CONFLICT" };
        const wrapped = Object.assign(new Error(`TARGET_GENERATED_INPUT_REJECTED:${relation}`), { code: "428C9", safeDiagnostic: diagnostic });
        throw wrapped;
      }
      throw error;
    }
  }
  return { relation, imported: rows.length, resumed: 0 };
}
async function importNullableTrainingCertificationCycle(client, snapshot, preflight) {
  const cycle = preflight.cyclePlan;
  const attendeeMapping = preflight.mappings.find(item => item.relation === cycle.attendees);
  const certificationMapping = preflight.mappings.find(item => item.relation === cycle.certifications);
  assert.equal(preflight.targetBefore.get(cycle.attendees), 0, "CYCLE_TARGET_ATTENDEES_NOT_EMPTY");
  assert.equal(preflight.targetBefore.get(cycle.certifications), 0, "CYCLE_TARGET_CERTIFICATIONS_NOT_EMPTY");
  const insert = async (relation, rows, mapping) => {
    const sql = insertSql(relation, mapping.sourceColumns);
    for (const row of rows) await client.query(sql, [JSON.stringify(row)]);
  };
  const restore = async (relation, column, links) => {
    for (const link of links) {
      if (link.value === null) continue;
      const result = await client.query(`update public.${relation} set ${column}=$1 where id=$2 and department_id=$3`, [link.value, link.id, link.departmentId]);
      assert.equal(result.rowCount, 1, `CYCLE_RESTORE_ROW_MISMATCH:${relation}`);
    }
  };
  const validate = async () => {
    const sourceAttendees = snapshot.rows.get(cycle.attendees) ?? [], sourceCertifications = snapshot.rows.get(cycle.certifications) ?? [];
    const targetAttendees = await targetRows(client, cycle.attendees, attendeeMapping.sourceColumns);
    const targetCertifications = await targetRows(client, cycle.certifications, certificationMapping.sourceColumns);
    assert.equal(targetAttendees.length, sourceAttendees.length, "CYCLE_ATTENDEE_ROW_COUNT_MISMATCH");
    assert.equal(targetCertifications.length, sourceCertifications.length, "CYCLE_CERTIFICATION_ROW_COUNT_MISMATCH");
    assert.equal(canonicalRowsHash(targetAttendees), canonicalRowsHash(sourceAttendees), "CYCLE_ATTENDEE_SOURCE_TARGET_MISMATCH");
    assert.equal(canonicalRowsHash(targetCertifications), canonicalRowsHash(sourceCertifications), "CYCLE_CERTIFICATION_SOURCE_TARGET_MISMATCH");
    const attendeeIntegrity = Number((await client.query("select count(*)::int as count from public.agency_training_attendees a left join public.training_certifications c on c.id=a.certification_id where a.certification_id is not null and (c.id is null or c.department_id is distinct from a.department_id)")).rows[0].count);
    const certificationIntegrity = Number((await client.query("select count(*)::int as count from public.training_certifications c left join public.agency_training_attendees a on a.id=c.source_training_attendee_id where c.source_training_attendee_id is not null and (a.id is null or a.department_id is distinct from c.department_id)")).rows[0].count);
    assert.equal(attendeeIntegrity, 0, "CYCLE_ATTENDEE_FK_OR_TENANT_INTEGRITY_FAILURE");
    assert.equal(certificationIntegrity, 0, "CYCLE_CERTIFICATION_FK_OR_TENANT_INTEGRITY_FAILURE");
  };
  await executeNullableTrainingCertificationCycle(cycle, {
    begin: () => client.query("begin"),
    insertAttendees: rows => insert(cycle.attendees, rows, attendeeMapping),
    insertCertifications: rows => insert(cycle.certifications, rows, certificationMapping),
    restoreAttendees: links => restore(cycle.attendees, cycle.attendeeColumn, links),
    restoreCertifications: links => restore(cycle.certifications, cycle.certificationColumn, links),
    validate,
    commit: () => client.query("commit"),
    rollback: () => client.query("rollback").catch(() => undefined),
  });
  return { relation: `${cycle.attendees}+${cycle.certifications}`, imported: (snapshot.rows.get(cycle.attendees) ?? []).length + (snapshot.rows.get(cycle.certifications) ?? []).length, resumed: 0, strategy: "two-phase-nullable-fk" };
}
async function repairSequences(client) {
  await client.query("do $repair$ declare item record; begin for item in select n.nspname as schemaname,c.relname as tablename,a.attname as columnname from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped and pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),a.attname) is not null loop execute format('select setval(pg_get_serial_sequence(%L,%L),coalesce((select max(%I) from %I.%I),1),true)',item.schemaname||'.'||item.tablename,item.columnname,item.columnname,item.schemaname,item.tablename); end loop; end $repair$");
  const identitySequences = [];
  for (const relation of IDENTITY_PRESERVATION_RELATIONS) {
    const idColumn = (await queryTargetGenerationColumns((sql, values) => client.query(sql, values), relation)).find(column => column.column_name === "id");
    assert.ok(idColumn?.sequence_name && /^public\.[a-z][a-z0-9_]*$/u.test(idColumn.sequence_name), "IDENTITY_SEQUENCE_NAME_INVALID");
    const [, sequence] = idColumn.sequence_name.split(".");
    const maximum = (await client.query(`select max(${"\"id\""})::text as maximum from public.${relation}`)).rows[0].maximum;
    assert.ok(maximum !== null, "IDENTITY_SEQUENCE_MAX_MISSING");
    const state = (await client.query(`select last_value::text as last_value,is_called from public.${sequence}`)).rows[0];
    assert.equal(state.is_called, true, "IDENTITY_SEQUENCE_NOT_CALLED");
    identitySequences.push(verifyIdentitySequenceAdvance(relation, state.last_value, maximum));
  }
  return identitySequences;
}
async function verifyDatabase(client, snapshot, preflight) {
  const sourceTables = []; const targetTables = [];
  for (const relation of IMPORT_RELATIONS) {
    const mapping = preflight.mappings.find(item => item.relation === relation); const sourceRows = snapshot.rows.get(relation) ?? []; const target = await targetRows(client, relation, mapping.sourceColumns);
    assert.equal(target.length, sourceRows.length, `TARGET_ROW_COUNT_MISMATCH:${relation}`);
    const profileAnchors = relation === "profiles" ? await profilesAreMigrationAnchors(client, sourceRows, target) : false;
    const profileReconciliation = relation === "profiles" ? requireMigrationAnchorProfileParity(sourceRows, target, profileAnchors) : null;
    if (!profileReconciliation) assert.equal(canonicalRowsHash(target), canonicalRowsHash(sourceRows), `TARGET_ROW_HASH_MISMATCH:${relation}`);
    sourceTables.push({ name: relation, rows: sourceRows.length, canonicalDataSha256: canonicalRowsHash(sourceRows), ...(profileReconciliation ? { reconciliation: profileReconciliation.classification, sourceTimestampEvidenceSha256: profileReconciliation.sourceCanonicalSha256, semanticCanonicalSha256: profileReconciliation.semanticCanonicalSha256 } : {}) }); targetTables.push({ name: relation, rows: target.length, canonicalDataSha256: canonicalRowsHash(target), ...(profileReconciliation ? { reconciliation: profileReconciliation.classification, excludedColumns: profileReconciliation.excludedColumns, semanticCanonicalSha256: profileReconciliation.semanticCanonicalSha256 } : {}) });
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
  const target = validateTargetSecret(JSON.parse(rawTarget)); const ca = await readFile("/app/rds-ca.pem", "utf8"); const client = targetClient(target, ca, "tracepoint-rest-initial-import");
  let phase = "source snapshot";
  try { const snapshot = await sourceSnapshot(); phase = "target TLS preflight"; await client.connect(); const preflight = await preflightTarget(client, snapshot); phase = "proven migration-artifact cleanup"; const cleanup = await cleanupProvenMigrationArtifacts(client, snapshot, preflight); phase = "identity anchors"; await insertIdentityAnchors(client, snapshot.users); phase = "relational import"; const results = []; for (const item of preflight.order) { phase = `relational import:${item}`; if (item === "profiles") results.push(await hydrateMigrationAnchorProfiles(client, snapshot, preflight)); else if (item === NULLABLE_TRAINING_CERTIFICATION_CYCLE.token) results.push(await importNullableTrainingCertificationCycle(client, snapshot, preflight)); else results.push(await importRelation(client, item, snapshot.rows.get(item) ?? [], preflight.mappings.find(mapping => mapping.relation === item), preflight.resumePlan.get(item))); } phase = "target sequence repair"; const identitySequences = await repairSequences(client); phase = "target reconciliation"; const evidence = await verifyDatabase(client, snapshot, preflight); console.log(JSON.stringify({ status: "PASSED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mode, sourceReadOnly: true, targetWriteScope: "approved-initial-import", artifactCleanup: cleanup, importedRelations: results, identityPreservation: [...preflight.identityPreservation.values()], identitySequences, evidence, targetClientsInitialized: true, cognitoClientsInitialized: false })); }
  catch (error) { console.error(JSON.stringify(safeError(error, phase))); process.exitCode = 1; } finally { await client.end().catch(() => undefined); }
}
async function runFeatureCatalogReconciliation() {
  const rawTarget = process.env.TARGET_DATABASE_SECRET_JSON; delete process.env.TARGET_DATABASE_SECRET_JSON; assert.ok(rawTarget, "Target migrator secret was not injected");
  const target = validateTargetSecret(JSON.parse(rawTarget)); const ca = await readFile("/app/rds-ca.pem", "utf8");
  const client = targetClient(target, ca, "tracepoint-feature-catalog-reconciliation");
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
  const client = targetClient(target, ca, "tracepoint-role-permissions-reconciliation");
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
function timestampRange(rows, column) {
  const values = rows.map(row => row[column]).filter(value => typeof value === "string" && Number.isFinite(Date.parse(value))).map(value => new Date(value).toISOString()).sort();
  return values.length ? { populatedCount: values.length, earliest: values[0], latest: values.at(-1) } : null;
}
function targetProvenanceClassification(relation, sourceRows, targetRows, stableColumns) {
  const sourceKeys = new Set(sourceRows.map(row => canonical(stableColumns.map(column => row[column]))));
  const targetKeys = new Set(targetRows.map(row => canonical(stableColumns.map(column => row[column]))));
  const intersectionCount = [...targetKeys].filter(key => sourceKeys.has(key)).length;
  const sourceOnlyCount = [...sourceKeys].filter(key => !targetKeys.has(key)).length;
  const targetOnlyCount = [...targetKeys].filter(key => !sourceKeys.has(key)).length;
  const exact = canonicalRowsHash(sourceRows) === canonicalRowsHash(targetRows);
  let classification = "UNKNOWN", evidence = "No approved bootstrap provenance or source-key relationship explains the target rows.";
  if (TARGET_SEEDED_REFERENCE_RELATIONS.includes(relation)) {
    classification = "BOOTSTRAP_REQUIRED"; evidence = relationProvenance(relation);
  } else if (exact) {
    classification = "MIGRATION_ARTIFACT"; evidence = "Target rows are an exact canonical match of the approved source snapshot and this relation has no target-bootstrap rule.";
  } else if (targetOnlyCount === 0 && intersectionCount > 0) {
    classification = "MIGRATION_ARTIFACT"; evidence = "Every target stable key is present in the approved source snapshot, with no target-only key; this is a partial source subset rather than a target bootstrap set.";
  } else if (intersectionCount > 0) {
    classification = "MIXED_BOOTSTRAP_AND_MIGRATION"; evidence = "Target and source share stable keys but differ canonically or have target-only keys; preserve bootstrap data only after reset bootstrap is reproduced.";
  }
  return { classification, evidence, exactCanonicalParity: exact, sourceStableKeyCount: sourceKeys.size, targetStableKeyCount: targetKeys.size, intersectionStableKeyCount: intersectionCount, sourceOnlyStableKeyCount: sourceOnlyCount, targetOnlyStableKeyCount: targetOnlyCount };
}
async function runTargetProvenanceSweep() {
  const rawTarget = process.env.TARGET_DATABASE_SECRET_JSON; delete process.env.TARGET_DATABASE_SECRET_JSON; assert.ok(rawTarget, "Target migrator secret was not injected");
  const target = validateTargetSecret(JSON.parse(rawTarget)); const ca = await readFile("/app/rds-ca.pem", "utf8");
  const client = targetClient(target, ca, "tracepoint-target-provenance-sweep");
  let phase = "canonical REST source snapshot";
  try {
    const snapshot = await sourceSnapshot(); phase = "target repeatable-read provenance sweep"; await client.connect();
    const readOnlyQuery = (sql, params) => client.query(assertDiagnosticReadOnlySql(sql), params);
    await readOnlyQuery("begin transaction isolation level repeatable read read only");
    const kinds = await targetRelationKinds({ query: readOnlyQuery }), nonempty = [];
    for (const relation of MIGRATION_RELATIONS) {
      const expectedKind = DERIVED_RELATIONS.includes(relation) ? "v" : "r"; if (targetKindForRelation(kinds, relation) !== expectedKind) continue;
      const targetColumns = (await queryColumns({ query: readOnlyQuery }, relation)).map(column => column.column_name);
      const targetRows = await targetRowsForRelation({ query: readOnlyQuery }, relation, targetColumns); if (!targetRows.length) continue;
      const sourceRows = snapshot.rows.get(relation) ?? [], stableColumns = RELATION_ORDER_COLUMNS[relation] ?? ["id"];
      const provenance = targetProvenanceClassification(relation, sourceRows, targetRows, stableColumns);
      nonempty.push({ relation, ...provenance, sourceCount: sourceRows.length, targetCount: targetRows.length, stableColumns, scope: relationScope(sourceColumns(sourceRows)), securitySensitive: securitySensitive(relation), sourceCanonicalSha256: canonicalRowsHash(sourceRows), targetCanonicalSha256: canonicalRowsHash(targetRows), timestamps: { createdAt: timestampRange(targetRows, "created_at"), updatedAt: timestampRange(targetRows, "updated_at") }, repositoryBootstrapProvenance: relationProvenance(relation) });
    }
    await readOnlyQuery("commit");
    console.log(JSON.stringify({ status: nonempty.some(item => item.classification === "UNKNOWN") ? "BLOCKED" : "PASSED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mode, sourceReadOnly: true, targetReadOnly: true, targetTransaction: { isolation: "repeatable read", readOnly: true }, nonempty, targetWriteClientsInitialized: false, targetMutationPathsInitialized: false }));
  } catch (error) { await client.query("rollback").catch(() => undefined); console.error(JSON.stringify(safeError(error, phase))); process.exitCode = 1; }
  finally { await client.end().catch(() => undefined); }
}
async function runTargetDataPreflight() {
  const rawTarget = process.env.TARGET_DATABASE_SECRET_JSON; delete process.env.TARGET_DATABASE_SECRET_JSON; assert.ok(rawTarget, "Target migrator secret was not injected");
  const target = validateTargetSecret(JSON.parse(rawTarget)); const ca = await readFile("/app/rds-ca.pem", "utf8");
  const client = targetClient(target, ca, "tracepoint-target-data-preflight");
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
  const client = targetClient(target, ca, "tracepoint-firearm-assignments-schema-repair");
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
  const client = targetClient(target, ca, "tracepoint-full-schema-contract-sweep");
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
  const client = targetClient(target, ca, "tracepoint-firearm-assignments-schema-contract");
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
function auditIdRange(rows) { const ids=rows.map(row=>BigInt(row.id)); return ids.length?{min:ids.reduce((a,b)=>a<b?a:b).toString(),max:ids.reduce((a,b)=>a>b?a:b).toString()}:null; }
async function auditReferences(client, relation) { return (await client.query("select nr.nspname||'.'||cr.relname as relation,c.conname as constraint_name,a.attname as column_name from pg_constraint c join pg_class ct on ct.oid=c.confrelid join pg_class cr on cr.oid=c.conrelid join pg_namespace nr on nr.oid=cr.relnamespace join unnest(c.conkey) as k(attnum) on true join pg_attribute a on a.attrelid=cr.oid and a.attnum=k.attnum where c.contype='f' and ct.oid=('public.'||$1)::regclass order by 1,2,3",[relation])).rows; }
async function auditIdentityDiagnostic() {
  const rawTarget=process.env.TARGET_DATABASE_SECRET_JSON; delete process.env.TARGET_DATABASE_SECRET_JSON; assert.ok(rawTarget,"Target migrator secret was not injected");
  const target=validateTargetSecret(JSON.parse(rawTarget)),ca=await readFile("/app/rds-ca.pem","utf8"),client=targetClient(target,ca,"tracepoint-audit-identity-collision-diagnostic"); let phase="audit source snapshot";
  try { const snapshot=await sourceSnapshot(); phase="audit target repeatable-read diagnostic"; await client.connect(); await client.query("begin transaction isolation level repeatable read read only"); const results=[];
    for(const relation of IDENTITY_PRESERVATION_RELATIONS) { const source=snapshot.rows.get(relation)??[], columns=(await queryColumns(client,relation)).map(x=>x.column_name), targetRows=await targetRowsForRelation(client,relation,columns), sourceById=new Map(source.map(row=>[String(row.id),row])),targetById=new Map(targetRows.map(row=>[String(row.id),row])), overlap=[...sourceById.keys()].filter(id=>targetById.has(id)), sourceOnly=[...sourceById.keys()].filter(id=>!targetById.has(id)), targetOnly=[...targetById.keys()].filter(id=>!sourceById.has(id)), exact=overlap.filter(id=>canonical(sourceById.get(id))===canonical(targetById.get(id))).length, generation=(await queryTargetGenerationColumns((sql,values)=>client.query(sql,values),relation)).find(x=>x.column_name==='id'), triggers=await queryTargetTriggers((sql,values)=>client.query(sql,values),[relation]), refs=await auditReferences(client,relation), created=timestampRange(targetRows,"created_at"), updated=timestampRange(targetRows,"updated_at"), sequence=generation?.sequence_name?(await client.query(`select last_value::text as last_value,is_called from ${generation.sequence_name}`)).rows[0]:null;
      const targetGenerated=targetOnly.length>0&&exact===overlap.length, classification=targetOnly.length===0&&exact===overlap.length?"MATCHING_ROWS_CAN_BE_DEDUPLICATED":targetGenerated?"TARGET_TABLE_SHOULD_BE_CLEANED_BEFORE_IMPORT":"GENUINE_CONFLICT_REQUIRING_OWNER_DECISION";
      results.push({relation,source:{count:source.length,idRange:auditIdRange(source),canonicalSha256:canonicalRowsHash(source)},target:{count:targetRows.length,idRange:auditIdRange(targetRows),canonicalSha256:canonicalRowsHash(targetRows),createdAtEvidence:created,updatedAtEvidence:updated,createdAfterCleanRestore:"unprovable-from-row-timestamps",predatesCleanSnapshot:"unprovable-from-row-timestamps"},idSets:{overlap:overlap.length,sourceOnly:sourceOnly.length,targetOnly:targetOnly.length},overlapClassification:{exactSemanticMatch:exact,targetGeneratedOperationalRecord:targetGenerated?targetOnly.length:0,sourceAuthoritativeRecord:sourceOnly.length,genuineConflict:overlap.length-exact},identity:{dataType:generation?.data_type,identity:generation?.identity_generation,sequence:generation?.sequence_name,sequenceState:sequence},foreignKeyReferences:refs,externallyMeaningful:"local surrogate bigint; source preservation is required only for migration hash/lineage",triggers:triggers.map(x=>({name:x.trigger_name,function:`${x.function_schema}.${x.function_name}`})),repositoryProvenance:relation==="audit_events"?"database/aws migrations and application audit writers produce operational audit events; no target bootstrap exclusion exists":"supabase/migrations/202609060001_retire_legacy_training_alert_permissions.sql seeds retirement audit history",classification}); }
    await client.query("commit"); console.log(JSON.stringify({status:"PASSED",runId:RUN_ID,authorizationReference:AUTHORIZATION_REFERENCE,mode,sourceReadOnly:true,targetReadOnly:true,targetTransaction:{isolation:"repeatable read",readOnly:true},targetWriteClientsInitialized:false,results}));
  } catch(error) { await client.query("rollback").catch(()=>undefined); console.error(JSON.stringify(safeError(error,phase))); process.exitCode=1; } finally { await client.end().catch(()=>undefined); }
}
async function cleanupAuditArtifacts() {
  const rawTarget=process.env.TARGET_DATABASE_SECRET_JSON; delete process.env.TARGET_DATABASE_SECRET_JSON; assert.ok(rawTarget,"Target migrator secret was not injected");
  const target=validateTargetSecret(JSON.parse(rawTarget)),ca=await readFile("/app/rds-ca.pem","utf8"),client=targetClient(target,ca,"tracepoint-audit-events-artifact-cleanup"); let phase="source audit identity set";
  try { const source=await allRelationRows(fetch,headers,"audit_events"), sourceIds=new Set(source.map(row=>String(row.id))); phase="bounded audit artifact cleanup"; await client.connect(); await client.query("begin");
    const targetRows=await targetRowsForRelation(client,"audit_events",(await queryColumns(client,"audit_events")).map(x=>x.column_name)),ids=targetRows.map(row=>Number(row.id)).sort((a,b)=>a-b),refs=await auditReferences(client,"audit_events"),anchors=Number((await client.query("select count(*)::int as count from public.profiles")).rows[0].count);
    assert.equal(targetRows.length,111,"AUDIT_ARTIFACT_COUNT_MISMATCH"); assert.deepEqual(ids,Array.from({length:111},(_,index)=>165+index),"AUDIT_ARTIFACT_ID_SET_MISMATCH"); assert.ok(targetRows.every(row=>sourceIds.has(String(row.id))),"AUDIT_ARTIFACT_UNEXPECTED_TARGET_ONLY_ROW"); assert.ok(targetRows.every(row=>row.created_at&&Date.parse(row.created_at)>Date.parse("2026-09-20T09:53:11Z")),"AUDIT_ARTIFACT_PRE_RESTORE_ROW"); assert.equal(refs.length,0,"AUDIT_ARTIFACT_INBOUND_FK"); assert.equal(anchors,96,"AUDIT_ANCHOR_COUNT_MISMATCH");
    const deleted=await client.query("delete from public.audit_events where id between 165 and 275"); assert.equal(deleted.rowCount,111,"AUDIT_ARTIFACT_DELETE_COUNT_MISMATCH"); const after=Number((await client.query("select count(*)::int as count from public.audit_events")).rows[0].count),anchorsAfter=Number((await client.query("select count(*)::int as count from public.profiles")).rows[0].count); assert.equal(after,0,"AUDIT_ARTIFACT_NOT_EMPTY_AFTER_DELETE"); assert.equal(anchorsAfter,96,"AUDIT_ANCHOR_CHANGED"); await client.query("commit"); console.log(JSON.stringify({status:"PASSED",runId:RUN_ID,authorizationReference:AUTHORIZATION_REFERENCE,mode,deletedAuditEvents:111,targetAuditEventsAfter:after,preservedProfileAnchors:anchorsAfter,targetWriteScope:"approved-clean-target-audit-events-artifact-cleanup",sourceClientsInitialized:true}));
  } catch(error) { await client.query("rollback").catch(()=>undefined); console.error(JSON.stringify(safeError(error,phase))); process.exitCode=1; } finally { await client.end().catch(()=>undefined); }
}
await (mode === "database" ? runDatabase() : mode === "objects" ? runObjects() : mode === "reconcile" ? runFeatureCatalogReconciliation() : mode === ROLE_PERMISSIONS_RECONCILIATION_MODE ? runRolePermissionsReconciliation() : mode === FOREIGN_KEY_CYCLE_DIAGNOSIS_MODE ? runForeignKeyCycleDiagnosis() : mode === TARGET_GENERATED_COLUMN_DIAGNOSTIC_MODE ? runTargetGeneratedColumnDiagnostic() : mode === TARGET_PROVENANCE_SWEEP_MODE ? runTargetProvenanceSweep() : mode === AUDIT_IDENTITY_COLLISION_DIAGNOSTIC_MODE ? auditIdentityDiagnostic() : mode === AUDIT_ARTIFACT_CLEANUP_MODE ? cleanupAuditArtifacts() : mode === "schema-contract" ? runFirearmAssignmentsSchemaContract() : mode === SCHEMA_REPAIR_MODE ? runFirearmAssignmentsSchemaRepair() : mode === SCHEMA_SWEEP_MODE ? runFullSchemaContractSweep() : runTargetDataPreflight());
