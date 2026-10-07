import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import yaml from "js-yaml";
const root = new URL("../", import.meta.url);
test("lease renewal is protected, staging-only, and has no bootstrap/runtime side effects", async () => {
  const [script, workflow] = await Promise.all([
    readFile(new URL("scripts/renew-staging-database-lease.ps1", root), "utf8"),
    readFile(new URL(".github/workflows/aws-staging-database-lease.yml", root), "utf8"),
  ]);
  const parsedWorkflow = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
  assert.equal(parsedWorkflow.name, "Renew staging database lease");
  assert.deepEqual(Object.keys(parsedWorkflow.on), ["workflow_dispatch"]);
  assert.equal(parsedWorkflow.on.workflow_dispatch.inputs.expires_after_utc.required, true);
  assert.equal(parsedWorkflow.on.workflow_dispatch.inputs.expires_after_utc.type, "string");
  assert.equal(parsedWorkflow.permissions.contents, "read");
  assert.equal(parsedWorkflow.permissions["id-token"], "write");
  assert.equal(parsedWorkflow.concurrency.group, "tracepoint-staging-database-lease");
  assert.equal(parsedWorkflow.concurrency["cancel-in-progress"], false);
  const renewJob = parsedWorkflow.jobs.renew;
  assert.equal(renewJob.if, "github.ref == 'refs/heads/main'");
  assert.equal(renewJob.environment, "aws-staging");
  const credentialStep = renewJob.steps.find((step) => String(step.uses).startsWith("aws-actions/configure-aws-credentials@"));
  assert.equal(credentialStep.with["allowed-account-ids"], "559054714699");
  const leaseStep = renewJob.steps.find((step) => step.shell === "pwsh");
  assert.equal(leaseStep.env.LEASE_EXPIRES_AFTER_UTC, "${{ inputs.expires_after_utc }}");
  assert.equal(leaseStep.env.LEASE_OWNER, "github-${{ github.actor }}");
  assert.equal(leaseStep.env.LEASE_REFERENCE, "github:${{ github.run_id }}:${{ github.run_attempt }}");
  assert.match(script, /tracepoint-staging-database/);
  assert.match(script, /create-change-set/);
  assert.match(script, /validate-database-lease-changeset/);
  for (const forbidden of [/bootstrap/i, /migration/i, /publish/i, /ecs/i, /cognito/i, /secretsmanager/i, /cdk deploy/i]) assert.doesNotMatch(script, forbidden);
  assert.match(workflow, /environment: aws-staging/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /allowed-account-ids: '559054714699'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /renew-staging-database-lease\.ps1/);
  assert.match(workflow, /LEASE_EXPIRES_AFTER_UTC: \$\{\{ inputs\.expires_after_utc \}\}/);
  assert.match(workflow, /LEASE_OWNER: github-\$\{\{ github\.actor \}\}/);
  assert.match(workflow, /LEASE_REFERENCE: github:\$\{\{ github\.run_id \}\}:\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /-ExpiresAfterUtc \$env:LEASE_EXPIRES_AFTER_UTC/);
  assert.match(workflow, /-LeaseOwner \$env:LEASE_OWNER/);
  assert.match(workflow, /-LeaseReference \$env:LEASE_REFERENCE/);
  for (const forbidden of [/bootstrap/i, /migration/i, /publish/i, /DeployRuntime/i, /DeployFoundations/i]) assert.doesNotMatch(workflow, forbidden);
});
