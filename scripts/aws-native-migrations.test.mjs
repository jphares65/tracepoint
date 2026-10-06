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

test("migration archives select the environment Dockerfile and include its validation dependencies", async () => {
  const archiveRunner = await readFile(new URL("./apply-app-migrations.ps1", import.meta.url), "utf8");
  const environments = [
    {
      name: "staging",
      dockerfile: "../Dockerfile",
      manifest: /\$paths = @[^\n]*'scripts'[^\n]*'Dockerfile'[^\n]*'buildspec\.staging-image\.yml'/,
      validationScripts: ["scripts/run-application-tests.mjs", "scripts/aws-native-migrations.test.mjs"],
    },
    {
      name: "production",
      dockerfile: "../Dockerfile.aws-native-production",
      manifest: /if \(\$Environment -eq 'production'\) \{ \$paths = @[^\n]*'scripts'[^\n]*'Dockerfile\.aws-native-production'[^\n]*'buildspec\.production-image\.yml'/,
      validationScripts: ["scripts/assert-production-lint-ratchet.mjs", "scripts/run-application-tests.mjs", "scripts/aws-native-migrations.test.mjs"],
    },
  ];

  for (const environment of environments) assert.match(archiveRunner, environment.manifest, `${environment.name} archive contract`);

  const currentArchiveDockerfiles = [];
  for (const environment of environments) {
    try {
      currentArchiveDockerfiles.push({ environment, dockerfile: await readFile(new URL(environment.dockerfile, import.meta.url), "utf8") });
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }

  assert.ok(currentArchiveDockerfiles.length > 0, "the current migration archive must include its environment Dockerfile");
  for (const { environment, dockerfile } of currentArchiveDockerfiles) {
    for (const script of environment.validationScripts) assert.match(dockerfile, new RegExp(script.replaceAll(".", "\\.")));
  }
});
