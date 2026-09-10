import test from 'node:test';
import assert from 'node:assert/strict';
import { DECOMMISSION_GATES, evaluateLegacyProviderDecommission, prepareLegacyProviderDecommission } from './legacy-provider-decommission-core.mjs';

const hash = character => character.repeat(64);
const evidence = {
  account: '222222222222', authorizationReference: 'OWNER-DECOMMISSION-2026', databaseManifestSha256: hash('a'), environment: 'production',
  gates: Object.fromEntries(DECOMMISSION_GATES.map(gate => [gate, true])), identityManifestSha256: hash('b'),
  observationWindow: { startedAt: '2026-09-01T00:00:00.000Z', endedAt: '2026-09-08T00:00:00.000Z', minimumHours: 168 },
  rollbackExportSha256: hash('c'), runtimeImageDigest: `sha256:${hash('d')}`, runtimeScanSha256: hash('e'), storageManifestSha256: hash('f'),
};
const now = new Date('2026-09-09T00:00:00.000Z');

test('prepares non-executable provider steps only after every safety gate', () => {
  assert.deepEqual(evaluateLegacyProviderDecommission(evidence, now), { eligible: true, failures: [] });
  const plan = prepareLegacyProviderDecommission(evidence, now);
  assert.equal(plan.executionAuthorized, false);
  assert.equal(plan.destructiveExecutionEnabled, false);
  assert.deepEqual(plan.providers.map(provider => provider.name), ['Supabase', 'Vercel', 'Brevo']);
});

test('refuses incomplete observation and every false gate', () => {
  assert.equal(evaluateLegacyProviderDecommission({ ...evidence, observationWindow: { ...evidence.observationWindow, endedAt: '2026-09-07T23:59:59.000Z' } }, now).eligible, false);
  for (const gate of DECOMMISSION_GATES) {
    const changed = { ...evidence, gates: { ...evidence.gates, [gate]: false } };
    assert.equal(evaluateLegacyProviderDecommission(changed, now).eligible, false, gate);
    assert.throws(() => prepareLegacyProviderDecommission(changed, now), new RegExp(gate));
  }
});

test('refuses future windows, staging accounts, and schema drift', () => {
  assert.equal(evaluateLegacyProviderDecommission(evidence, new Date('2026-09-07T00:00:00.000Z')).eligible, false);
  assert.equal(evaluateLegacyProviderDecommission({ ...evidence, account: '559054714699' }, now).eligible, false);
  assert.equal(evaluateLegacyProviderDecommission({ ...evidence, legacySecret: 'forbidden' }, now).eligible, false);
});

