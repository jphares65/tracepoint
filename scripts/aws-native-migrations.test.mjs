import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AWS-native migration runner is ledgered, locked, hash-checked, and does not wrap file transactions", async () => {
  const runner = await readFile(new URL("./run-aws-native-migrations.mjs", import.meta.url), "utf8");
  assert.match(runner, /tracepoint_aws_schema_migrations/);
  assert.match(runner, /createHash\("sha256"\)/);
  assert.match(runner, /MIGRATION_DRIFT/);
  assert.match(runner, /pg_advisory_lock/);
  assert.match(runner, /ownsTransaction/);
  assert.match(runner, /cannot be executed: AWS-native migrations must own an explicit outer BEGIN\/COMMIT transaction/);
  assert.match(runner, /replace\(\/commit;/);
  assert.match(runner, /AWS_NATIVE_BASELINE_UNVERIFIED/);
  assert.match(runner, /action === "baseline" && requestedEnvironment !== "staging"/);
});

test("migration image archives include the complete scripts tree for staging and production validation", async () => {
  const archiveRunner = await readFile(new URL("./apply-app-migrations.ps1", import.meta.url), "utf8");
  const stagingDockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  const productionDockerfile = await readFile(new URL("../Dockerfile.aws-native-production", import.meta.url), "utf8");

  assert.match(archiveRunner, /\$paths = @[^\n]*'scripts'/);
  assert.match(archiveRunner, /if \(\$Environment -eq 'production'\) \{ \$paths = @[^\n]*'scripts'/);

  for (const script of ["scripts/run-application-tests.mjs", "scripts/aws-native-migrations.test.mjs"]) {
    assert.match(stagingDockerfile, new RegExp(script.replaceAll(".", "\\.")));
  }
  for (const script of ["scripts/assert-production-lint-ratchet.mjs", "scripts/run-application-tests.mjs", "scripts/aws-native-migrations.test.mjs"]) {
    assert.match(productionDockerfile, new RegExp(script.replaceAll(".", "\\.")));
  }
});
