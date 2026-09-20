import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { AUTHORIZATION_REFERENCE, MIGRATION_RELATIONS, PROJECT_URL, RELATION_ORDER_COLUMNS, RUN_ID, canonical, sha256 } from "./supabase-rest-ledger-core.mjs";
import { COPY_RELATIONS, DERIVED_RELATIONS, OBJECT_MANIFEST, TARGET_ACCOUNT, TARGET_BUCKET, allAdminUsers, allRelationRows, canonicalRowsHash, importEvidence, insertSql, reconcileFeatureCatalog, sourceHeaders, sourceObjectUrl, targetRowsSql, topologicalImportOrder, validateColumnMapping, validateImportInvocation, validateObjectBytes, validateTargetSecret } from "./supabase-rest-import-core.mjs";

const mode = process.env.TRACEPOINT_REST_IMPORT_MODE;
assert.ok(mode === "database" || mode === "objects" || mode === "reconcile", "A reviewed database, objects, or reconciliation mode is required");
validateImportInvocation(process.env, mode);
const rawSource = process.env.SOURCE_SUPABASE_REST_SECRET_JSON;
delete process.env.SOURCE_SUPABASE_REST_SECRET_JSON;
assert.ok(rawSource, "Dedicated source REST secret was not injected");
const headers = sourceHeaders(JSON.parse(rawSource));

function safeError(error, phase) { const message=error instanceof Error?error.message:""; const detail=/^[A-Z_]+(?::[a-z0-9_]+)?$/.test(message)?message:undefined; return { status: "FAILED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mode, phase, errorName: error instanceof Error ? error.name : "Error", errorCode: typeof error === "object" && error && "code" in error ? String(error.code) : undefined, detail }; }
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
async function targetRelationKinds(client) { return new Map((await client.query("select c.relname as name,c.relkind as kind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])", [MIGRATION_RELATIONS])).rows.map(row => [row.name, row.kind])); }
async function targetForeignKeys(client) { return (await client.query("select child.relname as child,parent.relname as parent from pg_constraint fk join pg_class child on child.oid=fk.conrelid join pg_namespace cn on cn.oid=child.relnamespace join pg_class parent on parent.oid=fk.confrelid join pg_namespace pn on pn.oid=parent.relnamespace where fk.contype='f' and cn.nspname='public' and pn.nspname='public'")).rows; }
async function targetRows(client, relation, columns) { const order = RELATION_ORDER_COLUMNS[relation] ?? ["id"]; return (await client.query(targetRowsSql(relation, columns, order))).rows.map(item => item.row); }
async function preflightTarget(client, snapshot) {
  const kinds = await targetRelationKinds(client);
  for (const relation of COPY_RELATIONS) assert.equal(kinds.get(relation), "r", `TARGET_TABLE_MISSING:${relation}`);
  for (const relation of DERIVED_RELATIONS) assert.equal(kinds.get(relation), "v", `TARGET_VIEW_MISSING:${relation}`);
  const mappings = []; const targetBefore = new Map();
  for (const relation of COPY_RELATIONS) {
    const rows = snapshot.rows.get(relation) ?? []; const mapping = validateColumnMapping(relation, rows, await queryColumns(client, relation));
    const existing = await targetRows(client, relation, mapping.sourceColumns);
    if (existing.length && canonicalRowsHash(existing) !== canonicalRowsHash(rows)) throw new Error(`TARGET_UNEXPLAINED_ROWS:${relation}`);
    mappings.push(mapping); targetBefore.set(relation, existing.length);
  }
  const authUsers = Number((await client.query("select count(*)::int as count from auth.users")).rows[0].count);
  if (authUsers !== 0 && authUsers !== snapshot.users.length) throw new Error("TARGET_UNEXPLAINED_IDENTITY_ANCHORS");
  const lineage = Number((await client.query("select count(*)::int as count from tracepoint_migrations.applied_migrations")).rows[0].count);
  assert.equal(lineage, 97, "TARGET_MIGRATION_LINEAGE_MISMATCH");
  return { mappings, targetBefore, authUsers, order: topologicalImportOrder(COPY_RELATIONS, await targetForeignKeys(client)) };
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
async function importRelation(client, relation, rows, mapping, alreadyPresent) {
  if (alreadyPresent) return { relation, imported: 0, resumed: rows.length };
  if (!rows.length) return { relation, imported: 0, resumed: 0 };
  const sql = insertSql(relation, mapping.sourceColumns);
  for (let start = 0; start < rows.length; start += 200) {
    await client.query("begin");
    try { for (const row of rows.slice(start, start + 200)) await client.query(sql, [JSON.stringify(row)]); await client.query("commit"); }
    catch (error) { await client.query("rollback"); throw error; }
  }
  return { relation, imported: rows.length, resumed: 0 };
}
async function repairSequences(client) {
  await client.query("do $repair$ declare item record; begin for item in select n.nspname as schemaname,c.relname as tablename,a.attname as columnname from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped and pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),a.attname) is not null loop execute format('select setval(pg_get_serial_sequence(%L,%L),coalesce((select max(%I) from %I.%I),1),true)',item.schemaname||'.'||item.tablename,item.columnname,item.columnname,item.schemaname,item.tablename); end loop; end $repair$");
}
async function verifyDatabase(client, snapshot, preflight) {
  const sourceTables = []; const targetTables = [];
  for (const relation of COPY_RELATIONS) {
    const mapping = preflight.mappings.find(item => item.relation === relation); const sourceRows = snapshot.rows.get(relation) ?? []; const target = await targetRows(client, relation, mapping.sourceColumns);
    assert.equal(target.length, sourceRows.length, `TARGET_ROW_COUNT_MISMATCH:${relation}`); assert.equal(canonicalRowsHash(target), canonicalRowsHash(sourceRows), `TARGET_ROW_HASH_MISMATCH:${relation}`);
    sourceTables.push({ name: relation, rows: sourceRows.length, canonicalDataSha256: canonicalRowsHash(sourceRows) }); targetTables.push({ name: relation, rows: target.length, canonicalDataSha256: canonicalRowsHash(target) });
  }
  for (const relation of DERIVED_RELATIONS) {
    const sourceRows = snapshot.rows.get(relation) ?? []; const columns = sourceRows.length ? Object.keys(sourceRows[0]).sort() : (RELATION_ORDER_COLUMNS[relation] ?? ["id"]); const target = await targetRows(client, relation, columns);
    assert.equal(target.length, sourceRows.length, `TARGET_VIEW_ROW_COUNT_MISMATCH:${relation}`); assert.equal(canonicalRowsHash(target), canonicalRowsHash(sourceRows), `TARGET_VIEW_HASH_MISMATCH:${relation}`);
    sourceTables.push({ name: relation, rows: sourceRows.length, canonicalDataSha256: canonicalRowsHash(sourceRows) }); targetTables.push({ name: relation, rows: target.length, canonicalDataSha256: canonicalRowsHash(target) });
  }
  const invalidForeignKeys = Number((await client.query("select count(*)::int as count from pg_constraint where contype='f' and not convalidated")).rows[0].count); assert.equal(invalidForeignKeys, 0, "TARGET_INVALID_FOREIGN_KEYS");
  const memberships = snapshot.rows.get("department_memberships") ?? [];
  return importEvidence({ mappings: preflight.mappings.map(({ relation, mapping }) => ({ relation, mapping })), sourceTables, targetTables, identities: { count: snapshot.users.length, canonicalDataSha256: canonicalRowsHash(snapshot.users) }, memberships: { count: memberships.length, canonicalDataSha256: canonicalRowsHash(memberships) } });
}
async function runDatabase() {
  const rawTarget = process.env.TARGET_DATABASE_SECRET_JSON; delete process.env.TARGET_DATABASE_SECRET_JSON; assert.ok(rawTarget, "Target migrator secret was not injected");
  const target = validateTargetSecret(JSON.parse(rawTarget)); const ca = await readFile("/app/rds-ca.pem", "utf8"); const client = new pg.Client({ ...target, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 15_000, statement_timeout: 60_000, application_name: "tracepoint-rest-initial-import" });
  let phase = "source snapshot";
  try { const snapshot = await sourceSnapshot(); phase = "target TLS preflight"; await client.connect(); const preflight = await preflightTarget(client, snapshot); phase = "identity anchors"; await insertIdentityAnchors(client, snapshot.users); phase = "relational import"; const results = []; for (const relation of preflight.order) results.push(await importRelation(client, relation, snapshot.rows.get(relation) ?? [], preflight.mappings.find(item => item.relation === relation), preflight.targetBefore.get(relation) > 0)); phase = "target sequence repair"; await repairSequences(client); phase = "target reconciliation"; const evidence = await verifyDatabase(client, snapshot, preflight); console.log(JSON.stringify({ status: "PASSED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mode, sourceReadOnly: true, targetWriteScope: "approved-initial-import", importedRelations: results, evidence, targetClientsInitialized: true, cognitoClientsInitialized: false })); }
  catch (error) { console.error(JSON.stringify(safeError(error, phase))); process.exitCode = 1; } finally { await client.end().catch(() => undefined); }
}
async function runFeatureCatalogReconciliation() {
  const rawTarget = process.env.TARGET_DATABASE_SECRET_JSON; delete process.env.TARGET_DATABASE_SECRET_JSON; assert.ok(rawTarget, "Target migrator secret was not injected");
  const target = validateTargetSecret(JSON.parse(rawTarget)); const ca = await readFile("/app/rds-ca.pem", "utf8");
  const client = new pg.Client({ ...target, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 15_000, statement_timeout: 60_000, application_name: "tracepoint-feature-catalog-reconciliation" });
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
async function targetRowsForReconciliation(client, columns) { return (await client.query(targetRowsSql("feature_catalog", columns, ["code"]))).rows.map(item => item.row); }
function assertSourceObjectUrl(url, object) { const parsed = new URL(url); assert.equal(parsed.origin, PROJECT_URL); assert.equal(parsed.protocol, "https:"); assert.equal(parsed.pathname, `/storage/v1/object/${object.sourceBucket}/${object.sourceKey}`); }
async function fetchObject(object) { const url = sourceObjectUrl(object); assertSourceObjectUrl(url, object); const response = await fetch(url, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(30_000) }); if (!response.ok) throw new Error(`SOURCE_OBJECT_GET_FAILED:${response.status}`); const bytes = new Uint8Array(await response.arrayBuffer()); validateObjectBytes(object, bytes); return bytes; }
async function getTargetObject(s3, object) { try { const response = await s3.send(new GetObjectCommand({ Bucket: TARGET_BUCKET, Key: object.destinationKey, ExpectedBucketOwner: TARGET_ACCOUNT, ChecksumMode: "ENABLED" })); const bytes = new Uint8Array(await response.Body.transformToByteArray()); return bytes; } catch (error) { if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null; throw error; } }
async function runObjects() {
  const s3 = new S3Client({ region: "us-east-1", maxAttempts: 3 }); let phase = "object preflight";
  try { const results=[]; for (const object of OBJECT_MANIFEST) { assert.ok(object.destinationKey.startsWith(`department-assets/${object.departmentId}/`), "OBJECT_TENANT_SCOPE_MISMATCH"); let target = await getTargetObject(s3, object); if (target) { validateObjectBytes(object, target); results.push({ keySha256: sha256(object.destinationKey), status: "verified-existing", bytes: object.bytes, sha256: object.sha256 }); continue; } phase = "source object read"; const bytes = await fetchObject(object); phase = "create-only target write"; try { await s3.send(new PutObjectCommand({ Bucket: TARGET_BUCKET, Key: object.destinationKey, ExpectedBucketOwner: TARGET_ACCOUNT, Body: bytes, ContentLength: bytes.byteLength, ContentType: object.contentType, ChecksumSHA256: createHash("sha256").update(bytes).digest("base64"), IfNoneMatch: "*", Metadata: { "tracepoint-department-id": object.departmentId, "tracepoint-domain": "department-patch" } })); } catch (error) { if (error?.name !== "PreconditionFailed" && error?.$metadata?.httpStatusCode !== 412) throw error; } phase = "target object verification"; target = await getTargetObject(s3, object); assert.ok(target, "TARGET_OBJECT_MISSING_AFTER_CREATE"); validateObjectBytes(object, target); results.push({ keySha256: sha256(object.destinationKey), status: "created-and-verified", bytes: object.bytes, sha256: object.sha256 }); } console.log(JSON.stringify({ status: "PASSED", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mode, sourceReadOnly: true, objects: results, objectCount: OBJECT_MANIFEST.length, totalBytes: OBJECT_MANIFEST.reduce((total, object) => total + object.bytes, 0), targetBucket: TARGET_BUCKET, targetVersioningRequired: true, targetClientsInitialized: true, databaseClientsInitialized: false })); }
  catch (error) { console.error(JSON.stringify(safeError(error, phase))); process.exitCode = 1; } finally { s3.destroy(); }
}
await (mode === "database" ? runDatabase() : mode === "objects" ? runObjects() : runFeatureCatalogReconciliation());
