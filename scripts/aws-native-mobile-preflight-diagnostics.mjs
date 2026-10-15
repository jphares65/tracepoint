const stageFailureCodes = new Map([
  ["MIGRATION_MANIFEST", "MIGRATION_MANIFEST_INVALID"],
  ["RUNTIME_CONFIGURATION", "RUNTIME_CONFIGURATION_INVALID"],
  ["DATABASE_SECRET_PARSE", "DATABASE_SECRET_INVALID"],
  ["DATABASE_SECRET_SHAPE", "DATABASE_SECRET_INVALID"],
  ["EXPECTED_DATABASE_HOST", "DATABASE_TARGET_MISMATCH"],
  ["DATABASE_CA", "DATABASE_CA_INVALID"],
  ["DATABASE_CONNECT", "DATABASE_CONNECTION_FAILED"],
  ["READ_ONLY_TRANSACTION_BEGIN", "READ_ONLY_TRANSACTION_SETUP_FAILED"],
  ["READ_ONLY_SEARCH_PATH", "READ_ONLY_SEARCH_PATH_FAILED"],
  ["DATABASE_IDENTITY_QUERY", "DATABASE_IDENTITY_QUERY_FAILED"],
  ["DATABASE_IDENTITY_VALIDATION", "DATABASE_IDENTITY_MISMATCH"],
  ["DATABASE_PRINCIPAL_QUERY", "DATABASE_PRINCIPAL_QUERY_FAILED"],
  ["MIGRATION_LEDGER_READ", "MIGRATION_LEDGER_READ_FAILED"],
  ["SCHEMA_CATALOG_READ", "SCHEMA_CATALOG_READ_FAILED"],
  ["READ_ONLY_TRANSACTION_COMMIT", "READ_ONLY_TRANSACTION_COMMIT_FAILED"],
]);

const safeErrorCodes = new Map([
  ["DATABASE_TARGET_MISMATCH", "DATABASE_TARGET_MISMATCH"],
  ["AWS-native database secret is invalid.", "DATABASE_SECRET_INVALID"],
  ["AWS-native database CA is invalid.", "DATABASE_CA_INVALID"],
  ["AWS-native database CA path is invalid.", "DATABASE_CA_INVALID"],
  ["AWS-native PostgreSQL runtime configuration is required.", "RUNTIME_CONFIGURATION_INVALID"],
]);

const networkErrorCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
]);

const tlsErrorCodes = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_SIGNATURE_FAILURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

const postgresErrorCodes = new Map([
  ["28P01", "DATABASE_AUTH_REJECTED"],
  ["3D000", "DATABASE_NAME_REJECTED"],
  ["42501", "DATABASE_PRIVILEGE_DENIED"],
  ["42P01", "DATABASE_OBJECT_MISSING"],
  ["42703", "DATABASE_COLUMN_MISSING"],
]);

export function mobilePreflightFailureDetails(stage, error) {
  const safeStage = stageFailureCodes.has(stage) ? stage : "UNKNOWN";
  const message = typeof error?.message === "string" ? error.message : "";
  const rawCode = typeof error?.code === "string" ? error.code : "";
  let code = safeErrorCodes.get(message);

  if (!code && postgresErrorCodes.has(rawCode)) code = postgresErrorCodes.get(rawCode);
  if (!code && networkErrorCodes.has(rawCode)) code = "DATABASE_NETWORK_CONNECT_FAILED";
  if (!code && tlsErrorCodes.has(rawCode)) code = "DATABASE_TLS_VALIDATION_FAILED";
  if (!code) code = stageFailureCodes.get(safeStage) ?? "MOBILE_PREFLIGHT_FAILED";

  return { stage: safeStage, code };
}
