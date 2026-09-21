import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MIGRATION_RELATIONS, PRIOR_IDENTITIES, PRIOR_MEMBERSHIPS, PRIOR_OBJECT_BYTES, PRIOR_OBJECTS, PRIOR_TOTAL_ROWS, PROJECT_URL, RUN_ID, AUTHORIZATION_REFERENCE, assertReadOnlyRequest, canonical, relationUrl, sha256, usersUrl, validateSourceSecret } from "./supabase-rest-ledger-core.mjs";

export const TARGET_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/database/migrator-8X57JT";
export const TARGET_HOST = "tracepoint-production.c8r4sgs089tu.us-east-1.rds.amazonaws.com";
export const CLEAN_TARGET_HOST = "tracepoint-production-migration-clean-4272874f.c8r4sgs089tu.us-east-1.rds.amazonaws.com";
export const APPROVED_TARGET_HOSTS = Object.freeze([TARGET_HOST, CLEAN_TARGET_HOST]);
export const TARGET_DATABASE = "tracepoint";
export const TARGET_BUCKET = "tracepoint-production-private-193644343389";
export const TARGET_ACCOUNT = "193644343389";
export const COPY_RELATIONS = Object.freeze(MIGRATION_RELATIONS.filter(name => !name.startsWith("v_")));
export const DERIVED_RELATIONS = Object.freeze(MIGRATION_RELATIONS.filter(name => name.startsWith("v_")));
// These are product bootstrap catalogs, not department/customer records. Their
// source/target parity is mandatory before the importer excludes them.
export const TARGET_SEEDED_REFERENCE_RELATIONS = Object.freeze(["feature_catalog", "roles", "permissions", "role_permissions"]);
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
// These global defaults are deliberately target-owned.  Actual department
// grants live in department_role_permissions and remain migration data.
export const TARGET_SEEDED_ROLE_PERMISSION_SOURCE_ONLY = Object.freeze([
  { roleCode: "administrator", permissionCode: "manage_certifications" },
  { roleCode: "administrator", permissionCode: "manage_equipment" },
  { roleCode: "supervisor", permissionCode: "manage_certifications" },
  { roleCode: "supervisor", permissionCode: "manage_equipment" },
  { roleCode: "supervisor", permissionCode: "manage_training" },
]);
export const IDENTITY_PRESERVATION_RELATIONS = Object.freeze(["audit_events", "retired_permission_assignment_audit"]);

const identifier = /^[a-z][a-z0-9_]*$/;
export const quote = value => { assert.match(value, identifier, "Unsafe SQL identifier"); return `\"${value}\"`; };
export const objectManifestSha256 = sha256(OBJECT_MANIFEST.map(({ sourceBucket, sourceKey, bytes, sha256: digest }) => ({ bucket: sourceBucket, sourceKey, size: bytes, sha256: digest })));

export const SCHEMA_REPAIR_MODE = "schema-repair-firearm-assignments";
export const SCHEMA_SWEEP_MODE = "schema-contract-sweep";
export const TARGET_DATA_PREFLIGHT_MODE = "target-data-preflight";
export const ROLE_PERMISSIONS_RECONCILIATION_MODE = "role-permissions-reconciliation";
export const FOREIGN_KEY_CYCLE_DIAGNOSIS_MODE = "foreign-key-cycle-diagnosis";
export const TARGET_GENERATED_COLUMN_DIAGNOSTIC_MODE = "target-generated-column-diagnostic";
export const TARGET_PROVENANCE_SWEEP_MODE = "target-provenance-sweep";
export const AUDIT_IDENTITY_COLLISION_DIAGNOSTIC_MODE = "audit-identity-collision-diagnostic";
export const DATABASE_MODES = Object.freeze(["database", "reconcile", "schema-contract", SCHEMA_REPAIR_MODE, SCHEMA_SWEEP_MODE, TARGET_DATA_PREFLIGHT_MODE, ROLE_PERMISSIONS_RECONCILIATION_MODE, FOREIGN_KEY_CYCLE_DIAGNOSIS_MODE, TARGET_GENERATED_COLUMN_DIAGNOSTIC_MODE, TARGET_PROVENANCE_SWEEP_MODE, AUDIT_IDENTITY_COLLISION_DIAGNOSTIC_MODE]);

export function validateImportInvocation(env, mode) {
  assert.equal(env.TRACEPOINT_MIGRATION_RUN_ID, RUN_ID, "Approved migration run ID is required");
  assert.equal(env.TRACEPOINT_MIGRATION_AUTHORIZATION_REFERENCE, AUTHORIZATION_REFERENCE, "Approved authorization reference is required");
  assert.equal(env.TRACEPOINT_EXPECTED_AWS_ACCOUNT, TARGET_ACCOUNT, "Production account is required");
  assert.equal(env.SOURCE_SUPABASE_REST_SECRET_ARN, "arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/migration/source-supabase-rest-wvh4pi", "Only the dedicated REST source secret is permitted");
  assert.equal(env.TRACEPOINT_REST_IMPORT_MODE, mode, "Explicit reviewed import mode is required");
  if (DATABASE_MODES.includes(mode)) {
    assert.equal(env.TARGET_DATABASE_SECRET_ARN, TARGET_SECRET_ARN, "Only the reviewed target migrator secret is permitted");
    assert.ok(APPROVED_TARGET_HOSTS.includes(env.TARGET_PGHOST), "Only a reviewed RDS target is permitted");
    assert.equal(env.TARGET_PGDATABASE, TARGET_DATABASE, "Only the reviewed RDS database is permitted");
  } else assert.equal(env.TRACEPOINT_TARGET_BUCKET, TARGET_BUCKET, "Only the reviewed production private bucket is permitted");
}

// This guard is deliberately narrow. The generated-column diagnostic may read
// RDS metadata and source contracts, but it cannot submit a data-changing
// statement even if its implementation is later refactored.
export function assertDiagnosticReadOnlySql(sql) {
  assert.equal(typeof sql, "string", "Diagnostic SQL must be a string");
  const normalized = sql.trim().replace(/^\/\*[^]*?\*\/\s*/u, "").toLowerCase();
  assert.ok(/^(select|with|begin\s+transaction\s+isolation\s+level\s+repeatable\s+read\s+read\s+only|commit|rollback)\b/u.test(normalized), "DIAGNOSTIC_SQL_NOT_READ_ONLY");
  assert.doesNotMatch(normalized, /\b(insert|update|delete|merge|truncate|alter|create|drop|grant|revoke|call|do|copy|setval)\b/u, "DIAGNOSTIC_SQL_NOT_READ_ONLY");
  return sql;
}

export function classifyTargetGeneratedInput(relation, sourceStatistics, targetColumn, triggerNames = []) {
  assert.ok(MIGRATION_RELATIONS.includes(relation), "Diagnostic relation is not approved");
  assert.ok(sourceStatistics && identifier.test(sourceStatistics.sourceColumn), "Diagnostic source statistics are invalid");
  assert.ok(targetColumn && targetColumn.column_name === sourceStatistics.sourceColumn, "Diagnostic target column is invalid");
  assert.ok(Array.isArray(triggerNames) && triggerNames.every(name => typeof name === "string"), "Diagnostic trigger names are invalid");
  const isGenerated = targetColumn.is_generated === "ALWAYS";
  const isIdentityAlways = targetColumn.is_identity === "YES" && targetColumn.identity_generation === "ALWAYS";
  const hasDefault = targetColumn.column_default !== null && targetColumn.column_default !== undefined;
  const sequenceBacked = typeof targetColumn.sequence_name === "string" && targetColumn.sequence_name.length > 0;
  const migrationAnchorTimestamp = relation === "profiles" && ["created_at", "updated_at"].includes(targetColumn.column_name) && triggerNames.length > 0;
  const sourceHasValues = sourceStatistics.populatedRowCount > 0;
  const mustNotReceiveExplicitSourceValue = isGenerated || isIdentityAlways;
  let classification = null;
  if (migrationAnchorTimestamp) classification = "TARGET_GENERATED_EXCLUDE_FROM_IMPORT";
  else if (isGenerated) classification = "UNKNOWN_CONFLICT";
  else if (isIdentityAlways) classification = targetColumn.column_name === "id" && sourceHasValues ? "SOURCE_AUTHORITATIVE_MUST_PRESERVE" : "UNKNOWN_CONFLICT";
  return Object.freeze({
    relation,
    column: targetColumn.column_name,
    targetType: targetColumn.data_type,
    targetGeneration: Object.freeze({
      isIdentity: targetColumn.is_identity === "YES",
      identityGeneration: targetColumn.identity_generation ?? null,
      isGenerated: targetColumn.is_generated ?? "NEVER",
      generationExpression: targetColumn.generation_expression ?? null,
      defaultExpression: targetColumn.column_default ?? null,
      sequenceBacked,
      triggerNames: [...triggerNames].sort(),
    }),
    sourceStatistics,
    acceptsExplicitSourceValue: !mustNotReceiveExplicitSourceValue,
    classification,
  });
}

function bigintIdentity(value, errorCode) {
  const text = typeof value === "bigint" ? value.toString() : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value : null;
  assert.ok(text !== null && /^-?\d+$/u.test(text), errorCode);
  const parsed = BigInt(text);
  assert.ok(parsed >= -9223372036854775808n && parsed <= 9223372036854775807n, errorCode);
  return parsed;
}

export function identityPreservingInsertSql(relation, columns) {
  assert.ok(IDENTITY_PRESERVATION_RELATIONS.includes(relation), "IDENTITY_PRESERVATION_RELATION_NOT_ALLOWED");
  assert.ok(columns.includes("id"), "IDENTITY_PRESERVATION_ID_MISSING");
  assert.ok(columns.length > 0 && columns.every(column => identifier.test(column)), "IDENTITY_PRESERVATION_COLUMNS_INVALID");
  const list = columns.map(quote).join(",");
  return `insert into public.${quote(relation)} (${list}) overriding system value select ${list} from json_populate_record(null::public.${quote(relation)},$1::json)`;
}

export function requireIdentityPreservationPreflight(relation, sourceRows, targetRows, targetColumns) {
  assert.ok(IDENTITY_PRESERVATION_RELATIONS.includes(relation), "IDENTITY_PRESERVATION_RELATION_NOT_ALLOWED");
  assert.ok(Array.isArray(sourceRows) && Array.isArray(targetRows) && Array.isArray(targetColumns), "IDENTITY_PRESERVATION_PREFLIGHT_INVALID");
  const targetId = targetColumns.find(column => column.column_name === "id");
  assert.ok(targetId, "IDENTITY_PRESERVATION_ID_COLUMN_MISSING");
  assert.equal(targetId.data_type, "bigint", "IDENTITY_PRESERVATION_ID_TYPE_MISMATCH");
  assert.equal(targetId.is_identity, "YES", "IDENTITY_PRESERVATION_ID_NOT_IDENTITY");
  assert.equal(targetId.identity_generation, "ALWAYS", "IDENTITY_PRESERVATION_ID_NOT_ALWAYS");
  const sourceById = new Map();
  for (const row of sourceRows) {
    const id = bigintIdentity(row?.id, "SOURCE_ID_INVALID").toString();
    assert.equal(sourceById.has(id), false, "SOURCE_ID_DUPLICATE");
    sourceById.set(id, row);
  }
  const targetById = new Map();
  for (const row of targetRows) {
    const id = bigintIdentity(row?.id, "TARGET_ID_INVALID").toString();
    assert.equal(targetById.has(id), false, "TARGET_ID_DUPLICATE");
    assert.ok(sourceById.has(id), "TARGET_UNEXPLAINED_IDENTITY_ROW");
    assert.equal(canonical(row), canonical(sourceById.get(id)), "TARGET_ID_COLLISION");
    targetById.set(id, row);
  }
  return Object.freeze({ relation, sourceIdCount: sourceById.size, targetIdCount: targetById.size, targetIdentity: { dataType: targetId.data_type, identityGeneration: targetId.identity_generation }, allTargetRowsExplained: true, sourceIdsUnique: true });
}

export function verifyIdentitySequenceAdvance(relation, lastValue, maxImportedId) {
  assert.ok(IDENTITY_PRESERVATION_RELATIONS.includes(relation), "IDENTITY_PRESERVATION_RELATION_NOT_ALLOWED");
  const last = bigintIdentity(lastValue, "IDENTITY_SEQUENCE_VALUE_INVALID");
  const max = bigintIdentity(maxImportedId, "IDENTITY_SEQUENCE_MAX_INVALID");
  assert.ok(last >= max, "IDENTITY_SEQUENCE_BEHIND_IMPORTED_IDS");
  return Object.freeze({ relation, lastValue: last.toString(), maxImportedId: max.toString(), nextGeneratedIdCannotCollide: true });
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

export function reconcileExactTargetSeededRelation(relation, sourceRows, targetRows, stableColumns) {
  assert.ok(["roles", "permissions", "role_permissions"].includes(relation));
  assert.ok(Array.isArray(stableColumns) && stableColumns.length > 0 && stableColumns.every(column => identifier.test(column)));
  const normalize = rows => [...rows].map(row => {
    assert.ok(row && typeof row === "object" && !Array.isArray(row));
    assert.ok(stableColumns.every(column => row[column] !== null && row[column] !== undefined), "TARGET_SEEDED_STABLE_KEY_MISSING");
    return row;
  }).sort((left, right) => canonical(stableColumns.map(column => left[column])).localeCompare(canonical(stableColumns.map(column => right[column]))));
  const source = normalize(sourceRows), target = normalize(targetRows);
  const sourceKeys = source.map(row => stableColumns.map(column => row[column]));
  const targetKeys = target.map(row => stableColumns.map(column => row[column]));
  return { relation, stableColumns, sourceCount: source.length, targetCount: target.length, sourceStableKeySha256: sha256(sourceKeys), targetStableKeySha256: sha256(targetKeys), stableKeyParity: canonical(sourceKeys) === canonical(targetKeys), sourceCanonicalSha256: sha256(source), targetCanonicalSha256: sha256(target), canonicalParity: canonical(source) === canonical(target) };
}

export function requireExactTargetSeededParity(reconciliation) {
  assert.equal(reconciliation.stableKeyParity, true, `TARGET_SEEDED_STABLE_KEY_MISMATCH:${reconciliation.relation}`);
  assert.equal(reconciliation.canonicalParity, true, `TARGET_SEEDED_SEMANTIC_MISMATCH:${reconciliation.relation}`);
  return reconciliation;
}

// This is intentionally a diagnostic, not a merge policy.  Global role
// assignments determine authorization semantics, so any non-identical pair
// remains a hard stop until its provenance is separately reviewed.
export function reconcileRolePermissionDifferences(sourceRows, targetRows) {
  const keyFor = row => {
    assert.ok(row && typeof row === "object" && !Array.isArray(row), "ROLE_PERMISSION_ROW_INVALID");
    for (const column of ["role_code", "permission_code"]) {
      assert.equal(typeof row[column], "string", "ROLE_PERMISSION_STABLE_KEY_INVALID");
      assert.match(row[column], identifier, "ROLE_PERMISSION_STABLE_KEY_INVALID");
    }
    return `${row.role_code}\u0000${row.permission_code}`;
  };
  const byKey = rows => {
    const values = new Map();
    for (const row of rows) {
      const key = keyFor(row);
      assert.equal(values.has(key), false, "ROLE_PERMISSION_DUPLICATE_STABLE_KEY");
      values.set(key, { roleCode: row.role_code, permissionCode: row.permission_code });
    }
    return values;
  };
  const source = byKey(sourceRows), target = byKey(targetRows);
  const sort = values => [...values].sort((left, right) => canonical([left.roleCode, left.permissionCode]).localeCompare(canonical([right.roleCode, right.permissionCode])));
  const sourceOnly = sort([...source].filter(([key]) => !target.has(key)).map(([, value]) => value));
  const targetOnly = sort([...target].filter(([key]) => !source.has(key)).map(([, value]) => value));
  return Object.freeze({
    relation: "role_permissions",
    stableColumns: ["role_code", "permission_code"],
    sourceCount: source.size,
    targetCount: target.size,
    exactMatchCount: source.size - sourceOnly.length,
    sourceOnly,
    targetOnly,
    sourceStableKeySha256: sha256(sort([...source.values()])),
    targetStableKeySha256: sha256(sort([...target.values()])),
    stableKeyParity: sourceOnly.length === 0 && targetOnly.length === 0,
  });
}

export function requireTargetSeededRolePermissionRule(reconciliation) {
  assert.equal(reconciliation.relation, "role_permissions");
  assert.deepEqual(reconciliation.targetOnly, [], "TARGET_SEEDED_ROLE_PERMISSIONS_TARGET_ONLY");
  assert.deepEqual(reconciliation.sourceOnly, [...TARGET_SEEDED_ROLE_PERMISSION_SOURCE_ONLY], "TARGET_SEEDED_ROLE_PERMISSIONS_UNREVIEWED_SOURCE_ONLY");
  return Object.freeze({ ...reconciliation, classification: "target-seeded reference data — excluded by design", sourceOnlyRule: "reviewed legacy/global defaults; department_role_permissions remains source-authoritative" });
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

export function compareSourceColumns(rows, leftColumn, rightColumn) {
  assert.ok(Array.isArray(rows) && identifier.test(leftColumn) && identifier.test(rightColumn));
  const summary = { leftColumn, rightColumn, rowCount: rows.length, equalRowCount: 0, unequalRowCount: 0, bothPopulatedRowCount: 0, leftOnlyPopulatedRowCount: 0, rightOnlyPopulatedRowCount: 0, bothNullOrMissingRowCount: 0 };
  for (const row of rows) {
    const left = row[leftColumn], right = row[rightColumn], leftPresent = left !== null && left !== undefined, rightPresent = right !== null && right !== undefined;
    if (leftPresent && rightPresent) summary.bothPopulatedRowCount += 1;
    else if (leftPresent) summary.leftOnlyPopulatedRowCount += 1;
    else if (rightPresent) summary.rightOnlyPopulatedRowCount += 1;
    else summary.bothNullOrMissingRowCount += 1;
    if (canonical(left) === canonical(right)) summary.equalRowCount += 1; else summary.unequalRowCount += 1;
  }
  return summary;
}

export function classifyTargetOnlyColumn(column) {
  assert.ok(column && typeof column === "object" && identifier.test(column.column_name));
  if (column.is_identity || column.column_default !== null) return "TARGET_DEFAULTED";
  if (column.is_nullable === "NO") return "REQUIRED_IMPORT_VALUE";
  return "UNKNOWN_CONFLICT";
}

export function classifySourceOnlyColumn(relation, column, statistics) {
  assert.ok(MIGRATION_RELATIONS.includes(relation) && identifier.test(column));
  assert.ok(statistics && statistics.sourceColumn === column);
  // This source field is populated on every live row and differs from
  // magazines_issued on two rows. It cannot be dropped or coalesced.
  if (relation === "firearm_assignments" && column === "magazines_expected_return") return "TARGET_SCHEMA_MISSING_COLUMN";
  return "UNKNOWN_CONFLICT";
}

export const FIREARM_ASSIGNMENTS_SCHEMA_REPAIR = Object.freeze({
  relation: "firearm_assignments",
  column: "magazines_expected_return",
  constraint: "firearm_assignments_magazines_expected_return_nonnegative",
  statements: Object.freeze([
    "ALTER TABLE public.firearm_assignments ADD COLUMN magazines_expected_return integer",
    "ALTER TABLE public.firearm_assignments ADD CONSTRAINT firearm_assignments_magazines_expected_return_nonnegative CHECK (magazines_expected_return IS NULL OR magazines_expected_return >= 0) NOT VALID",
  ]),
});

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

export function foreignKeyCycles(relations, foreignKeys) {
  const nodes=new Set(relations),edges=foreignKeys.filter(({child,parent})=>nodes.has(child)&&nodes.has(parent)&&child!==parent),outgoing=new Map(relations.map(name=>[name,[]]));
  for(const edge of edges) outgoing.get(edge.parent).push(edge.child);
  const seen=new Set(),visiting=new Set(),cycles=[];
  const visit=(node,path)=>{seen.add(node);visiting.add(node);for(const next of [...outgoing.get(node)].sort()){if(visiting.has(next)){const tables=[...path.slice(path.indexOf(next)),next];cycles.push({tables:[...new Set(tables)].sort(),foreignKeys:edges.filter(edge=>tables.includes(edge.child)&&tables.includes(edge.parent)).sort((a,b)=>canonical(a).localeCompare(canonical(b)))});}else if(!seen.has(next))visit(next,[...path,next]);}visiting.delete(node);};
  for(const relation of [...relations].sort())if(!seen.has(relation))visit(relation,[relation]);
  return cycles.filter((cycle,index,all)=>index===all.findIndex(item=>canonical(item.tables)===canonical(cycle.tables)));
}

export const NULLABLE_TRAINING_CERTIFICATION_CYCLE = Object.freeze({
  token: "__nullable_training_certification_cycle__",
  attendees: "agency_training_attendees",
  certifications: "training_certifications",
  attendeeColumn: "certification_id",
  certificationColumn: "source_training_attendee_id",
});
export const MIGRATION_ANCHOR_PROFILE_GENERATED_COLUMNS = Object.freeze(["created_at", "updated_at"]);

export function migrationAnchorProfileSemanticHash(rows) {
  assert.ok(Array.isArray(rows));
  return canonicalRowsHash(rows.map(row => {
    assert.ok(row && typeof row === "object" && !Array.isArray(row), "MIGRATION_ANCHOR_PROFILE_ROW_INVALID");
    return Object.fromEntries(Object.entries(row).filter(([column]) => !MIGRATION_ANCHOR_PROFILE_GENERATED_COLUMNS.includes(column)));
  }));
}

export function requireMigrationAnchorProfileParity(sourceRows, targetRows, migrationAnchorsConfirmed) {
  assert.equal(migrationAnchorsConfirmed, true, "TARGET_PROFILES_NOT_MIGRATION_ANCHORS");
  assert.equal(sourceRows.length, targetRows.length, "MIGRATION_ANCHOR_PROFILE_ROW_COUNT_MISMATCH");
  const sourceIds = new Set(sourceRows.map(row => String(row.id))), targetIds = new Set(targetRows.map(row => String(row.id)));
  assert.equal(sourceIds.size, sourceRows.length, "MIGRATION_ANCHOR_PROFILE_SOURCE_ID_DUPLICATE");
  assert.equal(targetIds.size, targetRows.length, "MIGRATION_ANCHOR_PROFILE_TARGET_ID_DUPLICATE");
  assert.deepEqual([...targetIds].sort(), [...sourceIds].sort(), "MIGRATION_ANCHOR_PROFILE_ID_MISMATCH");
  assert.equal(migrationAnchorProfileSemanticHash(targetRows), migrationAnchorProfileSemanticHash(sourceRows), "MIGRATION_ANCHOR_PROFILE_NON_GENERATED_MISMATCH");
  return Object.freeze({
    classification: "migration-anchor profile — timestamps target-generated by design",
    excludedColumns: MIGRATION_ANCHOR_PROFILE_GENERATED_COLUMNS,
    sourceCanonicalSha256: canonicalRowsHash(sourceRows),
    targetCanonicalSha256: canonicalRowsHash(targetRows),
    semanticCanonicalSha256: migrationAnchorProfileSemanticHash(sourceRows),
  });
}

function exactSourceId(row, relation) {
  assert.ok(row && typeof row === "object" && typeof row.id === "string" && row.id.length > 0, `CYCLE_SOURCE_ID_INVALID:${relation}`);
  assert.ok(typeof row.department_id === "string" && row.department_id.length > 0, `CYCLE_SOURCE_DEPARTMENT_INVALID:${relation}`);
  return row.id;
}

function sourceIndex(rows, relation) {
  const indexed = new Map();
  for (const row of rows) {
    const id = exactSourceId(row, relation);
    assert.equal(indexed.has(id), false, `CYCLE_SOURCE_DUPLICATE_ID:${relation}`);
    indexed.set(id, row);
  }
  return indexed;
}

function equivalentCycleEdge(edge, child, parent) {
  return edge.child === child && edge.parent === parent;
}

// Treat the two nullable relations as one node for ordering.  The returned
// source links are retained only in process memory and are restored inside the
// caller's single target transaction.
export function nullableTrainingCertificationCyclePlan(relations, foreignKeys, rowsByRelation) {
  const cycle = NULLABLE_TRAINING_CERTIFICATION_CYCLE;
  assert.ok(relations.includes(cycle.attendees) && relations.includes(cycle.certifications), "CYCLE_RELATIONS_MISSING");
  const attendees = rowsByRelation.get(cycle.attendees) ?? [];
  const certifications = rowsByRelation.get(cycle.certifications) ?? [];
  const attendeeById = sourceIndex(attendees, cycle.attendees);
  const certificationById = sourceIndex(certifications, cycle.certifications);
  const attendeeEdge = { child: cycle.attendees, parent: cycle.certifications };
  const certificationEdge = { child: cycle.certifications, parent: cycle.attendees };
  assert.ok(foreignKeys.some(edge => equivalentCycleEdge(edge, attendeeEdge.child, attendeeEdge.parent)), "CYCLE_EXPECTED_ATTENDEE_FK_MISSING");
  assert.ok(foreignKeys.some(edge => equivalentCycleEdge(edge, certificationEdge.child, certificationEdge.parent)), "CYCLE_EXPECTED_CERTIFICATION_FK_MISSING");

  const attendeeLinks = attendees.map(row => ({ id: row.id, departmentId: row.department_id, value: row[cycle.attendeeColumn] ?? null }));
  const certificationLinks = certifications.map(row => ({ id: row.id, departmentId: row.department_id, value: row[cycle.certificationColumn] ?? null }));
  for (const link of attendeeLinks) if (link.value !== null) {
    const parent = certificationById.get(String(link.value));
    assert.ok(parent, "CYCLE_CERTIFICATION_REFERENCE_MISSING");
    assert.equal(parent.department_id, link.departmentId, "CYCLE_CROSS_DEPARTMENT_CERTIFICATION_REFERENCE");
  }
  for (const link of certificationLinks) if (link.value !== null) {
    const parent = attendeeById.get(String(link.value));
    assert.ok(parent, "CYCLE_ATTENDEE_REFERENCE_MISSING");
    assert.equal(parent.department_id, link.departmentId, "CYCLE_CROSS_DEPARTMENT_ATTENDEE_REFERENCE");
  }

  const members = new Set([cycle.attendees, cycle.certifications]);
  const collapsedRelations = [...relations.filter(relation => !members.has(relation)), cycle.token];
  const collapsedEdges = [];
  const seen = new Set();
  for (const edge of foreignKeys) {
    const child = members.has(edge.child) ? cycle.token : edge.child;
    const parent = members.has(edge.parent) ? cycle.token : edge.parent;
    if (child === parent) continue;
    const key = `${child}\u0000${parent}`;
    if (!seen.has(key)) { seen.add(key); collapsedEdges.push({ child, parent }); }
  }
  const order = topologicalImportOrder(collapsedRelations, collapsedEdges);
  return Object.freeze({
    ...cycle,
    order,
    phaseOne: Object.freeze({
      attendees: Object.freeze(attendees.map(row => Object.freeze({ ...row, [cycle.attendeeColumn]: null }))),
      certifications: Object.freeze(certifications.map(row => Object.freeze({ ...row, [cycle.certificationColumn]: null }))),
    }),
    restore: Object.freeze({ attendees: Object.freeze(attendeeLinks), certifications: Object.freeze(certificationLinks) }),
  });
}

export async function executeNullableTrainingCertificationCycle(plan, operations) {
  assert.equal(plan.token, NULLABLE_TRAINING_CERTIFICATION_CYCLE.token, "CYCLE_PLAN_INVALID");
  for (const name of ["begin", "insertAttendees", "insertCertifications", "restoreAttendees", "restoreCertifications", "validate", "commit", "rollback"]) assert.equal(typeof operations[name], "function", `CYCLE_OPERATION_MISSING:${name}`);
  await operations.begin();
  try {
    await operations.insertAttendees(plan.phaseOne.attendees);
    await operations.insertCertifications(plan.phaseOne.certifications);
    await operations.restoreAttendees(plan.restore.attendees);
    await operations.restoreCertifications(plan.restore.certifications);
    await operations.validate();
    await operations.commit();
  } catch (error) {
    await operations.rollback();
    throw error;
  }
}

export function insertSql(relation, columns) {
  assert.ok(IMPORT_RELATIONS.includes(relation)); assert.ok(columns.length > 0 && columns.every(column => identifier.test(column)));
  const list = columns.map(quote).join(",");
  return `insert into public.${quote(relation)} (${list}) select ${list} from json_populate_record(null::public.${quote(relation)},$1::json)`;
}

export function updateByIdSql(relation, columns) {
  assert.ok(IMPORT_RELATIONS.includes(relation)); assert.ok(columns.includes("id") && columns.every(column => identifier.test(column)));
  const updates = columns.filter(column => column !== "id");
  assert.ok(updates.length > 0, "TARGET_UPDATE_COLUMNS_MISSING");
  return `update public.${quote(relation)} as target set ${updates.map(column => `${quote(column)}=source.${quote(column)}`).join(",")} from json_populate_record(null::public.${quote(relation)},$1::json) as source where target.${quote("id")}=source.${quote("id")}`;
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
