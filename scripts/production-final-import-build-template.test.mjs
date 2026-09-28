import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const template = await readFile(new URL('../infra/changesets/production-final-import-image-build-20260928/template.yml',
  import.meta.url), 'utf8');

test('isolated importer builder has exact source, repository and no runtime secret access', () => {
  assert.match(template, /TracePoint-ProductionFinalImportImageBuild-20260928/);
  assert.match(template, /tracepoint-final-import-455e707625b4f2b0fd10f08a21a2dfa0bbfa5d26a1a1f81451491f1b64465cbf\.zip/);
  assert.match(template, /u5hqrPTUGWxs5H_Syt4w4xW7zqoWCVZb/);
  assert.match(template, /arn:aws:ecr:us-east-1:193644343389:repository\/tracepoint-production/);
  assert.doesNotMatch(template, /secretsmanager:GetSecretValue|tracepoint\/production\/final\/database-runtime/);
  assert.doesNotMatch(template, /ecs:RunTask|rds:|cognito-idp:|ses:|route53:/);
  assert.doesNotMatch(template, /WebHook|Webhook/);
});
