import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MIGRATION_RELATIONS, PRIOR_IDENTITIES, PRIOR_MEMBERSHIPS, PRIOR_OBJECT_BYTES, PRIOR_OBJECTS, PRIOR_TOTAL_ROWS, PROJECT_URL, RUN_ID, AUTHORIZATION_REFERENCE, assertReadOnlyRequest, canonical, relationUrl, sha256, usersUrl, validateSourceSecret } from "./supabase-rest-ledger-core.mjs";

export const TARGET_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/database/migrator-8X57JT";
export const TARGET_HOST = "tracepoint-production.c8r4sgs089tu.us-east-1.rds.amazonaws.com";
export const TARGET_DATABASE = "tracepoint";
export const TARGET_BUCKET = "tracepoint-production-private-193644343389";
export const TARGET_ACCOUNT = "193644343389";
export const COPY_RELATIONS = Object.freeze(MIGRATION_RELATIONS.filter(name => !name.startsWith("v_")));
export const DERIVED_RELATIONS = Object.freeze(MIGRATION_RELATIONS.filter(name => name.startsWith("v_")));
export const TARGET_SEEDED_REFERENCE_RELATIONS = Object.freeze(["feature_catalog"]);
export const IMPORT_RELATIONS = Object.freeze(COPY_RELATIONS.filter(name => !TARGET_SEEDED_REFERENCE_RELATIONS.includes(name)));
export const OBJECT_MANIFEST = Object.freeze([
  { sourceBucket: "department-assets", sourceKey: "1d0e2994-4224-4237-8328-71020ba20027/patch-1787431778595.jpg", destinationKey: "department-assets/1d0e2994-4224-4237-8328-71020ba20027/patch-1787431778595.jpg", bytes: 5030, sha256: "8f82fca7c0da9d2fbbb9c11a2f0b88ee6fc4c3dc51e7d9b6a72f493473bc9422", contentType: "image/jpeg", departmentId: "1d0e2994-4224-4237-8328-71020ba20027" },
  { sourceBucket: "department-assets", sourceKey: "d01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0/patch-1782439034425.png", destinationKey: "department-assets/d01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0/patch-1782439034425.png", bytes: 517948, sha256: "04f20e6c0c4d783230f484830a3169bf9fd956f12d6b42e729504340ef202ea2", contentType: "image/png", departmentId: "d01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0" },
]);
// `created_at` is populated by the bootstrap migration's `default now()` and is
// therefore environment-generated rather than source-authoritative.  No other
// feature-catalog field is excluded from the semantic comparison.
export const FEATURE_CATALOG_NON_AUTHORITATIVE_COLUMNS = Object.freeze(["created_at"]);
export const FEATURE_CATALOG_TARGET_OWNED_COLUMNS = Object.freeze(["display_name", "description", "sort_order", "created_at"]);

const identifier = /^[a-z][a-z0-9_]*$/;
export const quote = value => { assert.match(value, identifier, "Unsafe SQL identifier"); return `\"${value}\"`; };
export const objectManifestSha256 = sha256(OBJECT_MANIFEST.map(({ sourceBucket, sourceKey, bytes, sha256: digest }) => ({ bucket: sourceBucket, sourceKey, size: bytes, sha256: digest })));

export function validateImportInvocation(env, mode) {
  assert.equal(env.TRACEPOINT_MIGRATION_RUN_ID, RUN_ID, "Approved migration run ID is required");
  assert.equal(env.TRACEPOINT_MIGRATION_AUTHORIZATION_REFERENCE, AUTHORIZATION_REFERENCE, "Approved authorization reference is required");
  assert.equal(env.TRACEPOINT_EXPECTED_AWS_ACCOUNT, TARGET_ACCOUNT, "Production account is required");
  assert.equal(env.SOURCE_SUPABASE_REST_SECRET_ARN, "arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/migration/source-supabase-rest-wvh4pi", "Only the dedicated REST source secret is permitted");
  assert.equal(env.TRACEPOINT_REST_IMPORT_MODE, mode, "Explicit reviewed import mode is required");
  if (mode === "database" || mode === "reconcile" || mode === "schema-contract") {
    assert.equal(env.TARGET_DATABASE_SECRET_ARN, TARGET_SECRET_ARN, "Only the reviewed target migrator secret is permitted");
    assert.equal(env.TARGET_PGHOST, TARGET_HOST, "Only the reviewed RDS target is permitted");
    assert.equal(env.TARGET_PGDATABASE, TARGET_DATABASE, "Only the reviewed RDS database is permitted");
  } else assert.equal(env.TRACEPOINT_TARGET_BUCKET, TARGET_BUCKET, "Only the reviewed production private bucket is permitted");
}

function sortedFeatureRows(rows) {
  assert.ok(Array.isArray(rows));
  const codes = new Set();
  return [...rows].map(row => {
    assert.ok(row && typeof row === "object" && !Array.isArray(row), "FEATURE_CATALOG_ROW_INVALID");
    assert.equal(typeof row.code, "string", "FEATURE_CATALOG_CODE_INVALID");
    assert.ok(/^[a-z][a-z0-9_]*$/.test(row.code), "FEATURE_CATALOG_CODE_INVALID");
    assert.equal(codes.has(row.code), false, "FEATURE_CATALOG_DUPLICATE_CODE"); codes.add(row.code);
    return row;
  }).sort((left, right) => left.code.localeCompare(right.code));
}

function semanticFeatureRow(row) {
  return Object.fromEntries(Object.entries(row).filter(([column]) => !FEATURE_CATALOG_NON_AUTHORITATIVE_COLUMNS.includes(column)));
}

export function reconcileFeatureCatalog(sourceRows, targetRows, targetColumns) {
  const source = sortedFeatureRows(sourceRows), target = sortedFeatureRows(targetRows);
  assert.ok(Array.isArray(targetColumns) && targetColumns.every(column => identifier.test(column)), "FEATURE_CATALOG_TARGET_COLUMNS_INVALID");
  const sourceByCode = new Map(source.map(row => [row.code, row]));
  const targetByCode = new Map(target.map(row => [row.code, row]));
  const rows = [...new Set([...sourceByCode.keys(), ...targetByCode.keys()])].sort().map(code => {
    const sourceRow = sourceByCode.get(code), targetRow = targetByCode.get(code);
    if (!sourceRow) return { code, classification: "target-only-code-invariant-failure", differingColumns: [], isActiveParity: null, sourceCanonicalSha256: null, targetCanonicalSha256: sha256(targetRow) };
    if (!targetRow) return { code, classification: "source-only-code-invariant-failure", differingColumns: [], isActiveParity: null, sourceCanonicalSha256: sha256(sourceRow), targetCanonicalSha256: null };
    const columns = [...new Set([...Object.keys(sourceRow), ...Object.keys(targetRow)])].sort();
    const differingColumns = columns.filter(column => canonical(sourceRow[column]) !== canonical(targetRow[column]));
    assert.equal(typeof sourceRow.is_active, "boolean", "FEATURE_CATALOG_SOURCE_ACTIVE_INVALID");
    assert.equal(typeof targetRow.is_active, "boolean", "FEATURE_CATALOG_TARGET_ACTIVE_INVALID");
    const isActiveParity = sourceRow.is_active === targetRow.is_active;
    const nonTargetOwnedDifferences = differingColumns.filter(column => !FEATURE_CATALOG_TARGET_OWNED_COLUMNS.includes(column));
    return {
      code,
      classification: isActiveParity && nonTargetOwnedDifferences.length === 0 ? "target-seeded reference data — excluded by design" : "target-seeded-reference-invariant-failure",
      differingColumns,
      isActiveParity,
      sourceCanonicalSha256: sha256(sourceRow),
      targetCanonicalSha256: sha256(targetRow),
    };
  });
  const sourceSemantic = source.map(semanticFeatureRow), targetSemantic = target.map(semanticFeatureRow);
  return {
    relation: "feature_catalog", stableIdentifier: "code", sourceCount: source.length, targetCount: target.length,
    sourceCanonicalSha256: sha256(source), targetCanonicalSha256: sha256(target),
    semanticCanonicalSha256: { source: sha256(sourceSemantic), target: sha256(targetSemantic) },
    excludedNonAuthoritativeColumns: [...FEATURE_CATALOG_NON_AUTHORITATIVE_COLUMNS], targetOwnedBootstrapColumns: [...FEATURE_CATALOG_TARGET_OWNED_COLUMNS], targetColumns: [...targetColumns].sort(), rows,
    hasSourceOnlyRows: rows.some(row => row.classification === "source-only-code-invariant-failure"),
    hasTargetOnlyRows: rows.some(row => row.classification === "target-only-code-invariant-failure"),
    hasActiveStateMismatch: rows.some(row => row.isActiveParity === false),
    hasInvariantFailure: rows.some(row => row.classification !== "target-seeded reference data — excluded by design"),
  };
}

export function requireTargetSeededFeatureCatalogParity(reconciliation) {
  assert.equal(reconciliation.relation, "feature_catalog");
  assert.equal(reconciliation.hasSourceOnlyRows, false, "TARGET_SEEDED_FEATURE_CATALOG_SOURCE_ONLY_CODE");
  assert.equal(reconciliation.hasTargetOnlyRows, false, "TARGET_SEEDED_FEATURE_CATALOG_TARGET_ONLY_CODE");
  assert.equal(reconciliation.hasActiveStateMismatch, false, "TARGET_SEEDED_FEATURE_CATALOG_ACTIVE_STATE_MISMATCH");
  assert.equal(reconciliation.hasInvariantFailure, false, "TARGET_SEEDED_FEATURE_CATALOG_INVARIANT_FAILURE");
  return reconciliation;
}

export function validateTargetSecret(value) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Target secret must be an object");
  for (const key of ["host", "port", "dbname", "username", "password"]) assert.ok(value[key] !== undefined && value[key] !== "", `Target secret missing ${key}`);
  assert.equal(value.host, TARGET_HOST, "Target secret RDS host differs");
  assert.equal(Number(value.port), 5432, "Target secret port differs");
  assert.equal(value.dbname, TARGET_DATABASE, "Target secret database differs");
  return { host: value.host, port: Number(value.port), database: value.dbname, user: value.username, password: value.password };
}

export function sourceHeaders(raw) {
  const source = validateSourceSecret(raw);
  const headers = Object.freeze({ apikey: source.serviceRoleKey, Authorization: `Bearer ${source.serviceRoleKey}`, Accept: "application/json" });
  source.serviceRoleKey = undefined;
  return headers;
}

export async function sourceGet(fetcher, headers, url, label) {
  assertReadOnlyRequest("GET", url);
  const response = await fetcher(url, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`SOURCE_REST_GET_FAILED:${label}:${response.status}`);
  return response.json();
}

export async function allRelationRows(fetcher, headers, relation) {
  assert.ok(COPY_RELATIONS.includes(relation) || DERIVED_RELATIONS.includes(relation), "Unapproved source relation");
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await sourceGet(fetcher, headers, relationUrl(relation, offset), relation);
    assert.ok(Array.isArray(page), "Source relation response is not an array");
    rows.push(...page);
    if (page.length < 500) return rows;
    assert.ok(rows.length <= 1_000_000, "Source relation exceeds safety bound");
  }
}

export async function allAdminUsers(fetcher, headers) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const payload = await sourceGet(fetcher, headers, usersUrl(page), "admin-identities");
    assert.ok(Array.isArray(payload.users), "Source identities response is invalid");
    users.push(...payload.users);
    if (payload.users.length < 200 || (payload.last_page && page >= payload.last_page)) return users;
    assert.ok(users.length <= 1_000_000, "Source identity count exceeds safety bound");
  }
}

export function sourceColumns(rows) {
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))].sort();
  assert.ok(columns.every(column => identifier.test(column)), "Source relation has an unsafe column");
  assert.ok(rows.every(row => row && typeof row === "object" && !Array.isArray(row) && Object.keys(row).every(key => columns.includes(key))), "Source row is invalid");
  return columns;
}

export function summarizeSourceColumn(rows, column) {
  assert.ok(Array.isArray(rows) && identifier.test(column));
  const values = rows.map(row => row[column]);
  const populated = values.filter(value => value !== null && value !== undefined);
  const typeCounts = Object.fromEntries(populated.reduce((counts, value) => {
    const type = Array.isArray(value) ? "array" : typeof value;
    counts.set(type, (counts.get(type) ?? 0) + 1); return counts;
  }, new Map()).entries());
  return { sourceColumn: column, rowCount: rows.length, populatedRowCount: populated.length, nullOrMissingRowCount: rows.length - populated.length, distinctValueCount: new Set(populated.map(canonical)).size, observedJsonTypeCounts: typeCounts };
}

export function classifyTargetOnlyColumn(column) {
  assert.ok(column && typeof column === "object" && identifier.test(column.column_name));
  if (column.is_identity || column.column_default !== null) return "TARGET_DEFAULTED";
  if (column.is_nullable === "NO") return "REQUIRED_IMPORT_VALUE";
  return "UNKNOWN_CONFLICT";
}

export function validateColumnMapping(relation, rows, targetColumns) {
  assert.ok(IMPORT_RELATIONS.includes(relation), "Unapproved import relation");
  const source = sourceColumns(rows);
  const target = new Map(targetColumns.map(column => [column.column_name, column]));
  assert.ok(source.every(column => target.has(column)), `SOURCE_TARGET_COLUMN_MISMATCH:${relation}`);
  // Empty source relations require no INSERT. Their target shape is still
  // recorded, but an unavailable row cannot prove a value mapping for a
  // required column that will not be written in this initial copy.
  if (rows.length) for (const column of targetColumns) if (column.is_nullable === "NO" && column.column_default === null && !column.is_identity && !source.includes(column.column_name)) throw new Error(`REQUIRED_TARGET_COLUMN_UNMAPPED:${relation}:${column.column_name}`);
  return { relation, sourceColumns: source, targetColumns: targetColumns.map(column => column.column_name).sort(), mapping: Object.fromEntries(source.map(column => [column, column])) };
}

export function topologicalImportOrder(relations, foreignKeys) {
  const nodes = new Set(relations); const incoming = new Map(relations.map(name => [name, new Set()])); const outgoing = new Map(relations.map(name => [name, new Set()]));
  for (const { child, parent } of foreignKeys) if (nodes.has(child) && nodes.has(parent) && child !== parent) { incoming.get(child).add(parent); outgoing.get(parent).add(child); }
  const ready = [...relations.filter(name => incoming.get(name).size === 0)].sort(); const order = [];
  while (ready.length) { const current = ready.shift(); order.push(current); for (const child of [...outgoing.get(current)].sort()) { incoming.get(child).delete(current); if (incoming.get(child).size === 0) { ready.push(child); ready.sort(); } } }
  if (order.length !== relations.length) throw new Error("TARGET_FOREIGN_KEY_CYCLE");
  return order;
}

export function insertSql(relation, columns) {
  assert.ok(IMPORT_RELATIONS.includes(relation)); assert.ok(columns.length > 0 && columns.every(column => identifier.test(column)));
  const list = columns.map(quote).join(",");
  return `insert into public.${quote(relation)} (${list}) select ${list} from json_populate_record(null::public.${quote(relation)},$1::json)`;
}

export function targetRowsSql(relation, columns, orderColumns) {
  assert.ok(MIGRATION_RELATIONS.includes(relation)); assert.ok(columns.every(column => identifier.test(column))); assert.ok(orderColumns.every(column => identifier.test(column)));
  return `select to_jsonb(t) as row from public.${quote(relation)} t order by ${orderColumns.map(quote).join(",")}`;
}

export function canonicalRowsHash(rows) { return sha256(rows); }
export function importEvidence({ mappings, sourceTables, targetTables, identities, memberships }) {
  const total = sourceTables.reduce((sum, table) => sum + table.rows, 0);
  assert.equal(total, PRIOR_TOTAL_ROWS, "Fresh source total differs from approved inventory");
  assert.equal(identities.count, PRIOR_IDENTITIES, "Fresh identity count differs from approved inventory");
  assert.equal(memberships.count, PRIOR_MEMBERSHIPS, "Fresh membership count differs from approved inventory");
  return { format: "tracepoint-rest-rds-import-evidence/v1", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, mappings, sourceTables, targetTables, totalRelationalRows: total, identities, memberships, objects: { count: PRIOR_OBJECTS, totalBytes: PRIOR_OBJECT_BYTES, manifestSha256: objectManifestSha256 }, masterSha256: sha256({ mappings, sourceTables, targetTables, totalRelationalRows: total, identities, memberships }) };
}

export function sourceObjectUrl(object) {
  assert.ok(OBJECT_MANIFEST.includes(object), "Object is outside the approved manifest");
  return `${PROJECT_URL}/storage/v1/object/${object.sourceBucket}/${object.sourceKey.split("/").map(encodeURIComponent).join("/")}`;
}

export function validateObjectBytes(object, bytes) {
  assert.ok(bytes instanceof Uint8Array, "Object bytes are required"); assert.equal(bytes.byteLength, object.bytes, "SOURCE_OBJECT_SIZE_MISMATCH"); assert.equal(createHash("sha256").update(bytes).digest("hex"), object.sha256, "SOURCE_OBJECT_SHA256_MISMATCH"); return true;
}

export function migrationSummary(tables, users) {
  const total = tables.reduce((sum, rows) => sum + rows.length, 0);
  assert.equal(total, PRIOR_TOTAL_ROWS, "SOURCE_TOTAL_ROW_MISMATCH");
  assert.equal(users.length, PRIOR_IDENTITIES, "SOURCE_IDENTITY_COUNT_MISMATCH");
  const memberships = tables[COPY_RELATIONS.indexOf("department_memberships")]; assert.equal(memberships.length, PRIOR_MEMBERSHIPS, "SOURCE_MEMBERSHIP_COUNT_MISMATCH");
  return { total, identities: users.length, memberships: memberships.length, masterSha256: sha256({ tables: COPY_RELATIONS.map((name, index) => ({ name, rows: tables[index].length, sha256: canonicalRowsHash(tables[index]) })), users: canonicalRowsHash(users) }) };
}
