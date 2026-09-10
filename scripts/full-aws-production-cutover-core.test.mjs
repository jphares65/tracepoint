import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceCutoverCheckpoint,
  createCutoverCheckpoint,
  createCutoverPlan,
  cutoverRollbackDecision,
  validateCutoverPlan,
} from "./full-aws-production-cutover-core.mjs";

const oldRecord = { Name: "tracepointhq.com.", Type: "A", AliasTarget: { DNSName: "old.example.net.", EvaluateTargetHealth: false, HostedZoneId: "ZOLD123" } };
const nextRecord = { Name: "tracepointhq.com.", Type: "A", AliasTarget: { DNSName: "new.elb.amazonaws.com.", EvaluateTargetHealth: true, HostedZoneId: "ZNEW123" } };
const input = {
  authorizationReference: "OWNER-2026-09-11",
  databaseRunId: "10000000-0000-4000-8000-000000000001",
  forwardDnsChanges: [{ Action: "UPSERT", ResourceRecordSet: nextRecord }],
  identityRunId: "10000000-0000-4000-8000-000000000002",
  previousDnsRecordSets: [oldRecord],
  sourceCommit: "a".repeat(40),
  sourceFreezeEvidenceSha256: "b".repeat(64),
  storageManifestSha256: "c".repeat(64),
  targetTaskDefinitionArn: "arn:aws:ecs:us-east-1:222222222222:task-definition/tracepoint-production:42",
};

test("binds the exact inverse DNS rollback to an immutable plan", () => {
  const plan = createCutoverPlan(input, "2026-09-11T12:00:00.000Z");
  assert.equal(validateCutoverPlan(plan), plan);
  assert.deepEqual(plan.inverseDnsChanges, [{ Action: "UPSERT", ResourceRecordSet: oldRecord }]);
  assert.throws(() => validateCutoverPlan({ ...plan, sourceCommit: "d".repeat(40) }), /integrity/);
});

test("enforces resumable ordered phases and disables automatic rollback before traffic can write", () => {
  const plan = createCutoverPlan(input);
  let checkpoint = createCutoverCheckpoint(plan);
  assert.throws(() => advanceCutoverCheckpoint(plan, checkpoint, { phase: "database-migrated", evidenceSha256: "d".repeat(64) }), /exactly once/);
  for (const phase of ["source-frozen", "database-migrated", "identity-migrated", "storage-reconciled", "recovery-point-created"]) {
    checkpoint = advanceCutoverCheckpoint(plan, checkpoint, { phase, evidenceSha256: "d".repeat(64) });
  }
  assert.equal(cutoverRollbackDecision(plan, checkpoint).automaticRollbackAllowed, true);
  checkpoint = advanceCutoverCheckpoint(plan, checkpoint, { phase: "service-switched", evidenceSha256: "e".repeat(64) });
  assert.deepEqual(cutoverRollbackDecision(plan, checkpoint), { automaticRollbackAllowed: false, action: "freeze-and-reconcile-target-writes" });
});

test("rejects a DNS change without an exact prior record", () => {
  assert.throws(() => createCutoverPlan({ ...input, previousDnsRecordSets: [] }), /exact previous/);
});
