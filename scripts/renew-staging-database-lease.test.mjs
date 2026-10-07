import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import yaml from "js-yaml";

const root = new URL("../", import.meta.url);
test("lease renewal is protected, staging-only, and writes only the SSM lease parameter", async () => {
  const [script, workflow, guard, release] = await Promise.all([
    readFile(new URL("scripts/renew-staging-database-lease.ps1", root), "utf8"),
    readFile(new URL(".github/workflows/aws-staging-database-lease.yml", root), "utf8"),
    readFile(new URL("scripts/TracePoint.Staging.psm1", root), "utf8"),
    readFile(new URL("scripts/release-tracepoint-staging.ps1", root), "utf8"),
  ]);
  const parsedWorkflow = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
  assert.equal(parsedWorkflow.name, "Renew staging database lease");
  assert.deepEqual(Object.keys(parsedWorkflow.on), ["workflow_dispatch"]);
  assert.equal(parsedWorkflow.on.workflow_dispatch.inputs.expires_after_utc.required, true);
  assert.equal(parsedWorkflow.permissions.contents, "read");
  assert.equal(parsedWorkflow.permissions["id-token"], "write");
  assert.equal(parsedWorkflow.concurrency.group, "tracepoint-staging-database-lease");
  const renewJob = parsedWorkflow.jobs.renew;
  assert.equal(renewJob.if, "github.ref == 'refs/heads/main'");
  assert.equal(renewJob.environment, "aws-staging");
  const credentialStep = renewJob.steps.find((step) => String(step.uses).startsWith("aws-actions/configure-aws-credentials@"));
  assert.equal(credentialStep.with["allowed-account-ids"], "559054714699");
  const leaseStep = renewJob.steps.find((step) => step.shell === "pwsh");
  assert.equal(leaseStep.env.LEASE_EXPIRES_AFTER_UTC, "${{ inputs.expires_after_utc }}");
  assert.equal(leaseStep.env.LEASE_OWNER, "github-${{ github.actor }}");
  assert.equal(leaseStep.env.LEASE_REFERENCE, "github:${{ github.run_id }}:${{ github.run_attempt }}");
  assert.match(script, /ssm put-parameter/);
  assert.match(script, /ssm get-parameter/);
  assert.match(script, /\/tracepoint\/staging\/database-release-lease/);
  assert.match(script, /--type String/);
  assert.match(script, /--overwrite/);
  assert.match(script, /validate-staging-database-release-lease/);
  assert.match(guard, /Assert-TracePointStagingDatabaseReleaseLease/);
  assert.match(release, /Assert-TracePointStagingDatabaseReleaseLease/);
  assert.doesNotMatch(release, /ExpiresAfterUTC|LeaseOwner|LeaseReference|tracepoint-staging-database/);
  for (const forbidden of [/cloudformation/i, /change-set/i, /bootstrap/i, /migration/i, /publish/i, /ecs/i, /cognito/i, /secretsmanager/i, /aws-cdk-lib/i, /cdk\s+(?:synth|diff|deploy)/i, /infra[\\/]/i]) assert.doesNotMatch(script, forbidden);
  for (const forbidden of [/bootstrap/i, /migration/i, /publish/i, /DeployRuntime/i, /DeployFoundations/i]) assert.doesNotMatch(workflow, forbidden);
});
