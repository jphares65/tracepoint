import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("full-AWS staging workflow carries both resolved image digests into the release", async () => {
  const workflow = await readFile(new URL(".github/workflows/aws-full-staging-runtime.yml", root), "utf8");
  assert.match(workflow, /publish-full-aws-staging-image\.ps1 -BuildPostgresTooling -Wait -AuthorizedBranch main/);
  assert.match(workflow, /imageTag=\$env:GITHUB_SHA-aws-native/);
  assert.match(workflow, /imageTag=\$env:GITHUB_SHA-postgres-migration/);
  assert.match(workflow, /execute-full-aws-staging-bootstrap\.ps1[^\r\n]+-ToolingImageDigest \$env:TOOLING_IMAGE_DIGEST/);
  assert.match(workflow, /deploy-full-aws-staging\.ps1 -Action DeployRuntime[^\r\n]+-ImageDigest \$env:RUNTIME_IMAGE_DIGEST[^\r\n]+-ToolingImageDigest \$env:TOOLING_IMAGE_DIGEST/);
});

test("bootstrap and runtime deployment gates require digest-shaped tooling evidence", async () => {
  const bootstrap = await readFile(new URL("scripts/execute-full-aws-staging-bootstrap.ps1", root), "utf8");
  const deploy = await readFile(new URL("scripts/deploy-full-aws-staging.ps1", root), "utf8");
  for (const source of [bootstrap, deploy]) {
    assert.match(source, /ToolingImageDigest/);
    assert.match(source, /\^sha256:\[0-9a-f\]\{64\}\$/);
  }
  assert.match(bootstrap, /imageDetails\[0\]\.imageDigest -cne \$ToolingImageDigest/);
  assert.match(bootstrap, /cdk deploy \$stack @contexts --exclusively/);
  assert.match(deploy, /bootstrap\.toolingImageDigest -ne \$ToolingImageDigest/);
  assert.match(bootstrap, /--log-group-name \/tracepoint\/staging\/application/);
});

test("native staging fixture reads bootstrap evidence from the application log group", async () => {
  const fixture = await readFile(new URL("scripts/execute-aws-native-staging-fixture.ps1", root), "utf8");
  assert.match(fixture, /'--log-group-name','\/tracepoint\/staging\/application'/);
});

test("PostgreSQL tooling archive includes the migration ledger's transitive SQL normalizer", async () => {
  const dockerfile = await readFile(new URL("Dockerfile.postgres-migration", root), "utf8");
  const publisher = await readFile(new URL("scripts/publish-full-aws-staging-image.ps1", root), "utf8");
  assert.match(dockerfile, /scripts\/migration-sql-core\.mjs/);
  assert.match(publisher, /'scripts\/migration-sql-core\.mjs'/);
});
