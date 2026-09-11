import assert from "node:assert/strict";
import test from "node:test";

import { AWS_MIGRATION_LEDGER, loadVerifiedAwsMigrations } from "./aws-migration-ledger.mjs";
import { normalizeMigrationSql } from "./migration-sql-core.mjs";

test("AWS target migration ledger pins every ordered overlay", async () => {
  const migrations = await loadVerifiedAwsMigrations();
  assert.equal(migrations.length, 17);
  assert.deepEqual(migrations.map(item => item.name), AWS_MIGRATION_LEDGER.map(([name]) => name));
});

test("migration SQL normalization is stable across checkout line endings", () => {
  assert.equal(normalizeMigrationSql("\uFEFFselect 1;\r\nselect 2;\r"), "select 1;\nselect 2;\n");
  assert.equal(normalizeMigrationSql("select 1;\nselect 2;\n"), "select 1;\nselect 2;\n");
});
