import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const template = await readFile(new URL('../infra/changesets/production-final-import-image-build-20260928/template.yml',
  import.meta.url), 'utf8');

test('isolated importer builder has exact source, repository and no runtime secret access', () => {
  assert.match(template, /TracePoint-ProductionFinalImportImageBuild-20260928/);
  assert.match(template, /tracepoint-final-import-41f3642f362caaa8fe117d726b6ad56c71214f7c8bf040b71d17de3b0c581abd\.zip/);
  assert.match(template, /0qSNd2uMv1uCPqrkiJ0YgcxApNC\.42UT/);
  assert.match(template, /arn:aws:ecr:us-east-1:193644343389:repository\/tracepoint-production/);
  assert.doesNotMatch(template, /secretsmanager:GetSecretValue|tracepoint\/production\/final\/database-runtime/);
  assert.doesNotMatch(template, /ecs:RunTask|rds:|cognito-idp:|ses:|route53:/);
  assert.doesNotMatch(template, /WebHook|Webhook/);
});
