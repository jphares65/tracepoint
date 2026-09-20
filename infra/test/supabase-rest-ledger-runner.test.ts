import * as assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { SupabaseRestLedgerRunnerStack } from '../lib/supabase-rest-ledger-runner-stack';

const app = new cdk.App();
const stack = new SupabaseRestLedgerRunnerStack(app, 'RestLedger', { env: { account: '193644343389', region: 'us-east-1' }, runId: '4272874f-bae4-49f4-a0b4-67a39cec2874', authorizationReference: 'TP-FINAL-DB-20260920-4272874FBAE4', commit: 'a'.repeat(40), imageDigest: `sha256:${'b'.repeat(64)}`, repositoryName: 'tracepoint-production', clusterName: 'tracepoint-production', vpcId: 'vpc-04accb4047a914176', publicSubnetIds: ['subnet-0f4cbed3e60d90bfc', 'subnet-0a117bec5cb98607f'], sourceSecretArn: 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/migration/source-supabase-rest-wvh4pi' });
const template = Template.fromStack(stack).toJSON();
const text = JSON.stringify(template);
assert.match(text, /TracePoint-RestLedgerExec-4272874f/);
assert.match(text, /source-supabase-rest-wvh4pi/);
assert.doesNotMatch(text, /source-postgres|targetSecret|rds\.amazonaws\.com|TaskRole/);
assert.match(text, /"FromPort":443/);
assert.doesNotMatch(text, /"FromPort":5432/);
assert.match(text, /"ReadOnlyDedicatedSupabaseRestSecret"/);
assert.doesNotMatch(text, /ListSecrets|PutSecretValue|UpdateSecret|DeleteSecret/);
