import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AWS-native Range Day persistence grants only the authenticated writes guarded by existing RLS", async () => {
  const migration = await readFile(
    "database/aws/043_range_workspace_authenticated_writes.sql",
    "utf8",
  );

  assert.match(migration, /pilot_range_workspaces\.workspace must be jsonb/);
  assert.match(migration, /updated_by_user_id uuid is required/);
  assert.match(
    migration,
    /grant insert, update on public\.pilot_range_workspaces to authenticated;/,
  );
  assert.doesNotMatch(migration, /disable row level security/i);
  assert.doesNotMatch(migration, /to service_role/i);
});
