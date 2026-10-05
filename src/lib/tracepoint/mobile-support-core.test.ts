import assert from "node:assert/strict";
import test from "node:test";
import { listMobileSupportAgencies, recordMobileSupportEntry, type SupportQuery } from "./mobile-support-core.ts";

const id = "11111111-1111-4111-8111-111111111111";
test("ordinary and revoked administrators cannot enumerate agencies or record support entry", async () => {
  const calls: string[] = [];
  const query: SupportQuery = async sql => { calls.push(sql); return { rows: [{ allowed: false }] }; };
  await assert.rejects(listMobileSupportAgencies(query), /administrator/);
  await assert.rejects(recordMobileSupportEntry(query, id), /administrator/);
  assert.deepEqual(calls, ["select public.is_platform_admin() as allowed", "select public.is_platform_admin() as allowed"]);
});
test("support picker exposes only active agencies and public picker fields", async () => {
  const query: SupportQuery = async sql => ({ rows: sql.includes("is_platform_admin") ? [{ allowed: true }] : [
    { id, name: "Agency A", short_name: "A", is_active: true, internal_notes: "private" },
    { id: "inactive", name: "Inactive", is_active: false },
  ] });
  assert.deepEqual(await listMobileSupportAgencies(query), [{ departmentId: id, departmentName: "Agency A", departmentShortName: "A" }]);
});
test("entry uses the existing audited database operation and fails closed on audit failure", async () => {
  const calls: { sql: string; values?: string[] }[] = [];
  const query: SupportQuery = async (sql, values) => { calls.push({ sql, values }); return { rows: sql.includes("is_platform_admin") ? [{ allowed: true }] : [{ department_name: "Agency A" }] }; };
  await recordMobileSupportEntry(query, id);
  assert.deepEqual(calls[1].values, [id, "support_mode_entered"]);
  const failed: SupportQuery = async sql => { if (sql.includes("is_platform_admin")) return { rows: [{ allowed: true }] }; throw new Error("audit unavailable"); };
  await assert.rejects(recordMobileSupportEntry(failed, id), /audit unavailable/);
  await assert.rejects(recordMobileSupportEntry(async sql => ({ rows: sql.includes("is_platform_admin") ? [{ allowed: true }] : [] }), id), /audited/);
});
