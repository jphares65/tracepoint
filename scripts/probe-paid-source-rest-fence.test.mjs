import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { classifyFenceResponse } from './probe-paid-source-rest-fence.mjs';

test('only PostgreSQL frozen-write rejection is accepted', () => {
  assert.equal(classifyFenceResponse(500, { code: '55000' }), 'FENCE_REJECTED');
  assert.equal(classifyFenceResponse(200, {}), 'FENCE_NOT_PROVEN');
  assert.equal(classifyFenceResponse(409, { code: '23505' }), 'FENCE_NOT_PROVEN');
  assert.equal(classifyFenceResponse(403, { code: '42501' }), 'FENCE_NOT_PROVEN');
});

test('probe has exact project, credential, synthetic target and no dynamic mutation inputs', () => {
  const script = readFileSync(new URL('./probe-paid-source-rest-fence.mjs', import.meta.url), 'utf8');
  assert.match(script, /reukdouvpshshvqnzsgw\.supabase\.co/);
  assert.match(script, /source-rehearsal-only-20260925/);
  assert.match(script, /4fe22291-4da8-4e98-acbe-e12be4a943ad/);
  assert.match(script, /tracepoint_source_rehearsal_fence_status/);
  assert.doesNotMatch(script, /process\.argv\[2\]/);
  assert.doesNotMatch(script, /console\.log\([^\n]*(?:key|SecretString)/);
});
