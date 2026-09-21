import assert from "node:assert/strict";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { AUTHORIZATION_REFERENCE, MIGRATION_ARTIFACT_BUCKET, MIGRATION_ARTIFACT_KEY, MIGRATION_RELATIONS, RELATION_ORDER_COLUMNS, RUN_ID, canonical, sha256 } from "./supabase-rest-ledger-core.mjs";

export const INITIAL_ARTIFACT_SHA256 = "8b01ea2a57a650b10d126160c5d171fecf1e98f1e07a9fa720e97e600d8d6d57";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARTIFACT_KEY = new RegExp(`^migration/source/${RUN_ID}/(?:initial-canonical|final-frozen)\\.json$`);
const INITIAL_EXPECTATIONS = Object.freeze({ relationalRows: 4813, identities: 96, memberships: 95, activeMemberships: 94, inactiveMemberships: 1, platformAdmins: 1, objects: 2, objectBytes: 522978 });
const DRIFTED_RELATION_COUNTS = Object.freeze({ audit_events: 2726, equipment_asset_assignments: 33, equipment_assets: 39, fleet_vehicles: 45 });
const rowsFor = (artifact, relation) => { const rows = artifact.rows?.[relation]; assert.ok(Array.isArray(rows), `RELATION_ROWS_MISSING:${relation}`); return rows; };
const safeFailure = error => ({ status: "FAILED", violation: error instanceof Error ? error.message.replace(/[\r\n]/g, " ").slice(0, 512) : "ARTIFACT_VALIDATION_FAILURE" });
const validUuid = value => UUID.test(String(value));
const stableKey = (row, columns, relation) => { const value = columns.map(column => row?.[column]); assert.ok(value.every(item => item !== null && item !== undefined && item !== ""), `REQUIRED_STABLE_KEY_MISSING:${relation}`); return canonical(value); };

/** Pure artifact validator. It has no live-source, target-RDS, or write dependency. */
export function validateImmutableArtifact(artifact, { expectedSha256, expectations = INITIAL_EXPECTATIONS, enforceCurrentDriftCounts = false } = {}) {
  assert.ok(artifact && typeof artifact === "object" && !Array.isArray(artifact), "ARTIFACT_INVALID");
  assert.match(expectedSha256, /^[0-9a-f]{64}$/, "EXPECTED_ARTIFACT_SHA256_REQUIRED");
  const { masterSha256, ...body } = artifact;
  assert.equal(masterSha256, expectedSha256, "ARTIFACT_EXPECTED_SHA256_MISMATCH");
  assert.equal(sha256(body), masterSha256, "ARTIFACT_CONTENT_SHA256_MISMATCH");
  assert.equal(artifact.runId, RUN_ID, "ARTIFACT_RUN_ID_MISMATCH");
  assert.equal(artifact.authorizationReference, AUTHORIZATION_REFERENCE, "ARTIFACT_AUTHORIZATION_MISMATCH");
  assert.deepEqual(artifact.source?.relationContract, [...MIGRATION_RELATIONS], "ARTIFACT_RELATION_CONTRACT_MISMATCH");
  assert.equal(artifact.tables?.length, MIGRATION_RELATIONS.length, "ARTIFACT_TABLE_COUNT_MISMATCH");
  const knownIds = new Set(), idsByRelation = new Map(), departmentsById = new Map(), tableSummary = [], violations = new Set();
  for (const relation of MIGRATION_RELATIONS) {
    const rows = rowsFor(artifact, relation), table = artifact.tables.find(item => item.name === relation);
    assert.ok(table, `TABLE_METADATA_MISSING:${relation}`);
    assert.equal(table.rows, rows.length, `TABLE_ROW_COUNT_MISMATCH:${relation}`);
    assert.equal(table.canonicalDataSha256, sha256(rows), `TABLE_HASH_MISMATCH:${relation}`);
    const keys = new Set(), relationIds = new Set(), keyColumns = RELATION_ORDER_COLUMNS[relation] ?? ["id"];
    for (const row of rows) {
      assert.ok(row && typeof row === "object" && !Array.isArray(row), `ROW_INVALID:${relation}`);
      const key = stableKey(row, keyColumns, relation); assert.equal(keys.has(key), false, `PRIMARY_KEY_DUPLICATE:${relation}`); keys.add(key);
      // IDs are unique only in their relation. Derived v_* relations are
      // projections and therefore legitimately reuse base-table identifiers.
      if (validUuid(row.id)) {
        const id = String(row.id); knownIds.add(id); relationIds.add(id);
        if (row.department_id !== null && row.department_id !== undefined) {
          const owningDepartments = departmentsById.get(id) ?? new Set();
          owningDepartments.add(String(row.department_id)); departmentsById.set(id, owningDepartments);
        }
      }
    }
    idsByRelation.set(relation, relationIds); tableSummary.push({ relation, count: rows.length, canonicalDataSha256: table.canonicalDataSha256 });
  }
  const totalRows = tableSummary.reduce((sum, item) => sum + item.count, 0);
  assert.equal(artifact.totalRelationalRows, totalRows, "RELATIONAL_ROW_SUM_MISMATCH"); assert.equal(totalRows, expectations.relationalRows, "RELATIONAL_ROW_COUNT_MISMATCH");
  const departments = idsByRelation.get("departments"), identities = artifact.identities?.rows;
  assert.ok(Array.isArray(identities), "IDENTITY_ROWS_MISSING");
  const identityIds = new Set();
  for (const identity of identities) { assert.ok(validUuid(identity?.id), "IDENTITY_ID_INVALID"); assert.equal(identityIds.has(String(identity.id)), false, "IDENTITY_ID_DUPLICATE"); identityIds.add(String(identity.id)); }
  assert.equal(identities.length, expectations.identities, "IDENTITY_COUNT_MISMATCH"); assert.equal(artifact.identities.count, expectations.identities, "IDENTITY_METADATA_COUNT_MISMATCH"); assert.equal(artifact.identities.canonicalDataSha256, sha256(identities), "IDENTITY_HASH_MISMATCH");
  const memberships = rowsFor(artifact, "department_memberships"); assert.equal(memberships.length, expectations.memberships, "MEMBERSHIP_COUNT_MISMATCH");
  let activeMemberships = 0, inactiveMemberships = 0;
  for (const membership of memberships) { if (!departments.has(String(membership.department_id))) violations.add("MEMBERSHIP_DEPARTMENT_ORPHAN"); if (!identityIds.has(String(membership.user_id))) violations.add("MEMBERSHIP_IDENTITY_ORPHAN"); if (membership.is_active === true) activeMemberships += 1; else inactiveMemberships += 1; }
  assert.equal(activeMemberships, expectations.activeMemberships, "STANDARD_ACTIVE_MEMBERSHIP_MISMATCH"); assert.equal(inactiveMemberships, expectations.inactiveMemberships, "INACTIVE_DISABLED_MEMBERSHIP_MISMATCH");
  const platformAdmins = rowsFor(artifact, "platform_admins"); assert.equal(platformAdmins.length, expectations.platformAdmins, "PLATFORM_ADMIN_EXCEPTION_MISMATCH"); for (const admin of platformAdmins) if (!identityIds.has(String(admin.user_id))) violations.add("PLATFORM_ADMIN_IDENTITY_ORPHAN");
  for (const relation of MIGRATION_RELATIONS) for (const row of rowsFor(artifact, relation)) {
    if (row.department_id !== null && row.department_id !== undefined && !departments.has(String(row.department_id))) violations.add(`TENANT_ORPHAN:${relation}`);
    for (const [column, value] of Object.entries(row)) {
      if (!column.endsWith("_id") || column === "department_id" || value === null || value === undefined || !validUuid(value)) continue;
      const reference = String(value); if (!identityIds.has(reference) && !knownIds.has(reference)) violations.add(`FK_ORPHAN:${relation}.${column}`);
      const owningDepartments = departmentsById.get(reference);
      if (owningDepartments && row.department_id && !owningDepartments.has(String(row.department_id))) violations.add(`CROSS_TENANT_REFERENCE:${relation}.${column}`);
    }
  }
  for (const [relation, column, parent] of [["agency_training_attendees", "certification_id", "training_certifications"], ["training_certifications", "source_training_attendee_id", "agency_training_attendees"]]) for (const row of rowsFor(artifact, relation)) if (row[column] !== null && row[column] !== undefined && !idsByRelation.get(parent).has(String(row[column]))) violations.add(`CYCLE_REFERENCE_ORPHAN:${relation}.${column}`);
  if (enforceCurrentDriftCounts) for (const [relation, count] of Object.entries(DRIFTED_RELATION_COUNTS)) assert.equal(rowsFor(artifact, relation).length, count, `DRIFT_RELATION_COUNT_MISMATCH:${relation}`);
  assert.equal(artifact.objects?.count, expectations.objects, "OBJECT_COUNT_MISMATCH"); assert.equal(artifact.objects?.totalBytes, expectations.objectBytes, "OBJECT_BYTES_MISMATCH"); assert.ok(Array.isArray(artifact.objects?.manifest), "OBJECT_MANIFEST_MISSING"); assert.equal(artifact.objects.manifest.length, expectations.objects, "OBJECT_MANIFEST_COUNT_MISMATCH"); assert.equal(sha256(artifact.objects.manifest), artifact.objects.manifestSha256, "OBJECT_MANIFEST_HASH_MISMATCH");
  for (const object of artifact.objects.manifest) { assert.match(object.sha256, /^[0-9a-f]{64}$/, "OBJECT_CHECKSUM_INVALID"); assert.ok(Number.isSafeInteger(object.bytes) && object.bytes >= 0, "OBJECT_SIZE_INVALID"); if (!departments.has(String(object.departmentId))) violations.add("OBJECT_DEPARTMENT_ORPHAN"); }
  assert.deepEqual([...violations].sort(), [], `ARTIFACT_INTEGRITY_VIOLATIONS:${[...violations].sort().join(",")}`);
  return { relationalRows: totalRows, identities: identities.length, memberships: memberships.length, standardActive: activeMemberships, inactiveDisabled: inactiveMemberships, platformAdminExceptions: platformAdmins.length, objects: artifact.objects.count, objectBytes: artifact.objects.totalBytes, changedRelations: enforceCurrentDriftCounts ? DRIFTED_RELATION_COUNTS : undefined, tableSummary };
}

export async function runImmutableArtifactValidator(environment = process.env, clientFactory = () => new S3Client({ region: "us-east-1", maxAttempts: 1 })) {
  const key = environment.TRACEPOINT_SOURCE_ARTIFACT_KEY ?? MIGRATION_ARTIFACT_KEY, expectedSha256 = environment.TRACEPOINT_SOURCE_ARTIFACT_SHA256 ?? INITIAL_ARTIFACT_SHA256;
  assert.equal(ARTIFACT_KEY.test(key), true, "ARTIFACT_KEY_NOT_APPROVED");
  const s3 = clientFactory();
  try { const response = await s3.send(new GetObjectCommand({ Bucket: MIGRATION_ARTIFACT_BUCKET, Key: key, ExpectedBucketOwner: "193644343389", ChecksumMode: "ENABLED" })); const artifact = JSON.parse(await response.Body.transformToString()); const integrity = validateImmutableArtifact(artifact, { expectedSha256, enforceCurrentDriftCounts: key === MIGRATION_ARTIFACT_KEY }); return { status: "PASSED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, artifact: { bucket: MIGRATION_ARTIFACT_BUCKET, key, masterSha256: expectedSha256 }, integrity, sourceClientsInitialized: false, targetClientsInitialized: false, writeClientsInitialized: false }; }
  finally { s3.destroy(); }
}

if (import.meta.main) { try { console.log(JSON.stringify(await runImmutableArtifactValidator())); } catch (error) { console.error(JSON.stringify(safeFailure(error))); process.exitCode = 1; } }
