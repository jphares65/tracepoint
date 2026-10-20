import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ammunitionUserNames } from "./ammunition-user-names.ts";

async function withMode<T>(mode: string | undefined, run: () => Promise<T>) {
  const previous = process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE;
  if (mode === undefined) delete process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE;
  else process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE = mode;
  try { return await run(); }
  finally {
    if (previous === undefined) delete process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE;
    else process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE = previous;
  }
}

test("aws-native ammunition names come from profiles for the referenced actors only", async () => {
  const calls: string[] = [];
  // The PostgreSQL data client has no Supabase Auth directory.
  const admin = {
    from(table: string) {
      calls.push(`from:${table}`);
      const query = {
        select(fields: string) { calls.push(`select:${fields}`); return query; },
        in(column: string, values: string[]) {
          calls.push(`in:${column}:${values.join(",")}`);
          return Promise.resolve({ data: [{ id: "u1", full_name: "Officer One", email: "one@example.test" }, { id: "u2", full_name: null, email: "two@example.test" }], error: null });
        },
      };
      return query;
    },
  };
  const names = await withMode("aws-native", () => ammunitionUserNames(admin, ["u1", null, "u2", "u1", undefined]));
  assert.deepEqual(calls, ["from:profiles", "select:id,full_name,email", "in:id:u1,u2"]);
  assert.equal(names.get("u1"), "Officer One");
  assert.equal(names.get("u2"), "two@example.test");
  assert.equal((await withMode("aws-native", () => ammunitionUserNames(admin, [null]))).size, 0);
  assert.equal(calls.length, 3);
  await assert.rejects(withMode("aws-native", () => ammunitionUserNames({ from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: "denied" } }) }) }) }, ["u1"])), /denied/);
});

test("supabase-mode ammunition names keep the auth directory lookup", async () => {
  const admin = { auth: { admin: { listUsers: async (input: unknown) => {
    assert.deepEqual(input, { page: 1, perPage: 1000 });
    return { data: { users: [{ id: "u1", user_metadata: { name: "Metadata Name" }, email: "one@example.test" }] }, error: null };
  } } } };
  const names = await withMode(undefined, () => ammunitionUserNames(admin, []));
  assert.equal(names.get("u1"), "Metadata Name");
});

test("ammunition routes no longer read the Supabase Auth directory directly", async () => {
  for (const file of ["src/app/api/armory/ammunition/route.ts", "src/app/api/armory/ammunition/reconciliations/route.ts"]) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /auth\.admin\.listUsers/, file);
    assert.match(source, /ammunitionUserNames\(/, file);
  }
});
