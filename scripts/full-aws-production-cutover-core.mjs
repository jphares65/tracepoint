import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,199}$/;
const PHASES = Object.freeze([
  "planned",
  "source-frozen",
  "database-migrated",
  "identity-migrated",
  "storage-reconciled",
  "recovery-point-created",
  "service-switched",
  "dns-switched",
  "validated",
  "complete",
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export const sha256 = value => createHash("sha256").update(canonical(value)).digest("hex");

function exact(value, keys, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} fields do not match the reviewed schema`);
}

function validateRecordSet(record, label) {
  exact(record, ["Name", "Type", ...(record.AliasTarget ? ["AliasTarget"] : ["TTL", "ResourceRecords"])], label);
  assert.match(record.Name, /^[A-Za-z0-9*_.-]+\.$/);
  assert.ok(["A", "AAAA", "CNAME"].includes(record.Type), `${label} type is unsupported`);
  if (record.AliasTarget) {
    exact(record.AliasTarget, ["DNSName", "EvaluateTargetHealth", "HostedZoneId"], `${label} alias`);
    assert.equal(typeof record.AliasTarget.EvaluateTargetHealth, "boolean");
  } else {
    assert.ok(Number.isInteger(record.TTL) && record.TTL >= 30 && record.TTL <= 86400, `${label} TTL is invalid`);
    assert.ok(Array.isArray(record.ResourceRecords) && record.ResourceRecords.length > 0, `${label} values are required`);
    for (const item of record.ResourceRecords) exact(item, ["Value"], `${label} value`);
  }
  return record;
}

export function inverseDnsChanges(forwardChanges, previousRecordSets) {
  assert.ok(Array.isArray(forwardChanges) && forwardChanges.length > 0 && forwardChanges.length <= 10, "Bounded DNS changes are required");
  assert.ok(Array.isArray(previousRecordSets), "Previous DNS records are required");
  const previous = new Map(previousRecordSets.map(record => {
    validateRecordSet(record, "Previous DNS record");
    return [`${record.Name}|${record.Type}`, record];
  }));
  return [...forwardChanges].reverse().map((change, index) => {
    exact(change, ["Action", "ResourceRecordSet"], `DNS change ${index}`);
    assert.ok(["CREATE", "DELETE", "UPSERT"].includes(change.Action), "Unsupported DNS action");
    const record = validateRecordSet(change.ResourceRecordSet, `DNS change ${index} record`);
    const prior = previous.get(`${record.Name}|${record.Type}`);
    if (change.Action === "CREATE") {
      assert.equal(prior, undefined, "CREATE cannot replace an existing DNS record");
      return { Action: "DELETE", ResourceRecordSet: record };
    }
    assert.ok(prior, `${change.Action} requires the exact previous DNS record`);
    return { Action: change.Action === "DELETE" ? "CREATE" : "UPSERT", ResourceRecordSet: prior };
  });
}

export function createCutoverPlan(input, generatedAt = new Date().toISOString()) {
  exact(input, [
    "authorizationReference", "databaseRunId", "forwardDnsChanges", "identityRunId",
    "previousDnsRecordSets", "sourceCommit", "sourceFreezeEvidenceSha256",
    "storageManifestSha256", "targetTaskDefinitionArn",
  ], "Cutover plan input");
  assert.match(input.authorizationReference, REFERENCE);
  assert.match(input.sourceCommit, COMMIT);
  assert.match(input.sourceFreezeEvidenceSha256, SHA256);
  assert.match(input.storageManifestSha256, SHA256);
  assert.match(input.databaseRunId, /^[0-9a-f-]{36}$/);
  assert.match(input.identityRunId, /^[0-9a-f-]{36}$/);
  assert.match(input.targetTaskDefinitionArn, /^arn:aws(?:-us-gov)?:ecs:[a-z0-9-]+:\d{12}:task-definition\/[A-Za-z0-9_-]+:\d+$/);
  assert.ok(Number.isFinite(Date.parse(generatedAt)), "Cutover plan timestamp is invalid");
  const inverse = inverseDnsChanges(input.forwardDnsChanges, input.previousDnsRecordSets);
  const payload = { format: 1, generatedAt, ...input, inverseDnsChanges: inverse, executionAuthorized: false };
  return { ...payload, contentSha256: sha256(payload) };
}

export function validateCutoverPlan(plan) {
  exact(plan, [
    "authorizationReference", "contentSha256", "databaseRunId", "executionAuthorized",
    "format", "forwardDnsChanges", "generatedAt", "identityRunId", "inverseDnsChanges",
    "previousDnsRecordSets", "sourceCommit", "sourceFreezeEvidenceSha256",
    "storageManifestSha256", "targetTaskDefinitionArn",
  ], "Cutover plan");
  assert.equal(plan.format, 1);
  assert.equal(plan.executionAuthorized, false);
  const rebuilt = createCutoverPlan({
    authorizationReference: plan.authorizationReference,
    databaseRunId: plan.databaseRunId,
    forwardDnsChanges: plan.forwardDnsChanges,
    identityRunId: plan.identityRunId,
    previousDnsRecordSets: plan.previousDnsRecordSets,
    sourceCommit: plan.sourceCommit,
    sourceFreezeEvidenceSha256: plan.sourceFreezeEvidenceSha256,
    storageManifestSha256: plan.storageManifestSha256,
    targetTaskDefinitionArn: plan.targetTaskDefinitionArn,
  }, plan.generatedAt);
  assert.equal(rebuilt.contentSha256, plan.contentSha256, "Cutover plan integrity check failed");
  assert.deepEqual(rebuilt.inverseDnsChanges, plan.inverseDnsChanges, "DNS rollback is not the exact inverse");
  return plan;
}

export function createCutoverCheckpoint(plan, now = new Date().toISOString()) {
  validateCutoverPlan(plan);
  assert.ok(Number.isFinite(Date.parse(now)), "Checkpoint timestamp is invalid");
  return {
    format: 1,
    planSha256: plan.contentSha256,
    phase: "planned",
    writesMayExist: false,
    events: [],
    updatedAt: now,
  };
}

export function advanceCutoverCheckpoint(plan, checkpoint, event, now = new Date().toISOString()) {
  validateCutoverPlan(plan);
  exact(checkpoint, ["events", "format", "phase", "planSha256", "updatedAt", "writesMayExist"], "Cutover checkpoint");
  exact(event, ["evidenceSha256", "phase"], "Cutover event");
  assert.equal(checkpoint.format, 1);
  assert.equal(checkpoint.planSha256, plan.contentSha256, "Checkpoint belongs to another cutover plan");
  assert.match(event.evidenceSha256, SHA256);
  assert.ok(Number.isFinite(Date.parse(now)), "Checkpoint timestamp is invalid");
  const current = PHASES.indexOf(checkpoint.phase);
  assert.ok(current >= 0 && current < PHASES.length - 1, "Cutover checkpoint is already terminal");
  assert.equal(event.phase, PHASES[current + 1], "Cutover phases must advance exactly once and in order");
  const writesMayExist = checkpoint.writesMayExist || PHASES.indexOf(event.phase) >= PHASES.indexOf("service-switched");
  return {
    ...checkpoint,
    phase: event.phase,
    writesMayExist,
    events: [...checkpoint.events, { ...event, recordedAt: now }],
    updatedAt: now,
  };
}

export function cutoverRollbackDecision(plan, checkpoint) {
  validateCutoverPlan(plan);
  assert.equal(checkpoint.planSha256, plan.contentSha256);
  return checkpoint.writesMayExist
    ? { automaticRollbackAllowed: false, action: "freeze-and-reconcile-target-writes" }
    : { automaticRollbackAllowed: true, action: "apply-inverse-dns-and-restore-bridge", inverseDnsChanges: plan.inverseDnsChanges };
}
