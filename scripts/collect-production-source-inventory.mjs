import assert from "node:assert/strict";
import { readdir, mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createProductionSourceInventory, exactCountFromHeaders, exposedRelations, reconcileMigrationVersions, productionProjectRef, summarizeIdentityTransition, summarizeIdentityUsers, validateProductionSourceEnvironment } from "./production-source-inventory-core.mjs";

const args = process.argv.slice(2);
assert.deepEqual(args.slice(0, 1), ["--output"], "Usage: node scripts/collect-production-source-inventory.mjs --output FILE");
assert.equal(args.length, 2, "Exactly one output path is required");
const environment = validateProductionSourceEnvironment(process.env);
const headers = { apikey: process.env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}` };
const client = createClient(environment.url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

async function count(pathname, query = "") {
  const response = await fetch(`${environment.url}rest/v1/${pathname}?select=*&limit=1${query}`, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { ...headers, Prefer: "count=exact", Range: "0-0" } });
  if (![200, 206].includes(response.status)) return { rowCount: null, countStatus: `http-${response.status}` };
  return { rowCount: exactCountFromHeaders(response.headers, pathname), countStatus: "exact" };
}

const openApiResponse = await fetch(`${environment.url}rest/v1/`, { redirect: "error", signal: AbortSignal.timeout(20_000), headers });
assert.equal(openApiResponse.status, 200, "Production OpenAPI inventory failed");
const relationNames = exposedRelations(await openApiResponse.json());
const relationCounts = [];
for (const name of relationNames) relationCounts.push({ name, ...await count(name) });

const membershipBreakdown = {};
if (relationNames.includes("department_memberships")) {
  for (const value of ["pending_activation", "activation_sent", "activated"]) membershipBreakdown[value] = (await count("department_memberships", `&activation_status=eq.${value}`)).rowCount;
  membershipBreakdown.active = (await count("department_memberships", "&is_active=eq.true")).rowCount;
  membershipBreakdown.inactive = (await count("department_memberships", "&is_active=eq.false")).rowCount;
}

async function readAggregateRows(relation, columns) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await client.from(relation).select(columns).range(offset, offset + 999);
    if (result.error) throw new Error(`Production aggregate inventory failed for ${relation}; values suppressed`);
    rows.push(...(result.data ?? []));
    if ((result.data ?? []).length < 1000) break;
    assert.ok(rows.length <= 1_000_000, `Production ${relation} inventory exceeds safety bound`);
  }
  return rows;
}

const memberships = relationNames.includes("department_memberships")
  ? await readAggregateRows("department_memberships", "user_id,department_id,is_active,activation_status")
  : [];
const platformAdministrators = relationNames.includes("platform_admins")
  ? await readAggregateRows("platform_admins", "user_id,is_active")
  : [];

const users = [];
for (let page = 1; page <= 10_000; page += 1) {
  const result = await client.auth.admin.listUsers({ page, perPage: 1000 });
  if (result.error) throw new Error("Production Auth inventory failed; response suppressed");
  users.push(...result.data.users);
  if (result.data.users.length < 1000 || (result.data.lastPage && page >= result.data.lastPage)) break;
  assert.ok(users.length <= 1_000_000, "Production Auth inventory exceeds safety bound");
}

const bucketResult = await client.storage.listBuckets();
if (bucketResult.error) throw new Error("Production Storage bucket inventory failed; response suppressed");
const buckets = [];
for (const bucket of [...bucketResult.data].sort((a, b) => a.name.localeCompare(b.name))) {
  let objectCount = 0;
  let totalBytes = 0;
  const directories = [""];
  const visited = new Set();
  while (directories.length) {
    const prefix = directories.pop();
    assert.equal(visited.has(prefix), false, "Production Storage inventory contains a directory cycle");
    visited.add(prefix);
    for (let offset = 0; ; offset += 100) {
      const listed = await client.storage.from(bucket.id).list(prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
      if (listed.error) throw new Error(`Production Storage metadata inventory failed for ${bucket.name}; values suppressed`);
      for (const item of listed.data ?? []) {
        assert.ok(item.name && !item.name.includes("/") && !item.name.includes("\\"), "Unsafe Storage metadata name");
        if (item.id) {
          const bytes = Number(item.metadata?.size ?? 0);
          assert.ok(Number.isSafeInteger(bytes) && bytes >= 0, "Invalid Storage object size");
          objectCount += 1;
          totalBytes += bytes;
        } else directories.push(prefix ? `${prefix}/${item.name}` : item.name);
      }
      if ((listed.data ?? []).length < 100) break;
    }
    assert.ok(objectCount <= 1_000_000 && directories.length <= 100_000, "Production Storage inventory exceeds safety bound");
  }
  buckets.push({ name: bucket.name, public: bucket.public === true, objectCount, totalBytes });
}

const migrationFiles = (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter(name => /^\d{8,14}_.+\.sql$/.test(name)).sort();
assert.equal(migrationFiles.length, 76);
const localVersions = migrationFiles.map(name => name.split("_")[0]);
const lineageEvidence = JSON.parse(await readFile(new URL("../docs/aws-production-source-lineage-20260912.json", import.meta.url), "utf8"));
assert.equal(lineageEvidence.projectRef, productionProjectRef);
assert.equal(lineageEvidence.readOnly, true);
assert.equal(lineageEvidence.command, `npx.cmd supabase migration list --project-ref ${productionProjectRef}`);
assert.ok(Number.isFinite(Date.parse(lineageEvidence.capturedAtUTC)));
const migrationLineage = { ...reconcileMigrationVersions(lineageEvidence.remoteVersions, localVersions), evidenceCapturedAtUTC: lineageEvidence.capturedAtUTC };
assert.ok(migrationLineage.remoteCount > 0, "Production migration lineage was unavailable");

const inventory = createProductionSourceInventory({
  projectRef: productionProjectRef,
  database: { exposedRelations: relationCounts, totalRows: relationCounts.reduce((sum, item) => sum + (item.rowCount ?? 0), 0), exactCountComplete: relationCounts.every(item => item.countStatus === "exact"), membershipBreakdown },
  migrationLineage,
  identity: summarizeIdentityUsers(users),
  identityTransition: summarizeIdentityTransition(users, memberships, platformAdministrators),
  storage: { buckets, totalObjects: buckets.reduce((sum, bucket) => sum + bucket.objectCount, 0), totalBytes: buckets.reduce((sum, bucket) => sum + bucket.totalBytes, 0) },
});
const output = path.resolve(args[1]);
await mkdir(path.dirname(output), { recursive: true });
const temporary = `${output}.${process.pid}.tmp`;
const handle = await open(temporary, "wx", 0o600);
try { await handle.writeFile(`${JSON.stringify(inventory, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
await rename(temporary, output);
console.log(JSON.stringify({ readOnly: true, projectRef: productionProjectRef, publicRelations: relationCounts.length, totalRows: inventory.database.totalRows, authIdentities: inventory.identity.total, storageBuckets: buckets.length, storageObjects: inventory.storage.totalObjects, remoteMigrations: inventory.migrationLineage.remoteCount, localMigrations: inventory.migrationLineage.localCount, contentSha256: inventory.contentSha256, sensitiveValuesEmitted: false }));
