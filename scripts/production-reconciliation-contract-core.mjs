import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { TARGET_SEEDED_TABLES, TRANSIENT_TABLES } from "./database-migration-core.mjs";

const canonical = value => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const sha256 = value => createHash("sha256").update(canonical(value)).digest("hex");

export function createProductionReconciliationContract(inventory, generatedAt = new Date().toISOString()) {
  assert.equal(inventory.format, "tracepoint-production-source-inventory/v1");
  assert.match(inventory.contentSha256, /^[0-9a-f]{64}$/);
  assert.equal(inventory.database.totalRows, 4358);
  assert.equal(inventory.identityTransition.cohortUsers, 96);
  assert.equal(inventory.identityTransition.membershipLinks, 95);
  assert.equal(inventory.storage.totalObjects, 2);
  assert.ok(Number.isFinite(Date.parse(generatedAt)));
  const seeded = new Set(TARGET_SEEDED_TABLES);
  const transient = new Set(TRANSIENT_TABLES);
  const relations = inventory.database.exposedRelations.map(relation => {
    const derived = relation.name.startsWith("v_");
    const copyMode = derived ? "recompute-view" : transient.has(relation.name) ? "exclude-transient" : seeded.has(relation.name) ? "exclude-target-seeded" : "copy-source-row";
    return {
      relation: relation.name,
      kind: derived ? "view" : "table",
      observedSourceRows: relation.rowCount,
      copyMode,
      failClosedChecks: derived
        ? ["derived-count", "definition-from-authoritative-lineage", "zero-security-barrier-drift"]
        : ["exact-count", "primary-key-set-where-defined", "source-column-row-hash", "foreign-key-validation", "tenant-owner-validity", "timestamp-preservation"],
    };
  });
  const physicalRows = relations.filter(item => item.kind === "table").reduce((sum, item) => sum + item.observedSourceRows, 0);
  const copiedRows = relations.filter(item => item.copyMode === "copy-source-row").reduce((sum, item) => sum + item.observedSourceRows, 0);
  assert.equal(physicalRows, 4105);
  assert.equal(copiedRows, 4007);
  const payload = {
    format: "tracepoint-production-reconciliation-contract/v1",
    generatedAt,
    sourceInventorySha256: inventory.contentSha256,
    database: {
      productionSourceMigrations: 60,
      authoritativeSourceMigrations: 76,
      awsOverlays: 20,
      finalTargetLedgerEntries: 96,
      exposedRows: inventory.database.totalRows,
      physicalRows,
      copiedRows,
      relations,
      globalFailClosedChecks: ["source-snapshot-lsn", "source-ledger-count-and-sha256", "target-ledger-count-and-sha256", "all-foreign-keys-validated", "zero-unexplained-relation-drift", "repeatable-read-source-snapshot"],
    },
    identity: {
      users: inventory.identityTransition.cohortUsers,
      userSetSha256: inventory.identityTransition.cohortUserSetSha256,
      memberships: inventory.identityTransition.membershipLinks,
      membershipSetSha256: inventory.identityTransition.membershipLinkSetSha256,
      activeMembershipUsers: inventory.identityTransition.usersWithActiveMembership,
      inactiveOnlyUsers: inventory.identityTransition.usersWithOnlyInactiveMembership,
      noMembershipUsers: inventory.identityTransition.usersWithNoMembership,
      platformAdministratorsWithNoMembership: inventory.identityTransition.platformAdministratorsWithNoMembership,
      duplicateEmailGroups: inventory.identityTransition.duplicateEmailGroups,
      failClosedChecks: ["tracepoint-user-id-preservation", "membership-and-role-preservation", "duplicate-normalized-email-zero", "cognito-subject-one-to-one", "activation-operation-terminal-state", "checkpoint-manifest-integrity"],
    },
    storage: {
      objects: inventory.storage.totalObjects,
      bytes: inventory.storage.totalBytes,
      buckets: inventory.storage.buckets.map(bucket => ({ name: bucket.name, observedObjects: bucket.objectCount, observedBytes: bucket.totalBytes, publicAtSource: bucket.public })),
      failClosedChecks: ["source-key-manifest-hash", "destination-key-manifest-hash", "per-object-byte-count", "per-object-sha256", "destination-owner", "tenant-prefix", "create-only-copy"],
    },
    privacy: { emails: false, userIds: false, objectKeys: false, rowContents: false, credentials: false },
  };
  return { ...payload, contentSha256: sha256(payload) };
}
