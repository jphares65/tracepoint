import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const template = await readFile(new URL('../infra/changesets/production-final-import-image-build-20260928/template.yml',
  import.meta.url), 'utf8');

test('isolated importer builder has exact source, repository and no runtime secret access', () => {
  assert.match(template, /TracePoint-ProductionFinalImportImageBuild-20260928/);
  assert.match(template, /tracepoint-final-import-01c030f154e79c6550d779d1675174e06c08ac1874f4ead72f0dfbd0f3cde02c\.zip/);
  assert.match(template, /K5zccTEbmgYnEsm_YVY.71siViVcsoYg/);
  assert.match(template, /arn:aws:ecr:us-east-1:193644343389:repository\/tracepoint-production/);
  assert.doesNotMatch(template, /secretsmanager:GetSecretValue|tracepoint\/production\/final\/database-runtime/);
  assert.doesNotMatch(template, /ecs:RunTask|rds:|cognito-idp:|ses:|route53:/);
  assert.doesNotMatch(template, /WebHook|Webhook/);
});
