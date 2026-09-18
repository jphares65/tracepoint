import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const AWS_MIGRATION_LEDGER = Object.freeze([
  ["001_provider_neutral_authorization_context.sql", "39411fb46db2c4d09e48d0e3a1862c885430714e2e520f63d437220ff94e5b8c"],
  ["002_cognito_application_session_idle.sql", "66361c5bfab16f8164c6a3b2f1aa0ef0fb6bae43363ba73788e6ba23b7779779"],
  ["003_runtime_role_and_auth_state.sql", "0b13949614a0eac556d27435fedff1e9576eb5e39793a04e3db802418bf225ee"],
  ["004_remove_supabase_authorization_runtime.sql", "51c9063dca0ac6a5947a2fe5f12a4f50b4875ec1e18fa9ff990453e32111e148"],
  ["005_command_dashboard_fleet_read.sql", "751a9252cf492d0326ea5f906e0f6ca0c3c3a2cb34f919d0b8641b25161ea76b"],
  ["006_cognito_lifecycle_state.sql", "da79c9c5adfec5ed58caaef6cb6cbca528a780e2e1dbb75342e91750fd7e603f"],
  ["007_ses_runtime_queue_access.sql", "6f1c3be1b1d4511eb928eff6bada77e376a10a86aa35cab057854d6b9c708193"],
  ["008_training_closeout_authorization.sql", "24f2d1ef877764a90471d55a0280b9de6e0b156fbe1b1d7d82f580defea3489f"],
  ["009_cognito_membership_lifecycle.sql", "0c9bf2afca5729fb43de6e2541db26c2b481c7cdbc72b3b1dde89452679cc92c"],
  ["010_cognito_inactive_invites.sql", "e3a245570ce503172f03d66735a0407ca5140b864772ff10043d9ed4afcc738e"],
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
