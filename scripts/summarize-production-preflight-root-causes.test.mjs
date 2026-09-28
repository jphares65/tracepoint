import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rootForAssertion, summarizeRootCauses } from './summarize-production-preflight-root-causes.mjs';
import { evaluateProductionCompositeReadiness } from './validate-production-composite-preflight.mjs';

const evidence = JSON.parse(readFileSync(new URL('../docs/production-composite-preflight-evidence-20260927.json', import.meta.url)));

test('all current fail-closed assertions map to one concrete cause without changing the gate', () => {
  const gate = evaluateProductionCompositeReadiness(evidence);
  const summary = summarizeRootCauses(evidence);
  assert.equal(summary.status, gate.status);
  assert.equal(summary.remainingRootCauses, 5);
  assert.deepEqual(summary.roots.flatMap(root => root.failedAssertions).sort(), [...gate.blockers].sort());
  assert.deepEqual(summary.roots.map(root => root.id), ['R1', 'R2', 'R3', 'R4', 'R5']);
});

test('an unknown future failure cannot disappear into a generic root', () => {
  assert.throws(() => rootForAssertion('NEW_UNREVIEWED_SAFETY_FAILURE'), /UNMAPPED_PREFLIGHT_ASSERTION/);
});
