import assert from 'node:assert/strict';
import { MIGRATION_RELATIONS, sha256 } from './supabase-rest-ledger-core.mjs';
import { IMPORT_RELATIONS, NULLABLE_TRAINING_CERTIFICATION_CYCLE,
  normalizeRemovedEquipmentCustody, quote } from './supabase-rest-import-core.mjs';
import { FINAL_RDS_RESOURCE_ID } from './production-final-import-core.mjs';
import { atomicTransactionClient, AUDIT_HISTORY_RELATIONS, assertAuditHistoryEmpty,
  deriveAuditPrerequisites, hydrateMigrationAnchorProfiles, importNullableTrainingCertificationCycle,
  importRelation, insertIdentityAnchors, normalizedPatchSnapshot, preflightTarget,
  repairSequences, requireIdentityAnchorPrerequisites,
  runDepartmentPrerequisiteBootstrapCleanup, verifyAtomicRollback,
  verifyDatabase, verifyEquipmentAssignmentHistory } from './run-supabase-rest-initial-import.mjs';

export function snapshotFromArtifact(artifact) {
  assert.deepEqual(artifact.tables.map(table => table.name), [...MIGRATION_RELATIONS], 'FINAL_RELATION_CONTRACT_MISMATCH');
  return normalizedPatchSnapshot({ rows: new Map(MIGRATION_RELATIONS.map(relation => [relation, artifact.rows[relation]])),
    users: artifact.identities.rows, finalCapture: true,
    objectManifest: artifact.objects.manifest,
    baseline: { relationalRows: artifact.totalRelationalRows,
      identities: artifact.identities.count, memberships: artifact.memberships.count,
      objects: artifact.objects.count, objectBytes: artifact.objects.totalBytes },
    artifact: { masterSha256: artifact.masterSha256 } });
}

export function finalImportOperations(expectedTargetResourceId = FINAL_RDS_RESOURCE_ID) {
  assert.match(expectedTargetResourceId, /^db-[A-Z0-9]+$/, 'FINAL_IMPORT_TARGET_RESOURCE_REQUIRED');
  let preflight;
  let snapshot;
  let normalizedEquipment;
  const readBaseline = async client => {
    const identity = (await client.query('select current_database() as database, inet_server_port()::int as port')).rows[0];
    assert.equal(identity.database, 'tracepoint', 'FINAL_IMPORT_DATABASE_MISMATCH');
    assert.equal(identity.port, 5432, 'FINAL_IMPORT_PORT_MISMATCH');
    const tls = (await client.query('select ssl from pg_stat_ssl where pid=pg_backend_pid()')).rows[0];
    assert.equal(tls?.ssl, true, 'FINAL_IMPORT_TLS_REQUIRED');
    const counts = new Map();
    for (const relation of IMPORT_RELATIONS) {
      const count = Number((await client.query(`select count(*)::int as count from public.${quote(relation)}`)).rows[0].count);
      counts.set(relation, count);
    }
    const authUsers = Number((await client.query('select count(*)::int as count from auth.users')).rows[0].count);
    const migrationLineage = Number((await client.query('select count(*)::int as count from tracepoint_migrations.applied_migrations')).rows[0].count);
    return { targetResourceId: expectedTargetResourceId, customerRows: [...counts.values()].reduce((sum, count) => sum + count, 0),
      authUsers, migrationLineage, counts };
  };
  const applyRelations = async (client, { plan, artifact }) => {
    snapshot = snapshotFromArtifact(artifact);
    normalizedEquipment = normalizeRemovedEquipmentCustody(snapshot.rows.get('equipment_assets') ?? [],
      snapshot.rows.get('equipment_asset_assignments') ?? []);
    const scoped = atomicTransactionClient(client);
    preflight = await preflightTarget(scoped, snapshot);
    const audit = await deriveAuditPrerequisites(scoped, preflight);
    requireIdentityAnchorPrerequisites(snapshot);
    await assertAuditHistoryEmpty(scoped, 'before_identity_anchor_creation');
    await insertIdentityAnchors(scoped, snapshot.users);
    await assertAuditHistoryEmpty(scoped, 'before_department_prerequisite_bootstrap');
    await runDepartmentPrerequisiteBootstrapCleanup(scoped, snapshot, preflight, audit);
    await assertAuditHistoryEmpty(scoped, 'before_source_history');
    for (const relation of AUDIT_HISTORY_RELATIONS) {
      await importRelation(scoped, relation, snapshot.rows.get(relation) ?? [],
        preflight.mappings.find(item => item.relation === relation), preflight.resumePlan.get(relation));
    }
    await repairSequences(scoped);
    for (const relation of preflight.order) {
      if (relation === 'departments' || AUDIT_HISTORY_RELATIONS.includes(relation)) continue;
      if (relation === 'profiles') await hydrateMigrationAnchorProfiles(scoped, snapshot, preflight);
      else if (relation === NULLABLE_TRAINING_CERTIFICATION_CYCLE.token) await importNullableTrainingCertificationCycle(scoped, snapshot, preflight);
      else await importRelation(scoped, relation,
        relation === 'equipment_assets' ? normalizedEquipment.assets :
          relation === 'equipment_asset_assignments' ? normalizedEquipment.assignments : snapshot.rows.get(relation) ?? [],
        preflight.mappings.find(item => item.relation === relation), preflight.resumePlan.get(relation));
    }
    await repairSequences(scoped);
    await verifyEquipmentAssignmentHistory(scoped, snapshot, preflight, normalizedEquipment);
    return { relationalRows: plan.relationalRows, identities: snapshot.users.length,
      memberships: (snapshot.rows.get('department_memberships') ?? []).length };
  };
  const reconcile = async (client, { plan, artifact }) => {
    assert.ok(preflight && snapshot && normalizedEquipment, 'FINAL_IMPORT_APPLY_NOT_RUN');
    assert.equal(snapshot.artifact.masterSha256, artifact.masterSha256, 'FINAL_IMPORT_SOURCE_CHANGED');
    const evidence = await verifyDatabase(atomicTransactionClient(client), snapshot, preflight, normalizedEquipment);
    const targetIdentities = (await client.query('select id::text,email from auth.users order by id')).rows;
    const sourceIdentities = snapshot.users.map(({ id, email }) => ({ id: String(id), email })).sort((a, b) => a.id.localeCompare(b.id));
    assert.equal(sha256(targetIdentities), sha256(sourceIdentities), 'FINAL_IMPORT_IDENTITY_PARITY_FAILED');
    assert.equal(evidence.sourceTables.length, MIGRATION_RELATIONS.length, 'FINAL_IMPORT_CONTRACT_COUNT_MISMATCH');
    assert.equal(evidence.totalRelationalRows, plan.relationalRows, 'FINAL_IMPORT_ROW_PARITY_FAILED');
    return { passed: true, relationContracts: evidence.sourceTables.length,
      relationalRows: evidence.totalRelationalRows, identities: targetIdentities.length,
      memberships: (snapshot.rows.get('department_memberships') ?? []).length,
      evidenceSha256: evidence.masterSha256 };
  };
  const verifyCommitted = async (client, plan) => {
    const result = await reconcile(client, { plan, artifact: { masterSha256: snapshot.artifact.masterSha256 } });
    return { passed: result.passed && result.relationalRows === plan.relationalRows };
  };
  const verifyRollback = async (client, baseline) => {
    if (preflight) return { restored: (await verifyAtomicRollback(client, preflight)).relationalRowsRestored };
    const actual = await readBaseline(client);
    return { restored: actual.authUsers === baseline.authUsers &&
      [...baseline.counts].every(([relation, count]) => actual.counts.get(relation) === count) };
  };
  return { readBaseline, applyRelations, reconcileInTransaction: reconcile, verifyCommitted, verifyRollback };
}
