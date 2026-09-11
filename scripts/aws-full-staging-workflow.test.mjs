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
  assert.match(deploy, /list-task-definitions --family-prefix \$family --status ACTIVE --sort DESC/);
  assert.match(deploy, /if \(-not \$bridgeRollback\) \{ throw 'A validated isolated bridge task revision/);
  assert.match(deploy, /automatic rollback target and retained bridge task \$bridgeRollback/);
  assert.match(bootstrap, /--log-group-name \/tracepoint\/staging\/application/);
});

test("native staging fixture reads bootstrap evidence from the application log group", async () => {
  const fixture = await readFile(new URL("scripts/execute-aws-native-staging-fixture.ps1", root), "utf8");
  assert.match(fixture, /'--log-group-name','\/tracepoint\/staging\/application'/);
  assert.match(fixture, /if \(\$NonInteractive\) \{ \$ConfirmPreference = 'None' \}/);
  assert.match(fixture, /\$ErrorActionPreference = 'Continue'[\s\S]+\$exitCode = \$LASTEXITCODE/);
  assert.match(fixture, /'file:\/\/' \+ \$overridesPath\.Replace\('\\', '\/'\)/);
  assert.match(fixture, /Remove-Item -LiteralPath \$overridesPath -Force/);
  assert.match(fixture, /\$evidenceDeadline = \[DateTime\]::UtcNow\.AddMinutes\(2\)/);
});

test("native staging fixture cleanup removes only verified synthetic tenants and their audit rows", async () => {
  const fixture = await readFile(new URL("scripts/manage-aws-native-staging-fixture.mjs", root), "utf8");
  assert.match(fixture, /\["setup", "cleanup", "recovery-cleanup"\]/);
  assert.match(fixture, /delete from public\.audit_events where department_id=any/);
  assert.match(fixture, /Recovery cleanup requires the exact two fixture slugs/);
  assert.match(fixture, /Recovery cleanup requires exactly three synthetic identities/);
  assert.match(fixture, /aws-native-\$\{kind\}-\$\{input\.runId\}@example\.invalid/);
  assert.match(fixture, /procedure\.proname=any\(\$1::text\[\]\)/);
  assert.match(fixture, /\["write_audit_event", "write_agency_training_audit_event"\]/);
  assert.match(fixture, /alter table \$\{trigger\.table_name\} disable trigger \$\{trigger\.trigger_name\}/);
  assert.match(fixture, /alter table \$\{trigger\.table_name\} enable trigger \$\{trigger\.trigger_name\}/);
});

test("PostgreSQL tooling archive includes the migration ledger's transitive SQL normalizer", async () => {
  const dockerfile = await readFile(new URL("Dockerfile.postgres-migration", root), "utf8");
  const publisher = await readFile(new URL("scripts/publish-full-aws-staging-image.ps1", root), "utf8");
  assert.match(dockerfile, /scripts\/migration-sql-core\.mjs/);
  assert.match(publisher, /'scripts\/migration-sql-core\.mjs'/);
  assert.match(publisher, /\$OnlyPostgresTooling -and -not \$BuildPostgresTooling/);
  assert.match(publisher, /if \(-not \$OnlyPostgresTooling\)/);
});

test("synthetic fixture treats Cognito subjects as issuer-bound opaque identifiers", async () => {
  const fixture = await readFile(new URL("scripts/manage-aws-native-staging-fixture.mjs", root), "utf8");
  assert.match(fixture, /const cognitoSubject = \/\^\[0-9a-f\]/);
  assert.match(fixture, /assert\.match\(user\.subject \?\? "", cognitoSubject\)/);
  assert.match(fixture, /jsonb_build_object\('full_name',\$3::text/);
  assert.match(fixture, /\$1::text,\$2::text,\$3::uuid,'active',\$3::uuid::text/);
});

test("migration build images use the AWS-hosted official Node mirror", async () => {
  const files = ["Dockerfile", "Dockerfile.postgres-migration", "Dockerfile.postgres-rehearsal", "Dockerfile.identity-migration"];
  for (const file of files) {
    const dockerfile = await readFile(new URL(file, root), "utf8");
    assert.doesNotMatch(dockerfile, /^FROM node:/m);
    assert.match(dockerfile, /^FROM public\.ecr\.aws\/docker\/library\/node:24-/m);
  }
});

test("RDS backup proof accepts only AWS Backup managed RDS recovery snapshots", async () => {
  const proof = await readFile(new URL("scripts/prove-full-aws-staging-backup-restore.ps1", root), "utf8");
  assert.match(proof, /arn:aws:rds:\$region`:\$account`:snapshot:awsbackup:job-\[0-9a-f-\]\{36\}/);
  assert.doesNotMatch(proof, /arn:aws:backup:\$region`:\$account`:recovery-point/);
  assert.match(proof, /\[string\]\$metadataResponse\.RestoreMetadata\.Engine -ne 'postgres'/);
  assert.match(proof, /\$restoreMetadata = \[ordered\]@\{/);
  assert.doesNotMatch(proof, /\$metadataResponse\.RestoreMetadata\.PSObject\.Properties/);
  assert.doesNotMatch(proof, /DBSnapshotIdentifier =/);
  assert.match(proof, /VpcSecurityGroupIds = \(@\(\$sourceDb\.VpcSecurityGroups\.VpcSecurityGroupId\) \| ConvertTo-Json -Compress -AsArray\)/);
  assert.match(proof, /foreach \(\$entry in \$planOnly\.GetEnumerator\(\)\)/);
  assert.match(proof, /--idempotency-token', "restore-\$TargetIdentifier"/);
});
