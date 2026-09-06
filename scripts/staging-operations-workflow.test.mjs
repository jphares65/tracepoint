import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import yaml from 'js-yaml';
test('operations workflow cannot publish or deploy and restricts its OIDC session',()=>{
 const workflow=yaml.load(readFileSync('.github/workflows/aws-staging-operations.yml','utf8'));
 assert.deepEqual(workflow.on,{push:{branches:['codex/aws-staging-readiness-20260902'],paths:['.github/staging-operations.json']}});
 assert.equal(workflow.concurrency.group,'tracepoint-staging-release');assert.equal(workflow.concurrency['cancel-in-progress'],false);
 assert.deepEqual(Object.keys(workflow.jobs),['evidence']);const job=workflow.jobs.evidence;
 assert.equal(job.environment,'aws-staging');assert.equal(job.if,"github.ref == 'refs/heads/codex/aws-staging-readiness-20260902'");
 assert.deepEqual(job.env,{AWS_REGION:'us-east-1',AWS_DEFAULT_REGION:'us-east-1'});
 const credentialIndex=job.steps.findIndex(step=>step.id==='credentials'),credentials=job.steps[credentialIndex];
 assert.ok(job.steps.findIndex(step=>step.id==='request')<credentialIndex);
 assert.equal(credentials.with['allowed-account-ids'],'559054714699');assert.equal(credentials.with['managed-session-policies'],undefined);
 const policy=JSON.parse(credentials.with['inline-session-policy']);assert.equal(policy.Version,'2012-10-17');assert.equal(policy.Statement.length,1);assert.ok(JSON.stringify(policy).length<=600);
 assert.deepEqual(policy.Statement[0].Action,['cloudformation:DescribeStacks','ecs:DescribeServices','ecs:DescribeTasks','ecs:ListTasks','ecs:DescribeTaskDefinition','ecr:DescribeImageScanFindings','elasticloadbalancing:DescribeTargetHealth','cloudwatch:DescribeAlarms','logs:FilterLogEvents','budgets:ViewBudget','secretsmanager:GetSecretValue','kms:Decrypt']);
 assert.equal(policy.Statement[0].Condition.StringEquals['aws:RequestedRegion'],'us-east-1');
 assert.equal(policy.Statement[0].Effect,'Allow');assert.equal(policy.Statement[0].Resource,'*');
 assert.deepEqual(job.steps.filter(step=>step.run).map(step=>step.run),[
  'node scripts/validate-staging-operations-request.mjs',
  'node --test scripts/validate-staging-operations-request.test.mjs',
  'node scripts/collect-staging-release-evidence.mjs --image $env:ACCEPTED_IMAGE',
  'node scripts/collect-staging-operations-cost.mjs',
  'node scripts/collect-staging-log-diagnostics.mjs',
 ]);
 for(const step of job.steps.filter(step=>step.uses))assert.match(step.uses,/@[0-9a-f]{40}$/);
});
