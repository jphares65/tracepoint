import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/app/api/internal/rehearsal-tenant-negative/route.ts', import.meta.url), 'utf8');

test('isolated authenticated proof cannot run on a production origin or pool', () => {
  assert.match(source, /shadow-rehearsal\.tracepointhq\.com/);
  assert.match(source, /us-east-1_wZwXHpznS/);
  assert.match(source, /TRACEPOINT_RUNTIME_PROVIDER_MODE !== "aws-native"/);
  assert.match(source, /NEXT_PUBLIC_SITE_URL !== `https:\/\/\$\{HOST\}`/);
  assert.match(source, /request\.headers\.get\("host"\) !== HOST/);
  assert.match(source, /request\.headers\.get\("x-forwarded-proto"\) !== "https"/);
});

test('proof is restricted to the two synthetic Officer identities and fixed tenant pairs', () => {
  assert.match(source, /jphares\+montville-rehearsal@tracepointhq\.com/);
  assert.match(source, /jphares@tracepointhq\.com/);
  assert.match(source, /access\.context\.roleCodes\[0\] !== "officer"/);
  assert.match(source, /access\.context\.departmentId !== target\.own/);
  assert.match(source, /status\("fleet\/foreign"/);
  assert.match(source, /status\("firearm\/foreign"/);
  assert.match(source, /status\("equipment\/foreign"/);
  assert.match(source, /status\("settings\/foreign"/);
  assert.match(source, /status\("object\/foreign"/);
});

test('proof forwards the browser session only to the same container and makes no mutation call', () => {
  assert.match(source, /http:\/\/127\.0\.0\.1:3000/);
  assert.match(source, /operation: "select"/);
  assert.doesNotMatch(source, /method: "(?:PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(source, /console\.(?:log|info|error)\([^\n]*sessionCookie/);
});
