import assert from "node:assert/strict";
import { MIGRATION_RELATIONS, PRIOR_OBJECT_BYTES, PRIOR_OBJECTS, assertReadOnlyRequest, canonical, relationUrl, sanitizedManifest, sha256, usersUrl, validateInvocation, validateSourceSecret } from "./supabase-rest-ledger-core.mjs";

validateInvocation(process.env);
const rawSecret = process.env.SOURCE_SUPABASE_REST_SECRET_JSON;
delete process.env.SOURCE_SUPABASE_REST_SECRET_JSON;
assert.ok(rawSecret, "Dedicated REST source credential was not injected");
const source = validateSourceSecret(JSON.parse(rawSecret));
// Do not retain a second plaintext reference once headers have been constructed.
const headers = Object.freeze({ apikey: source.serviceRoleKey, Authorization: `Bearer ${source.serviceRoleKey}`, Accept: "application/json" });
source.serviceRoleKey = undefined;

async function get(url, sourceLabel) {
  assertReadOnlyRequest("GET", url);
  const response = await fetch(url, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
  // Labels are fixed contract relation names only; response bodies remain unread
  // so malformed-query diagnosis cannot expose source records or credentials.
  if (!response.ok) throw new Error(`SOURCE_REST_GET_FAILED:${sourceLabel}:${response.status}`);
  return response.json();
}

async function allRows(relation) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await get(relationUrl(relation, offset), relation);
    assert.ok(Array.isArray(page), "Source relation response is not an array");
    rows.push(...page);
    if (page.length < 500) return rows;
    assert.ok(rows.length <= 1_000_000, "Source relation exceeds safe extraction bound");
  }
}

async function allUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const payload = await get(usersUrl(page), 'admin-identities');
    assert.ok(Array.isArray(payload.users), "Admin identities response is invalid");
    users.push(...payload.users);
    if (payload.users.length < 200 || (payload.last_page && page >= payload.last_page)) return users;
    assert.ok(users.length <= 1_000_000, "Source identities exceed safe extraction bound");
  }
}

const rowsByRelation = new Map();
for (const relation of MIGRATION_RELATIONS) rowsByRelation.set(relation, await allRows(relation));
const users = await allUsers();
const memberships = rowsByRelation.get("department_memberships") ?? [];
const manifest = sanitizedManifest({
  capturedAtUtc: new Date().toISOString(),
  tables: [...rowsByRelation].map(([name, rows]) => ({ name, rows: rows.length, canonicalDataSha256: sha256(rows) })),
  identities: { count: users.length, canonicalDataSha256: sha256(users) },
  memberships: { count: memberships.length, canonicalDataSha256: sha256(memberships) },
  // The separately verified immutable object manifest remains the object source of truth
  // in this source-only task; it deliberately initializes no Storage/S3 client.
  objectManifestSha256: "8cfcf70e4f9905de67d770a8af9714254e5f625ad3c3d219300aaafeaea4d780", objectCount: PRIOR_OBJECTS, objectBytes: PRIOR_OBJECT_BYTES,
});
const clean = manifest.comparison.delta === 0 && manifest.comparison.identityDelta === 0 && manifest.comparison.membershipDelta === 0;
console.log(JSON.stringify({ status: clean ? "SOURCE_RECONCILED" : "SOURCE_RECONCILIATION_MISMATCH", manifest, sourceRecordsEmitted: false, targetClientsInitialized: false }));
if (!clean) process.exitCode = 2;
