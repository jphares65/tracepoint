import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("AWS-native custody migration keeps assignment availability independent of custody", async () => {
  const sql = await readFile("database/aws/028_firearm_custody_phase_a.sql", "utf8");
  assert.match(sql, /tracepoint_auth\.subject_id\(\)/);
  assert.match(sql, /tracepoint_auth\.department_id\(\)/);
  assert.match(sql, /not exists \(select 1 from public\.firearm_assignments assignment/);
  assert.doesNotMatch(sql, /feature_catalog|firearm_custody',true|department_features/);
});

test("custody mutations are idempotent and append an audit event", async () => {
  const sql = await readFile("database/aws/028_firearm_custody_phase_a.sql", "utf8");
  assert.match(sql, /unique \(department_id, idempotency_key\)/);
  assert.match(sql, /for update/);
  assert.match(sql, /insert into public\.firearm_custody_events/);
  assert.match(sql, /insert into public\.audit_events/);
  assert.match(sql, /create_firearm_possession_restriction/);
  assert.match(sql, /create_firearm_storage_location/);
});

test("custody API is server-authorized and never creates a Cognito identity", async () => {
  const route = await readFile("src/app/api/armory/firearms/[firearmId]/custody/route.ts", "utf8");
  assert.match(route, /resolveServerAccess\(\)/);
  assert.match(route, /transfer_firearm_custody/);
  assert.doesNotMatch(route, /AdminCreateUser|AdminSetUserPassword|cognito/i);
});
