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

test("firearm detail uses the native custody write and storage-location contracts", async () => {
  const page = await readFile("src/app/firearms/[firearmId]/page.tsx", "utf8");
  assert.match(page, /\/api\/armory\/storage-locations/);
  assert.match(page, /method: "POST"/);
  assert.match(page, /\/api\/armory\/firearms\/\$\{encodeURIComponent\(firearm\.id\)\}\/custody/);
  assert.match(page, /Transfer to Secure Storage/);
  assert.match(page, /Return to Assigned Officer/);
  assert.match(page, /Changing custody never changes assignment/);
});

test("normal firearm inventory exposes the existing custody workflow", async () => {
  const page = await readFile("src/app/firearms/page.tsx", "utf8");
  assert.match(page, /\/api\/armory\/firearms\/\$\{encodeURIComponent\(firearmId\)\}\/custody/);
  assert.match(page, /\/api\/armory\/storage-locations/);
  assert.match(page, /Physical Custody/);
  assert.match(page, /Manage Custody/);
  assert.match(page, /href=\{`\/firearms\/\$\{selectedFirearm\.id\}`\}/);
});

test("restricted use preserves assignment, uses existing custody, and keeps its history", async () => {
  const sql = await readFile("database/aws/029_firearm_restricted_use.sql", "utf8");
  const route = await readFile("src/app/api/armory/firearms/[firearmId]/custody/route.ts", "utf8");
  const page = await readFile("src/app/firearms/page.tsx", "utf8");
  assert.match(sql, /manage_restrictions'\) or public\.has_department_permission\(v_department_id, 'manage_firearms'/);
  assert.match(sql, /restricted use requires an active assignment/);
  assert.match(sql, /update public\.firearm_possession_restrictions set is_active=false/);
  assert.match(sql, /firearm_possession_restriction_cleared/);
  assert.match(route, /set_firearm_restricted_use/);
  assert.match(route, /clear_firearm_possession_restriction/);
  assert.match(page, /RESTRICTED USE/);
  assert.match(page, /Record in Storage/);
  assert.match(page, /Return to Officer/);
  assert.match(page, /no_possession_permitted/);
});
