import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const template = await readFile(new URL('../infra/changesets/production-final-import-image-build-20260928/template.yml',
  import.meta.url), 'utf8');

test('isolated importer builder has exact source, repository and no runtime secret access', () => {
  assert.match(template, /TracePoint-ProductionFinalImportImageBuild-20260928/);
  assert.match(template, /tracepoint-final-import-f71f4ba826e6ec32ce613fbe07a6b6e74769838bd12c8df01443c8705ff48101\.zip/);
  assert.match(template, /U8kWj5Sv_7Ksd3JpyB0VdlJvD7_I6x\.V/);
  assert.match(template, /arn:aws:ecr:us-east-1:193644343389:repository\/tracepoint-production/);
  assert.doesNotMatch(template, /secretsmanager:GetSecretValue|tracepoint\/production\/final\/database-runtime/);
  assert.doesNotMatch(template, /ecs:RunTask|rds:|cognito-idp:|ses:|route53:/);
  assert.doesNotMatch(template, /WebHook|Webhook/);
});
