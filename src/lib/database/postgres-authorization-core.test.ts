import assert from "node:assert/strict";
import test from "node:test";
import { withPostgresAuthorization } from "./postgres-authorization-core.ts";

const context = { subjectId: "20000000-0000-4000-8000-000000000001", departmentId: "10000000-0000-4000-8000-000000000001" };

function fixture(fail = false) {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  let released = false;
  const client = {
    async query(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      if (fail && text === "select synthetic") throw new Error("synthetic failure");
      return { rows: [{ ok: true }] };
    },
    release() { released = true; },
  };
  return { calls, client, pool: { async connect() { return client; } }, released: () => released };
}

test("sets transaction-local identity and tenant context before application SQL", async () => {
  const value = fixture();
  const result = await withPostgresAuthorization(value.pool, context, async (client) => {
    await client.query("select synthetic", [context.departmentId]);
    return "complete";
  });
  assert.equal(result, "complete");
  assert.deepEqual(value.calls, [
    { text: "begin", values: undefined },
    { text: "set local role authenticated", values: undefined },
    { text: "select set_config('tracepoint.subject_id', $1, true)", values: [context.subjectId] },
    { text: "select set_config('tracepoint.department_id', $1, true)", values: [context.departmentId] },
    { text: "select synthetic", values: [context.departmentId] },
    { text: "commit", values: undefined },
  ]);
  assert.equal(value.released(), true);
});

test("rolls back and releases on operation failure", async () => {
  const value = fixture(true);
  await assert.rejects(withPostgresAuthorization(value.pool, context, (client) => client.query("select synthetic")), /synthetic failure/);
  assert.equal(value.calls.at(-1)?.text, "rollback");
  assert.equal(value.released(), true);
  assert.equal(value.calls.some((call) => call.text === "commit"), false);
});

test("rejects malformed identity or tenant context before taking a connection", async () => {
  let connected = false;
  const pool = { async connect() { connected = true; throw new Error("must not connect"); } };
  await assert.rejects(withPostgresAuthorization(pool, { ...context, subjectId: "not-a-subject" }, async () => undefined), /Valid authorization subject/);
  await assert.rejects(withPostgresAuthorization(pool, { ...context, departmentId: "not-a-department" }, async () => undefined), /Valid authorization subject/);
  assert.equal(connected, false);
});
