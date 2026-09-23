import assert from "node:assert/strict";
import test from "node:test";
import { requireRangeReadProvider } from "../range/read-repository-core.ts";
import { requirePersonalRifleReadProvider } from "../personal-rifles/read-repository-core.ts";
import { requireArmoryReadProvider } from "../armory/read-repository-core.ts";
import { createCurrentRulesRepository, CURRENT_RULES_FIELDS } from "../department-rules/current-rules-repository-core.ts";

test("only Supabase and PostgreSQL are accepted for the authenticated home reads", () => {
  for (const select of [requireRangeReadProvider, requirePersonalRifleReadProvider, requireArmoryReadProvider]) {
    assert.equal(select(), "supabase");
    assert.equal(select("postgres"), "postgres");
    assert.throws(() => select("aurora"), /Unsupported data provider/);
  }
});

test("PostgreSQL current rules use the existing tenant-bound read contract", async () => {
  const calls: string[] = [];
  const query = {
    select(fields: string) { calls.push(`select:${fields}`); return this; },
    eq(column: string, value: string) { calls.push(`eq:${column}:${value}`); return this; },
    maybeSingle() { calls.push("maybeSingle"); return Promise.resolve({ data: null, error: null }); },
  };
  const client = { from(table: string) { calls.push(`from:${table}`); return query; } };
  const repo = createCurrentRulesRepository(client, "department-a", { TRACEPOINT_DATA_PROVIDER: "postgres" });
  assert.equal(await repo.getCurrentRules({ departmentId: "department-a" }), null);
  assert.deepEqual(calls, ["from:department_rules", `select:${CURRENT_RULES_FIELDS}`, "eq:department_id:department-a", "maybeSingle"]);
});
