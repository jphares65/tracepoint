import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const AWS_MIGRATION_LEDGER = Object.freeze([
  ["001_provider_neutral_authorization_context.sql", "e0c2a264ce64bd18469578b5186c9765490b108e47b5e903df2422a828949515"],
  ["002_cognito_application_session_idle.sql", "6f19b069025c568736b7bb1a937465d038b5f8db60cc37878c2c660c5f56de21"],
  ["003_runtime_role_and_auth_state.sql", "95b7791d86fa1ed955351f3a33607ccb79c2e42ef1aeb9115cef540fc672c77a"],
  ["004_remove_supabase_authorization_runtime.sql", "440a076573ae21ad1e499d5be61d345e35b6bc83477e837f8b2f1a5d3bcc73e9"],
  ["005_command_dashboard_fleet_read.sql", "24547c774c5146f3b47d78a9250199bfafd5e1a19c6f898ac54295aaaf261ea7"],
  ["006_cognito_lifecycle_state.sql", "8554fad23498e4b68dc26aaec42efe66452515b51f83259b2cbb8a23c0d1d222"],
  ["007_ses_runtime_queue_access.sql", "44deea58c200a3891ee17b22dd1224e2933e7396574b3a072d2efd3951f0405c"],
  ["008_training_closeout_authorization.sql", "78f774cbfbd64b4017030952236b8ee54acce2777f495fbb23499c31f8f95230"],
  ["009_cognito_membership_lifecycle.sql", "fa1bad83c12b714c3c2e310ed5156da4f0291fd7e7d2980fa77b8b8ab46be0f0"],
]);

const sha256 = value => createHash("sha256").update(value).digest("hex");

export async function loadVerifiedAwsMigrations(directory = "database/aws") {
  const actual = (await readdir(directory)).filter(file => /^\d+_.+\.sql$/.test(file)).sort();
  assert.deepEqual(actual, AWS_MIGRATION_LEDGER.map(([name]) => name), "AWS migration filenames must match the committed ledger");
  const migrations = [];
  for (const [name, expected] of AWS_MIGRATION_LEDGER) {
    const sql = await readFile(path.join(directory, name), "utf8");
    assert.equal(sha256(sql), expected, `AWS migration checksum changed: ${name}`);
    migrations.push({ name, sql, sha256: expected });
  }
  return migrations;
}
