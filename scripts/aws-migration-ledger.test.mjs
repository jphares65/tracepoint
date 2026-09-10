import assert from "node:assert/strict";
import test from "node:test";

import { AWS_MIGRATION_LEDGER, loadVerifiedAwsMigrations } from "./aws-migration-ledger.mjs";

test("AWS target migration ledger pins every ordered overlay", async () => {
  const migrations = await loadVerifiedAwsMigrations();
  assert.equal(migrations.length, 13);
  assert.deepEqual(migrations.map(item => item.name), AWS_MIGRATION_LEDGER.map(([name]) => name));
});
