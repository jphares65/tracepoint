import assert from 'node:assert/strict';
import test from 'node:test';
import { compareBaseline, normalizeLintResults } from './lint-ratchet.mjs';

const finding = (path, ruleId, message, count = 1) => ({ path, ruleId, severity: 2, message, count });
test('lint ratchet ignores ordering, allows debt removal, and blocks new counts', () => {
  const baseline = { version: 1, findings: [finding('src/a.ts', 'rule/a', 'Old violation', 2)] };
  assert.equal(compareBaseline(baseline, [finding('src/a.ts', 'rule/a', 'Old violation', 1)]).introduced.length, 0);
  assert.equal(compareBaseline(baseline, [finding('src/a.ts', 'rule/a', 'Old violation', 1)]).removed[0].count, 1);
  assert.equal(compareBaseline(baseline, [finding('src/a.ts', 'rule/a', 'Old violation', 3)]).introduced[0].count, 1);
  assert.equal(compareBaseline(baseline, [finding('src/new.ts', 'rule/a', 'Old violation')]).introduced[0].path, 'src/new.ts');
});
test('normalization groups stable ESLint attributes rather than output ordering', () => {
  const normalized = normalizeLintResults([{ filePath: `${process.cwd()}/src/a.ts`, messages: [{ ruleId: 'rule/a', severity: 2, message: 'A  message\nwith space' }, { ruleId: 'rule/a', severity: 2, message: 'A message with space' }] }]);
  assert.deepEqual(normalized, [finding('src/a.ts', 'rule/a', 'A message with space', 2)]);
});
