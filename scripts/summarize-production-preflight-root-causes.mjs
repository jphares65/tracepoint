#!/usr/bin/env node
// Presentation-only grouping. Never changes or overrides the underlying fail-closed gate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateProductionCompositeReadiness } from './validate-production-composite-preflight.mjs';

const ROOTS = Object.freeze([
  { id: 'R1', cause: 'active-writer census and authoritative-state classification',
    category: 'writer-control evidence', dependencies: [],
    remediation: 'Reattest every active production key and writer; classify authoritative effects; bind family evidence to exact paths. Unknown holders of rejected old keys are closed only after direct retirement proof.',
    humanAction: 'Only if exact-project management inventory cannot be obtained through existing API/CLI access.' },
  { id: 'R2', cause: 'non-elevated source-writer controls and real-interface negatives',
    category: 'code/tooling + writer-control evidence', dependencies: ['R1'],
    remediation: 'Review the public trigger inverse; bind and rehearse exact ECS, Vercel, Auth, RPC, cron, notification and import-job controls; require direct negatives at freeze.',
    humanAction: 'Possibly one batched Supabase dashboard action if a control has no scoped API.' },
  { id: 'R3', cause: 'elevated old-credential epoch and active privileged holders',
    category: 'writer-control evidence + IAM/deployment', dependencies: ['R1'],
    remediation: 'Attest capture/rollback keys and IAM isolation; pin all old elevated keys; prepare retirement of old modern and legacy service credentials; directly reject old-key Auth, Storage and REST use during freeze.',
    humanAction: 'Old-key retirement may require one batched exact-project dashboard action during maintenance.' },
  { id: 'R4', cause: 'deterministic pre-authority abort and source restoration',
    category: 'code/tooling + writer-control evidence', dependencies: ['R2', 'R3'],
    remediation: 'Rehearse rollback-key distribution to a new pinned Vercel deployment and exact ECS secret revision, reverse all source controls, and prove Supabase-only write continuity.',
    humanAction: 'No known manual action for the preflight rehearsal.' },
  { id: 'R5', cause: 'capture-B atomic import and rollback not integrated end-to-end',
    category: 'importer rehearsal', dependencies: [],
    remediation: 'Run the exact image and importer contract against a clean isolated PostgreSQL/S3 lane using synthetic A/B artifacts; verify full apply, reconciliation, commit ambiguity, rollback and idempotency.',
    humanAction: 'No known manual action for the isolated rehearsal.' },
]);

const R2_PATHS = new Set(['publicAwsBridge', 'vercelProduction', 'authNewSession',
  'rpcFunctions', 'pgCron', 'notificationBackground', 'adminImport']);
const R3_PATHS = new Set(['authServiceAdmin', 'storageElevated', 'awsSourceRestHolders',
  'awsAppSecretReaders', 'externalCredentialHolders']);

export function rootForAssertion(assertion) {
  if (['ACTIVE_CREDENTIAL_INVENTORY_INCOMPLETE', 'UNKNOWN_ACTIVE_AUTONOMOUS_WRITERS'].includes(assertion) ||
    /^(WRITER_INVENTORY_OPEN|WRITER_STATE_UNCLASSIFIED|AUTHORITATIVE_WRITER_MISCLASSIFIED):/.test(assertion)) return 'R1';
  if (assertion === 'PUBLIC_TRIGGER_LAYER_UNPROVEN') return 'R2';
  if (assertion.startsWith('WRITER_PATH_CONTROL_UNPROVEN:')) {
    const path = assertion.slice('WRITER_PATH_CONTROL_UNPROVEN:'.length);
    if (R2_PATHS.has(path)) return 'R2';
    if (R3_PATHS.has(path)) return 'R3';
  }
  if (['CREDENTIAL_EPOCH_NOT_READY', 'OLD_EPOCH_RETIREMENT_UNPROVEN',
    'AUTH_SERVICE_ADMIN_WRITERS_UNCONTROLLED'].includes(assertion)) return 'R3';
  if (['UNFENCE_UNPROVEN', 'ROLLBACK_CREDENTIAL_DISTRIBUTION_UNPROVEN'].includes(assertion)) return 'R4';
  if (assertion === 'FINAL_FROZEN_ARTIFACT_APPLY_NOT_READY') return 'R5';
  throw new Error(`UNMAPPED_PREFLIGHT_ASSERTION:${assertion}`);
}

export function summarizeRootCauses(evidence) {
  const gate = evaluateProductionCompositeReadiness(evidence);
  const grouped = new Map(ROOTS.map(root => [root.id, []]));
  for (const assertion of gate.blockers) grouped.get(rootForAssertion(assertion)).push(assertion);
  const roots = ROOTS.filter(root => grouped.get(root.id).length).map(root => ({
    ...root, failedAssertions: grouped.get(root.id),
  }));
  assert.equal(roots.reduce((sum, root) => sum + root.failedAssertions.length, 0), gate.blockers.length);
  return { status: gate.status, projectRef: gate.projectRef, remainingRootCauses: roots.length, roots };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert.equal(process.argv.length, 3, 'EXACT_EVIDENCE_FILE_REQUIRED');
    console.log(JSON.stringify(summarizeRootCauses(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'PRODUCTION_COMPOSITE_PREFLIGHT_BLOCKED',
      code: error?.message ?? 'INVALID_EVIDENCE' }));
    process.exitCode = 2;
  }
}
