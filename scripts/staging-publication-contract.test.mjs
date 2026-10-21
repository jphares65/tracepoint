import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('staging publisher, buildspec, deployment, and workflows share the immutable suffixed image tag', async () => {
  const [publisher, buildspec, deploy, release, rollback, evidence, runtimeWorkflow, operationsWorkflow, oidcWorkflow, deployApp] = await Promise.all([
    read('scripts/publish-tracepoint-staging-image.ps1'),
    read('buildspec.staging-image.yml'),
    read('scripts/deploy-tracepoint-staging.ps1'),
    read('scripts/release-tracepoint-staging.ps1'),
    read('scripts/rehearse-staging-rollback.ps1'),
    read('scripts/collect-staging-release-evidence.mjs'),
    read('.github/workflows/aws-staging-runtime.yml'),
    read('.github/workflows/aws-staging-operations.yml'),
    read('.github/workflows/aws-staging-oidc-proof.yml'),
    read('scripts/deploy-app.ps1'),
  ]);
  assert.match(publisher, /\$imageTag = Get-ReviewedImageTag -Environment staging -Commit \$commit/);
  assert.match(publisher, /name=IMAGE_TAG,value=\$imageTag/);
  assert.match(publisher, /imageTag=\$imageTag/);
  assert.match(buildspec, /\^\(migration-\)\?\[0-9a-f\]\{40\}-aws-native-staging\$/);
  for (const script of [deploy, release, rollback]) assert.match(script, /\[0-9a-f\]\{40\}-aws-native-staging/);
  assert.match(evidence, /\[0-9a-f\]\{40\}-aws-native-staging/);
  // The staging runtime workflow passes the commit and appends the suffix where the tag is used.
  assert.match(runtimeWorkflow, /RELEASE_COMMIT: \$\{\{ steps\.request\.outputs\.imageCommit \|\| github\.sha \}\}/);
  assert.match(runtimeWorkflow, /RELEASE_COMMIT: \$\{\{ steps\.request\.outputs\.imageCommit \}\}/);
  assert.equal((runtimeWorkflow.match(/"\$env:RELEASE_COMMIT-aws-native-staging"/g) ?? []).length, 2);
  assert.match(operationsWorkflow, /ACCEPTED_COMMIT: \$\{\{ steps\.request\.outputs\.imageCommit \}\}/);
  assert.match(operationsWorkflow, /--image "\$env:ACCEPTED_COMMIT-aws-native-staging"/);
  assert.match(oidcWorkflow, /ACCEPTED_IMAGE: [0-9a-f]{40}-aws-native-staging/);
  // deploy-app takes the tag from the one shared contract, which appends -aws-native-<environment>.
  assert.match(deployApp, /\$imageTag = Get-ApplicationImageTag -Environment \$Environment -Commit \$commit/);
  assert.match(await read('scripts/deploy-app-rollout-core.ps1'), /return "\$Commit-aws-native-\$\(\$Environment\.ToLowerInvariant\(\)\)"/);
});

test('staging image source archive contains the Docker and CodeBuild test inputs', async () => {
  const [publisher, module] = await Promise.all([read('scripts/publish-tracepoint-staging-image.ps1'), read('scripts/TracePoint.Staging.psm1')]);
  assert.match(publisher, /Get-TracePointStagingImageArchiveIncludes/);
  assert.match(module, /'database\/aws', 'scripts'/);
  assert.match(module, /scripts\/run-application-tests\.mjs/);
  assert.match(module, /scripts\/aws-native-migrations\.test\.mjs/);
});

test('staging source upload is bound to the expected AWS account', async () => {
  const publisher = await read('scripts/publish-tracepoint-staging-image.ps1');
  assert.match(publisher, /s3api put-object[^\r\n]*--expected-bucket-owner 559054714699/);
});

test('application image reuse only treats ECR ImageNotFoundException as absent', async () => {
  const [deploy, helper] = await Promise.all([read('scripts/deploy-app.ps1'), read('scripts/deploy-app-rollout-core.ps1')]);
  assert.match(deploy, /if \(-not \(Test-EcrImageNotFoundError -ErrorRecord \$_\)\) \{ throw \}/);
  assert.ok(helper.includes('ImageNotFoundException') && helper.includes('DescribeImages operation'));
});

test('staging release waits for runtime baseline and post-deploy health', async () => {
  const [release, orchestration] = await Promise.all([read('scripts/release-tracepoint-staging.ps1'), read('scripts/test-release-orchestration.ps1')]);
  assert.equal((release.match(/test-tracepoint-staging-runtime\.ps1'\) -WaitSeconds 900/g) ?? []).length, 2);
  // The staging-line orchestration test fails any runtime wait other than a fresh 900-second window.
  assert.match(orchestration, /if\(\$WaitSeconds -ne 900\)\{throw 'Each ALB convergence phase must start with a fresh bounded settling window'\}/);
});
