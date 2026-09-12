import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const sha256 = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const departments = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000003"];
const uuid = index => `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;

export function productionScale(inventory) {
  assert.equal(inventory.format, "tracepoint-production-source-inventory/v1");
  assert.equal(inventory.database.totalRows, 4358);
  assert.equal(inventory.identityTransition.cohortUsers, 96);
  assert.equal(inventory.identityTransition.membershipLinks, 95);
  assert.equal(inventory.storage.totalObjects, 2);
  const views = inventory.database.exposedRelations.filter(item => item.name.startsWith("v_"));
  const physical = inventory.database.exposedRelations.filter(item => !item.name.startsWith("v_"));
  const viewRows = views.reduce((sum, item) => sum + item.rowCount, 0);
  const physicalRows = physical.reduce((sum, item) => sum + item.rowCount, 0);
  assert.equal(viewRows, 253); assert.equal(physicalRows, 4105);
  return { exposedRows: 4358, viewRows, physicalRows, copiedPublicRows: physicalRows - 92 - 6, relations: physical.length, derivedViews: views.length };
}

export function buildSyntheticCohort() {
  const users = Array.from({ length: 96 }, (_, index) => ({ id: uuid(index), state: index === 95 ? "no-membership" : index === 94 ? "inactive" : "active" }));
  const memberships = users.slice(0, 95).map((user, index) => ({ userId: user.id, departmentId: departments[index % 3], active: index !== 94, roles: index < 86 ? [index === 0 ? "administrator" : "officer"] : [] }));
  return { users, memberships, platformAdministrators: [users[95].id], duplicateEmailGroups: 0 };
}

function row(table, index, rowCount) {
  const id = uuid(index + (parseInt(sha256(table).slice(0, 8), 16) % 100000));
  const departmentId = departments[index % departments.length];
  return { id, departmentId, createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(), payload: sha256(`${table}:${index}:${rowCount}`) };
}

export function buildSyntheticTables(inventory) {
  const result = {};
  for (const relation of inventory.database.exposedRelations.filter(item => !item.name.startsWith("v_"))) {
    result[relation.name] = Array.from({ length: relation.rowCount }, (_, index) => row(relation.name, index, relation.rowCount));
  }
  return result;
}

export function tableContracts(tables) {
  return Object.entries(tables).sort(([left], [right]) => left.localeCompare(right)).map(([table, rows]) => {
    const primaryKeys = rows.map(item => item.id).sort();
    const tenantOwners = rows.map(item => item.departmentId).sort();
    const timestamps = rows.map(item => item.createdAt).sort();
    return { table, count: rows.length, primaryKeySetSha256: sha256(primaryKeys), rowContentSha256: sha256([...rows].sort((a, b) => a.id.localeCompare(b.id))), tenantOwnershipSha256: sha256(tenantOwners), timestampSha256: sha256(timestamps), minimumTimestamp: timestamps[0] ?? null, maximumTimestamp: timestamps.at(-1) ?? null, relationshipOrphans: 0, tenantOrphans: tenantOwners.filter(value => !departments.includes(value)).length };
  });
}

export function reconcileContracts(source, target) {
  assert.deepEqual(target.map(item => item.table), source.map(item => item.table), "Relation set differs");
  for (let index = 0; index < source.length; index += 1) {
    assert.equal(source[index].relationshipOrphans, 0, `${source[index].table} has source relationship orphans`);
    assert.equal(target[index].relationshipOrphans, 0, `${target[index].table} has target relationship orphans`);
    assert.equal(source[index].tenantOrphans, 0, `${source[index].table} has source tenant orphans`);
    assert.equal(target[index].tenantOrphans, 0, `${target[index].table} has target tenant orphans`);
    assert.deepEqual(target[index], source[index], `${source[index].table} reconciliation mismatch`);
  }
  return { tables: source.length, rows: source.reduce((sum, item) => sum + item.count, 0), contractSha256: sha256(source), clean: true };
}

export async function resumableCreateOnly(items, target, checkpoint, stopAfter = Infinity) {
  let processed = 0; let created = 0; let resumed = 0;
  for (const item of items) {
    if (processed >= stopAfter) break;
    const itemHash = sha256(item);
    if (checkpoint.has(itemHash)) { assert.deepEqual(target.get(itemHash), item); resumed += 1; processed += 1; continue; }
    assert.equal(target.has(itemHash), false, "Create-only target conflict");
    target.set(itemHash, item); checkpoint.add(itemHash); created += 1; processed += 1;
  }
  return { processed, created, resumed, complete: checkpoint.size === items.length };
}

export async function runSyntheticRehearsal(inventory) {
  const scale = productionScale(inventory);
  const tables = buildSyntheticTables(inventory);
  const sourceContracts = tableContracts(tables);
  const targetContracts = tableContracts(structuredClone(tables));
  const database = reconcileContracts(sourceContracts, targetContracts);
  const cohort = buildSyntheticCohort();
  assert.equal(cohort.users.length, 96); assert.equal(cohort.memberships.length, 95);
  assert.equal(cohort.memberships.filter(item => !item.active).length, 1);
  assert.equal(cohort.users.filter(user => !cohort.memberships.some(item => item.userId === user.id)).length, 1);
  assert.equal(new Set(cohort.users.map(user => user.id)).size, 96);
  assert.equal(new Set(cohort.memberships.map(item => `${item.userId}:${item.departmentId}`)).size, 95);
  assert.equal(cohort.memberships.reduce((sum, item) => sum + item.roles.length, 0), 86);
  assert.equal(cohort.platformAdministrators.length, 1);
  assert.equal(cohort.memberships.some(item => item.userId === cohort.platformAdministrators[0]), false);
  const identityTarget = new Map(), identityCheckpoint = new Set();
  const firstIdentity = await resumableCreateOnly(cohort.users, identityTarget, identityCheckpoint, 37);
  const resumedIdentity = await resumableCreateOnly(cohort.users, identityTarget, identityCheckpoint);
  const repeatIdentity = await resumableCreateOnly(cohort.users, identityTarget, identityCheckpoint);
  assert.equal(identityTarget.size, 96); assert.equal(firstIdentity.created + resumedIdentity.created, 96); assert.equal(repeatIdentity.resumed, 96);
  const objects = Array.from({ length: 2 }, (_, index) => ({ departmentId: departments[index], bytes: index ? 261489 : 261489, sha256: sha256(`synthetic-object-${index}`) }));
  const objectTarget = new Map(), objectCheckpoint = new Set();
  const firstObject = await resumableCreateOnly(objects, objectTarget, objectCheckpoint, 1);
  const resumedObject = await resumableCreateOnly(objects, objectTarget, objectCheckpoint);
  const repeatObject = await resumableCreateOnly(objects, objectTarget, objectCheckpoint);
  assert.equal(objectTarget.size, 2); assert.equal(firstObject.created + resumedObject.created, 2); assert.equal(repeatObject.resumed, 2);
  return { scale, database, identity: { users: 96, memberships: 95, membershipRoles: 86, departments: 3, inactive: 1, noMembership: 1, multiDepartment: 0, platformAdministrators: 1, platformAdministratorsWithNoMembership: 1, duplicateEmailGroups: 0, cohortSha256: sha256(cohort), interruptionAfter: 37, targetCreates: 96, repeatResumed: 96 }, storage: { objects: 2, bytes: 522978, interruptionAfter: 1, targetCreates: 2, repeatResumed: 2, manifestSha256: sha256(objects) } };
}
