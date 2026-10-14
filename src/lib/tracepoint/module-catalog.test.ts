import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MODULE_FEATURE_CODES } from "./module-catalog.ts";

const migrations = [
  "database/aws/042_default_module_entitlements.sql",
  "supabase/migrations/202610120001_default_module_entitlements.sql",
];

test("AWS and Supabase catalog migrations seed every canonical operational module", async () => {
  for (const path of migrations) {
    const sql = await readFile(path, "utf8");
    for (const code of MODULE_FEATURE_CODES) {
      assert.match(sql, new RegExp(`\\('${code}',`), `${path} is missing ${code}`);
    }
  }
});

test("AWS and Supabase entitlement migrations differ only in authenticated actor resolution", async () => {
  const [aws, supabase] = await Promise.all(migrations.map((path) => readFile(path, "utf8")));
  assert.equal(
    supabase.replace(/\r\n/g, "\n").replaceAll("auth.uid()", "tracepoint_auth.subject_id()"),
    aws.replace(/\r\n/g, "\n"),
  );
});

test("catalog migration replay preserves an existing global feature deactivation", async () => {
  for (const path of migrations) {
    const sql = await readFile(path, "utf8");
    const conflict = sql.slice(sql.indexOf("on conflict (code)"), sql.indexOf(";", sql.indexOf("on conflict (code)")));
    assert.doesNotMatch(conflict, /is_active\s*=/, `${path} must not reactivate a globally disabled feature on replay`);
  }
});

test("new agencies and newly added active modules receive only missing enabled rows", async () => {
  for (const path of migrations) {
    const sql = await readFile(path, "utf8");
    assert.match(sql, /departments_default_module_entitlements[\s\S]*after insert on public\.departments/);
    assert.match(sql, /feature_catalog_default_department_entitlements[\s\S]*after insert or update of is_active on public\.feature_catalog/);
    assert.match(sql, /if not new\.is_active or \(tg_op = 'UPDATE' and old\.is_active\) then/);
    assert.match(sql, /on conflict \(department_id, feature_code\) do nothing/);
  }
});

test("legacy backfill preserves explicit disabled rows and records inserted defaults", async () => {
  for (const path of migrations) {
    const sql = await readFile(path, "utf8");
    const backfill = sql.slice(sql.indexOf("-- Missing rows are new entitlements"));
    assert.match(backfill, /insert into public\.department_features[\s\S]*select department\.id, feature\.code, true/);
    assert.match(backfill, /on conflict \(department_id, feature_code\) do nothing/);
    assert.match(backfill, /returning department_id, feature_code[\s\S]*insert into public\.department_feature_events/);
    assert.match(backfill, /select department_id, feature_code, null, true, null,[\s\S]*Default-enabled module entitlement backfill/);
    assert.doesNotMatch(backfill, /do update set[\s\S]*is_enabled/);
  }
});

test("module entitlement provisioning remains scoped to department rows", async () => {
  const [migration, access] = await Promise.all([
    readFile(migrations[0], "utf8"),
    readFile("src/lib/tracepoint/server-access-postgres.ts", "utf8"),
  ]);
  assert.match(migration, /p_department_id, feature\.code, true/);
  assert.match(access, /from public\.department_features where department_id=\$1 and is_enabled is not false/);
  assert.doesNotMatch(migration, /create policy|alter policy/);
});
