import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const template = await readFile(new URL('../infra/changesets/production-final-import-image-build-20260928/template.yml',
  import.meta.url), 'utf8');

test('isolated importer builder has exact source, repository and no runtime secret access', () => {
  assert.match(template, /TracePoint-ProductionFinalImportImageBuild-20260928/);
  assert.match(template, /tracepoint-final-import-1f048d0f519732c0c272bce5d277bad34f5bb4539b357b5bb8c6449ce4442310\.zip/);
  assert.match(template, /fjAalP7a1BlG9I2gReNl5xQDYTTUXKLr/);
  assert.match(template, /arn:aws:ecr:us-east-1:193644343389:repository\/tracepoint-production/);
  assert.doesNotMatch(template, /secretsmanager:GetSecretValue|tracepoint\/production\/final\/database-runtime/);
  assert.doesNotMatch(template, /ecs:RunTask|rds:|cognito-idp:|ses:|route53:/);
  assert.doesNotMatch(template, /WebHook|Webhook/);
});
