// The Supabase-bridge copy of the module entitlement seed. AWS-native
// environments receive it as database/aws/042 (tracepoint_auth.subject_id()
// instead of auth.uid()); before database/aws runs, tracepoint_auth does not
// exist, so local AWS-native schemas skip it.
export const awsNativeSupersededBridgeMigrations = new Set(["202610120001_default_module_entitlements.sql"]);

/** @param {string} name */
export function isAwsNativeSchemaFile(name) {
  return /^\d+_.+\.sql$/.test(name) && !awsNativeSupersededBridgeMigrations.has(name);
}
