import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const PROJECT_REF_VALUE = "izlkwggluhlhzlumtzes";
const CONTENT_RANGE = /\/(\d+)$/;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export const sha256 = value => createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");

export function validateProductionSourceEnvironment(environment) {
  const url = new URL(environment.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.invalid");
  assert.equal(url.href, `https://${PROJECT_REF_VALUE}.supabase.co/`, "Exact production Supabase project is required");
  assert.ok(typeof environment.SUPABASE_SECRET_KEY === "string" && environment.SUPABASE_SECRET_KEY.length > 20, "Production read-only service credential is required");
  return { projectRef: PROJECT_REF_VALUE, url: url.href };
}

export function exposedRelations(openApi) {
  assert.ok(openApi && typeof openApi === "object" && openApi.paths && typeof openApi.paths === "object", "PostgREST OpenAPI document is invalid");
  return Object.entries(openApi.paths)
    .filter(([path, operations]) => /^\/[a-z][a-z0-9_]*$/.test(path) && operations && typeof operations === "object" && "get" in operations)
    .map(([path]) => path.slice(1))
    .sort();
}

export function exactCountFromHeaders(headers, label) {
  const match = CONTENT_RANGE.exec(headers.get("content-range") ?? "");
  assert.ok(match, `Exact count unavailable for ${label}`);
  const count = Number(match[1]);
  assert.ok(Number.isSafeInteger(count) && count >= 0, `Invalid exact count for ${label}`);
  return count;
}

export function parseMigrationList(output, localVersions) {
  const remote = [];
  for (const rawLine of output.replaceAll(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/)) {
    const line = rawLine.replaceAll("`", "");
    const cells = line.split("|").map(value => value.trim());
    if (!/^\d{8,14}$/.test(cells[0] ?? "") || !/^\d{8,14}$/.test(cells[1] ?? "")) continue;
    remote.push(cells[1]);
  }
  return reconcileMigrationVersions(remote, localVersions);
}

export function reconcileMigrationVersions(remoteVersions, localVersions) {
  const remote = remoteVersions.map(String);
  assert.ok(remote.every(version => /^\d{8,14}$/.test(version)), "Remote migration version is invalid");
  assert.equal(new Set(remote).size, remote.length, "Remote migration ledger contains duplicates");
  const local = [...localVersions].sort();
  const remoteSorted = [...remote].sort();
  return {
    localCount: local.length,
    remoteCount: remoteSorted.length,
    localLedgerSha256: sha256(local),
    remoteLedgerSha256: sha256(remoteSorted),
    missingFromProduction: local.filter(version => !remoteSorted.includes(version)),
    unexpectedInProduction: remoteSorted.filter(version => !local.includes(version)),
  };
}

export function summarizeIdentityUsers(users) {
  const providerCounts = {};
  let confirmed = 0;
  let banned = 0;
  let anonymous = 0;
  for (const user of users) {
    if (user.email_confirmed_at || user.confirmed_at) confirmed += 1;
    if (user.is_anonymous === true) anonymous += 1;
    if (user.banned_until && Date.parse(user.banned_until) > Date.now()) banned += 1;
    const providers = new Set([
      ...(Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : []),
      ...(typeof user.app_metadata?.provider === "string" ? [user.app_metadata.provider] : []),
    ].filter(value => typeof value === "string" && /^[a-z0-9_-]{1,40}$/i.test(value)));
    for (const provider of providers) providerCounts[provider] = (providerCounts[provider] ?? 0) + 1;
  }
  return { total: users.length, confirmed, unconfirmed: users.length - confirmed, banned, anonymous, providerCounts: Object.fromEntries(Object.entries(providerCounts).sort()) };
}

export function summarizeIdentityTransition(users, memberships, platformAdministrators = []) {
  assert.ok(Array.isArray(users) && Array.isArray(memberships) && Array.isArray(platformAdministrators));
  const userIds = new Set();
  const normalizedEmails = new Map();
  for (const user of users) {
    assert.match(user.id ?? "", /^[0-9a-f-]{36}$/i, "Auth user ID is invalid");
    assert.equal(userIds.has(user.id), false, "Duplicate Auth user ID");
    userIds.add(user.id);
    if (typeof user.email === "string" && user.email.trim()) {
      const normalized = user.email.trim().toLowerCase();
      normalizedEmails.set(normalized, (normalizedEmails.get(normalized) ?? 0) + 1);
    }
  }
  const departmentsByUser = new Map();
  const activeDepartmentsByUser = new Map();
  const membershipKeys = [];
  let inactiveMemberships = 0;
  let membershipUsersMissingFromAuth = 0;
  for (const membership of memberships) {
    assert.match(membership.user_id ?? "", /^[0-9a-f-]{36}$/i, "Membership user ID is invalid");
    assert.match(membership.department_id ?? "", /^[0-9a-f-]{36}$/i, "Membership department ID is invalid");
    const key = `${membership.user_id.toLowerCase()}:${membership.department_id.toLowerCase()}`;
    membershipKeys.push(key);
    const departments = departmentsByUser.get(membership.user_id) ?? new Set();
    departments.add(membership.department_id);
    departmentsByUser.set(membership.user_id, departments);
    if (membership.is_active === false) inactiveMemberships += 1;
    else {
      const activeDepartments = activeDepartmentsByUser.get(membership.user_id) ?? new Set();
      activeDepartments.add(membership.department_id);
      activeDepartmentsByUser.set(membership.user_id, activeDepartments);
    }
    if (!userIds.has(membership.user_id)) membershipUsersMissingFromAuth += 1;
  }
  assert.equal(new Set(membershipKeys).size, membershipKeys.length, "Duplicate department membership");
  const platformAdministratorIds = new Set();
  for (const administrator of platformAdministrators) {
    assert.match(administrator.user_id ?? "", /^[0-9a-f-]{36}$/i, "Platform administrator user ID is invalid");
    if (administrator.is_active !== false) platformAdministratorIds.add(administrator.user_id);
  }
  const duplicateEmailGroups = [...normalizedEmails.values()].filter(count => count > 1);
  return {
    cohortUsers: users.length,
    cohortUserSetSha256: sha256([...userIds].sort()),
    membershipLinks: memberships.length,
    membershipLinkSetSha256: sha256([...membershipKeys].sort()),
    usersWithNoMembership: [...userIds].filter(id => !departmentsByUser.has(id)).length,
    usersWithActiveMembership: [...userIds].filter(id => activeDepartmentsByUser.has(id)).length,
    usersWithOnlyInactiveMembership: [...userIds].filter(id => departmentsByUser.has(id) && !activeDepartmentsByUser.has(id)).length,
    multiDepartmentUsers: [...departmentsByUser.values()].filter(departments => departments.size > 1).length,
    inactiveMemberships,
    membershipUsersMissingFromAuth,
    activePlatformAdministrators: platformAdministratorIds.size,
    platformAdministratorsMissingFromAuth: [...platformAdministratorIds].filter(id => !userIds.has(id)).length,
    platformAdministratorsWithNoMembership: [...platformAdministratorIds].filter(id => !departmentsByUser.has(id)).length,
    platformAdministratorsWithOnlyInactiveMembership: [...platformAdministratorIds].filter(id => departmentsByUser.has(id) && !activeDepartmentsByUser.has(id)).length,
    duplicateEmailGroups: duplicateEmailGroups.length,
    duplicateEmailUsers: duplicateEmailGroups.reduce((sum, count) => sum + count, 0),
  };
}

export function createProductionSourceInventory(input, generatedAt = new Date().toISOString()) {
  assert.equal(input.projectRef, PROJECT_REF_VALUE);
  assert.ok(Number.isFinite(Date.parse(generatedAt)));
  assert.ok(Array.isArray(input.database.exposedRelations) && input.database.exposedRelations.every(item => /^[a-z][a-z0-9_]*$/.test(item.name) && ((Number.isSafeInteger(item.rowCount) && item.rowCount >= 0 && item.countStatus === "exact") || (item.rowCount === null && /^http-[45]\d\d$/.test(item.countStatus)))));
  assert.equal(input.database.exposedRelations.length, new Set(input.database.exposedRelations.map(item => item.name)).size);
  assert.ok(Number.isSafeInteger(input.database.totalRows) && input.database.totalRows === input.database.exposedRelations.reduce((sum, item) => sum + (item.rowCount ?? 0), 0));
  assert.equal(input.database.exactCountComplete, input.database.exposedRelations.every(item => item.countStatus === "exact"));
  assert.equal(input.migrationLineage.localCount, 76);
  assert.ok(input.migrationLineage.remoteCount > 0 && input.migrationLineage.remoteCount <= 76);
  assert.deepEqual(input.migrationLineage.unexpectedInProduction, []);
  assert.ok(Array.isArray(input.storage.buckets));
  assert.equal(input.storage.totalObjects, input.storage.buckets.reduce((sum, bucket) => sum + bucket.objectCount, 0));
  assert.equal(input.storage.totalBytes, input.storage.buckets.reduce((sum, bucket) => sum + bucket.totalBytes, 0));
  assert.ok(input.identity.total >= 0 && input.identity.confirmed + input.identity.unconfirmed === input.identity.total);
  assert.equal(input.identityTransition.cohortUsers, input.identity.total);
  assert.equal(input.identityTransition.usersWithActiveMembership + input.identityTransition.usersWithOnlyInactiveMembership + input.identityTransition.usersWithNoMembership, input.identity.total);
  assert.match(input.identityTransition.cohortUserSetSha256, /^[0-9a-f]{64}$/);
  assert.match(input.identityTransition.membershipLinkSetSha256, /^[0-9a-f]{64}$/);
  const payload = {
    format: "tracepoint-production-source-inventory/v1",
    generatedAt,
    source: { provider: "supabase", projectRef: input.projectRef, region: "us-east-1", accessMode: "read-only" },
    database: input.database,
    migrationLineage: input.migrationLineage,
    identity: input.identity,
    identityTransition: input.identityTransition,
    storage: input.storage,
    privacy: { credentialsEmitted: false, recordContentsEmitted: false, emailsEmitted: false, userIdsEmitted: false, objectKeysEmitted: false },
  };
  return { ...payload, contentSha256: sha256(payload) };
}

export const productionProjectRef = PROJECT_REF_VALUE;
