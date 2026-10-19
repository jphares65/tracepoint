# Staging release candidate: Agency Documents on the staging line (2026-10-18)

Branch `claude/staging-release-agency-documents`. Nothing has been deployed, published,
migrated or changed in AWS. Validation evidence is in the commit history and the final
report; this file is the operator's procedure.

## What the candidate contains

| Line | Tip | How it is included |
| --- | --- | --- |
| Staging line (`codex/demo-pd-module-visibility`) | `c343e4be` | Base. Contains the deployed staging app `a3fa985` (recorded 2026-10-17) and its 5 later migration-reconciliation commits; all 65 staging-only commits are ancestors. |
| Production line + Agency Documents (`claude/agency-documents-integration`) | `0f2d75e0` | Merged (`49e76310`). Contains production `e49e73dc` and the hardened Agency Documents feature. |
| Follow-ups | after the merge | Template revision immutability; 042-045 ledger check fix; production lint typing; test/workflow alignment. |

Files changed by only one line are byte-identical to that line's tip, except the
deliberate edits listed in the merge and follow-up commit messages.

## Migration lineage

Files `database/aws/001`–`045`, contiguous, unique versions:

| Version | File | Staging (expected) |
| --- | --- | --- |
| 001–037 | historical | recorded |
| 038–041 | Agency Documents | recorded (038 row hash `83f1ffdb…`, CRLF archive bytes, read by the 2026-10-13 diagnostics; 039–041 implied by the staging runbook's "contiguous 001–041" precondition — **not yet observed**) |
| 042 | `default_module_entitlements` | pending (never applied: the deployed `a3fa985` shipped it as 038, which collided with the recorded Agency Documents row) |
| 043 | `range_workspace_authenticated_writes` (production's 038) | pending |
| 044 | `cognito_password_global_scope` (production's 039) | pending |
| 045 | `password_operation_resolution` (production's 040) | pending |

Staging hashes are of the canonical archive bytes (`git -c core.autocrlf=true archive`),
which `apply-app-migrations.ps1` keeps for staging. Nothing previously applied is re-run:
the runner's staging `apply` refuses unless 001–041 are recorded with exactly matching
filenames and hashes and exactly 042, 043, 044 and 045 are pending.

## Before deployment

1. `aws sso login --profile tracepoint-member-staging` (the SSO session has expired).
2. Read-only state capture (no changes):
   - ECS: `aws ecs describe-services --cluster tracepoint-staging --services tracepoint-staging`
     and `describe-task-definition` for its task — record the task definition ARN and image
     digest. Expect the `a3fa985…` image; if staging runs anything else, stop and re-review.
   - Ledger: `scripts/migrate-db.ps1 staging -Action diagnose -ImageCommit a3fa9855f4c797dfb7b4dd16144cf6c85a445946`
     from this branch. Read-only for the database; note it first builds and pushes an
     immutable `migration-<tooling commit>` image in CodeBuild/ECR. Then, after step 3 publishes the candidate
     image, `-Action status` must show 001–041 applied and 042–045 pending with no drift.
   - Password operations: confirm there are no unresolved `authentication_lifecycle_operations`
     on staging. After 044 such users' membership/platform-admin changes are refused until
     resolved (production resolved them in one reviewed unit; staging applies 044 and 045 in order).
   - Confirm a recent RDS restore point (the release script checks PITR freshness); take a
     manual snapshot if policy requires.
3. From a clean checkout of this branch, run the existing migration-first procedure
   `scripts/release-entitlements-staging.ps1` (approved branch list now includes this branch).
   It publishes and scans the image in CodeBuild — the staging Docker build runs the lint
   ratchet, the application suite and the migration tests — verifies status, asks
   `APPLY 042-045`, verifies all four ledger rows, then asks `DEPLOY APPLICATION`.
4. After deployment: confirm health, Cognito login (web and mobile bearer), module visibility
   for demo agencies, Range Day save/load, and an Agency Documents generate → unpublish →
   "revision 2" cycle with synthetic data.

## Rollback (preserves the current staging environment)

- **Before the database step**, nothing in staging changes; abandon the release.
- **Application:** the release records the pre-rollout task definition and digest. On a
  failed deployment `release-entitlements-staging.ps1` restores it automatically
  (`deploy-app.ps1 staging -RollbackTaskDefinitionArn <prior>`). Manually:
  `scripts/invoke-tracepoint-staging-rollback.ps1 -TaskDefinitionArn <prior> -ExpectedImageDigest <recorded digest> -Execute`.
  The rollback verifies the running task serves exactly that digest.
- **Database:** 042–045 are additive and are not reversed automatically. The prior app
  `a3fa985` does not read the new objects; its migration runner already reports drift at 038
  and is not used for this release. A full database rollback is a restore from the
  pre-release snapshot/PITR into a new instance — an operational decision, not a script.
- Do not retry a partially failed apply blindly: run `status`, reconcile, then decide.

## Known limitations

- Docker could not be built locally (Docker is not installed on the release workstation);
  the CodeBuild image build in step 3 is the first real Docker build of this candidate.
- `042_default_module_entitlements` enables every active feature for every existing agency
  (noted for production in `docs/production-followups-20261017.md`); intended for staging demo
  agencies, not cleared for production.
- Production is not a target of this candidate. Its ledger-adoption path still refuses
  (see `docs/agency-documents-integration-20261018.md`).
