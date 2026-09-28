# Production composite source-fence and double-capture package

Status: **BLOCKED BEFORE MAINTENANCE**. This revision replaces the impossible
244-trigger Auth/Storage owner-control requirement. The paid Supabase rehearsal
proved composite quiescence, two immutable captures, zero canonical delta, and
restoration. It did **not** prove that the same reversible controls are
available for every live production writer. Never substitute this document or
an operator-signed attestation for a real-interface negative test.

## Exact source and read-only preflight

- Supabase project: `izlkwggluhlhzlumtzes`; REST origin:
  `https://izlkwggluhlhzlumtzes.supabase.co`.
- Pinned read-only PostgreSQL endpoint: `aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
  read-only reader secret: `tracepoint/production/migration/source-postgres` in
  AWS account `193644343389`, `us-east-1`. TLS CA and hostname validation stay on.
- Catalog: 122 relations (87 `public`, 27 `auth`, eight `storage`), fingerprint
  `36558b0730e3e96cad6426f38088a5b0`. Only `public` requires trigger
  ownership. The SQL Editor `postgres` role owns all 87 public relations and
  does not own the 35 managed Auth/Storage relations.
- Production Storage S3 protocol is enabled; the signed-in production project
  showed **no separate S3 access keys** at the 2026-09-27 read-only inspection.
  Recheck immediately before maintenance. If a key appears, inventory its
  holder and prove reversible disable/restore in paid rehearsal before use.
- `scripts/inspect-production-fence-ownership.mjs --readiness` checks the exact
  catalog/TLS/public ownership. `scripts/validate-production-composite-preflight.mjs`
  checks writer coverage, reversible controls, capture A/B, maintenance,
  S3-key state and unfence. Both must pass on fresh, reviewed evidence.

Current preflight evidence is intentionally incomplete. In particular the
production Auth API, Storage API, modern-key/service-role holders, and direct
external API callers have no verified production-specific reversible block and
real-interface negative in the inventory. The public ALB 503 is not an Auth or
Storage API fence. The activation SQL therefore retains an explicit
`PRODUCTION_COMPOSITE_PREFLIGHT_BLOCKED` exception. Do not reopen maintenance
or remove that exception until these gaps close in a subsequent reviewed commit.
The [path-level writer inventory](production-authoritative-writer-inventory-20260927.md)
now lists 17 distinct non-operator routes, including historical Vercel Preview,
already-issued Auth sessions, direct RPC, import jobs, and source-secret
readers. Both the preflight and the capture-time composite attestation require
an exact entry for every route; broad family-level PASS flags are insufficient.
Each route requires pinned negative evidence and an inverse, or (for the
currently absent separate S3-key class) fresh exact-project absence evidence
at freeze time. No route has been declared controlled by this inventory alone.

## Cutover execution sequence (only after preflight PASS)

1. Activate the reviewed host-scoped public maintenance 503 and verify it
   externally; retain the exact listener reversal. Verify no application task
   or independent worker can continue source writes.
2. Apply each reviewed reversible operational control to the exact source:
   application/API, service-role/server/background, Auth, Storage, scheduled
   import/admin automation, and any separate S3 writer. Drain in-flight work.
   Do not delete/rotate modern Supabase keys as a fence. The trusted operator
   may retain theoretical write capability but must make no manual source write
   while frozen.
3. In the production-project SQL Editor only, run
   `supabase/production-cutover/20260927_activate_source_fence.sql`. It guards
   the full catalog, installs 174 `ENABLE ALWAYS` triggers on the 87 public
   tables, and pauses the one pinned notification pg_cron dispatcher. It does
   not alter Supabase-managed Auth/Storage tables. Verify the fixed status RPC.
4. Run direct writer negatives through each real interface and check unchanged
   authoritative before/after state, no delayed write, and no unexpected
   operator activity. Only after all pass, create the reviewed composite
   attestation at exact private S3 key
   `migration/source/composite-fence-20260927/attestation.json`. Record its
   S3 VersionId and whole-file SHA-256. Include each writer family's sanitized
   direct-negative evidence SHA-256 and exact inverse-procedure SHA-256, not
   just a PASS assertion. The capture runner fails closed without those values
   or if its timestamp/controls/project mismatch.
5. Deploy the reviewed update to the isolated CodeBuild capture-executor stack
   by change set. Its role must read only the exact production capture-epoch
   secret (not the old migration REST or rollback/resume secret),
   content-addressed build source, one attestation key, and two fixed output
   keys. Do not update the deployed stack or start capture while preflight is
   BLOCKED. Recheck IAM boundary and effective permissions before use.
   `pwsh -NoProfile -File scripts/package-production-final-capture.ps1`
   creates a local content-addressed source ZIP from nine explicit code/build
   files, rejects dirty capture sources, and verifies the archive entry list.
   The local package is **not** a deployed executor: upload it to the exact
   reviewed build-source bucket with versioning, record its VersionId and
   SHA-256, and update only the capture stack's `SourceZipKey` through a
   reviewed change set after the composite preflight is complete. The pinned
   composite attestation must use format
   `tracepoint-production-composite-fence/v3` and include direct proof that
   the old modern key is rejected, the legacy service key is disabled, the
   capture key reads, and the rollback key remains unassigned to writers.
6. Start capture slot A with run ID
   `1d761bd7-04dd-43f3-b77a-2c41130e18c2`, attestation VersionId and SHA-256.
   Record the CodeBuild ID, immutable S3 VersionId, byte SHA-256 and canonical
   master hash. Wait at least 60 seconds, verify every control still active,
   then start separate slot B with run ID
   `c7448ea9-4645-4e99-b988-3a05de12ac70` and the **same** attestation
   version/hash. Both runs are create-only and source-read-only.
7. Run `scripts/compare-frozen-source-captures.mjs` in AWS with exact A/B
   keys, VersionIds, byte SHA-256 values and `--minimum-quiet-seconds 60`.
   Require `FROZEN_SOURCE_QUIESCENT`, zero relation/identity/membership/object
   delta, unchanged fence timestamp and source project. Designate B as the
   final artifact **only** after this result. Then continue the separately
   guarded final target apply/reconciliation gate.

The exact CodeBuild invocation is `aws codebuild start-build --project-name
tracepoint-production-final-source-capture-20260927 --environment-variables-override
name=TRACEPOINT_SOURCE_PRODUCTION_CAPTURE_SLOT,value=A,type=PLAINTEXT
name=TRACEPOINT_SOURCE_PRODUCTION_RUN_ID,value=1d761bd7-04dd-43f3-b77a-2c41130e18c2,type=PLAINTEXT
name=TRACEPOINT_COMPOSITE_FENCE_VERSION_ID,value=<attested-version>,type=PLAINTEXT
name=TRACEPOINT_COMPOSITE_FENCE_SHA256,value=<attested-sha256>,type=PLAINTEXT
--profile tracepoint-production --region us-east-1` for A. After A succeeds
and the quiet interval, use the same command for B, changing only slot to `B`
and run ID to `c7448ea9-4645-4e99-b988-3a05de12ac70`; preserve the same
attestation VersionId/hash. Supply the exact values from the reviewed
attestation, never a mutable latest-version reference. Stop if the change-set
review, two-key IAM scope, or source ZIP hash differs from this package.
The AWS-local comparison uses the **same exact CodeBuild project and source
ZIP**, with `--buildspec-override buildspec.source-production-double-compare.yml`
and four plaintext metadata overrides:
`TRACEPOINT_CAPTURE_A_VERSION_ID`, `TRACEPOINT_CAPTURE_A_SHA256`,
`TRACEPOINT_CAPTURE_B_VERSION_ID`, `TRACEPOINT_CAPTURE_B_SHA256`. These are
artifact identifiers/hashes, never customer data or credentials. The runner
uses `IfNoneMatch: '*'` for create-only writes; the comparator performs only
version-pinned reads. The exact-key role still has `PutObject`, so immutable
VersionIds and whole-file hashes remain mandatory. The comparison buildspec
has no source secret.

No customer row payload, object contents, server key or authorization token is
logged or downloaded to a workstation. Capture failures never relax the fence.

## Exact pre-authority abort

While public maintenance is still active, first prove the bridge remains sole
authority and no AWS-only write occurred. Verify the exact catalog, active
public fence, 174 triggers, dispatcher snapshot/command hash, and all external
controls. If the old modern source key has been retired, use the pre-created
rollback/resume key: replace only the elevated key field in the exact ECS
application and migration REST secrets, update the Production Vercel secret
variable, and create a **new** pinned Production deployment. An older Vercel
deployment retains its old environment and is not a valid rollback target.
Verify the new deployment and ECS task read/write through the rollback key
while maintenance remains on. In the exact production SQL Editor execute
`supabase/production-cutover/20260927_abort_source_fence.sql` to remove only
the public-table trigger layer and restore its pinned dispatcher. Reverse
each external control using its reviewed inverse; verify app, Auth, Storage,
service-role, and scheduler write continuity. Only then reverse the reviewed
maintenance stack and verify normal production forwarding. Any mismatch is a
stop gate, not a reason to improvise. This pre-authority abort is prohibited
after AWS-only writes; use the separate data-authority rollback runbook then.
