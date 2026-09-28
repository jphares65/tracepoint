import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const template = await readFile(new URL('../infra/changesets/production-final-import-task-20260928/template.yml',
  import.meta.url), 'utf8');

test('one-shot importer task is digest pinned and cannot start without frozen capture overrides', () => {
  assert.equal((template.match(/@sha256:b88c77d4b1938a05a6fbf963ae508c22dc0937ae35ff82595fa69c0c44c1bd24/g) ?? []).length, 3);
  assert.match(template, /db-X4DYNS3TMVSAP7Z3RISDWEYDVE/);
  assert.match(template, /tracepoint-production-final-cutover-20260926\.c8r4sgs089tu\.us-east-1\.rds\.amazonaws\.com/);
  assert.doesNotMatch(template, /TRACEPOINT_FINAL_IMPORT_EXECUTE|TRACEPOINT_FINAL_OBJECT_COPY_EXECUTE/);
  assert.doesNotMatch(template, /AWS::ECS::Service|AWS::ElasticLoadBalancing|AWS::Route53/);
  assert.doesNotMatch(template, /source-production-epoch-capture|source-production-epoch-rollback|source-supabase-rest/);
  assert.match(template, /SourceSecurityGroupId: !Ref ImporterSecurityGroup/);
  assert.match(template, /s3:prefix: \[department-assets\/, attachments\/\]/);
});

test('target attestation has a read-only entrypoint and no importer execution guard', () => {
  const probe = template.slice(template.indexOf('  ReadOnlyTargetProbeTaskDefinition:'));
  assert.match(probe, /Family: tracepoint-production-final-target-readonly-probe-20260928/);
  assert.match(probe, /EntryPoint:[\s\S]*?- node[\s\S]*?- -e/);
  assert.match(probe, /begin transaction read only/);
  assert.match(probe, /await c\.query\('rollback'\)/);
  assert.doesNotMatch(probe, /run-production-final-import-task|TRACEPOINT_FINAL_IMPORT_EXECUTE/);
});
