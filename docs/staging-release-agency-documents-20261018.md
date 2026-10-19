# Staging release candidate: Agency Documents on the staging line (2026-10-18)

Branch `claude/staging-rc-agency-documents-20261018` (supersedes
`claude/staging-release-agency-documents` at `bd615bb5`, which is left unchanged). Validation
evidence is in the commit history and the final report; this file is the operator's procedure.

## 2026-10-19 release of `e3b06e6a`: migrations applied, application rolled back

What happened (times UTC, from ECS service events, task records, ALB metrics and logs):

| Time | Event |
| --- | --- |
| 02:49 | Migrations 043, 044, 045 applied once; ledger 001–045, 0 pending (rows recorded by `e3b06e6a`). |
| 03:04:58 | Revision 186 task `8b4834c6` started (image `sha256:0c575c7c…`); "Ready" at 03:05:26, no errors logged. |
| 03:05:28 | 186 registered with the ALB target group. |
| 03:06:19–29 | Revision 185 task `84bdb205` stopping; its target deregistered and **draining** (deregistration delay 300 s, so until about 03:11:29). |
| 03:07:29 | ECS: deployment completed, steady state. `deploy-app.ps1` verified 186 (it sets draining targets aside). |
| ~03:07–03:10 | `release-entitlements-staging.ps1` post-deploy check: every target must be `healthy`; the draining 185 target failed it ("Staging ALB targets are not all healthy"). |
| 03:10:24 | Automatic rollback to revision 185 (task `54c9a144`, healthy from 03:11; 186 stopped with SIGTERM, exit 143). |

Throughout 03:00–03:20 the target group reported `UnHealthyHostCount` 0 and no target or ALB 5xx
responses. Revision 186 did not crash, fail startup or fail health checks; the release check
misread the previous task's normal draining target.

Fix: the post-deploy check (`Assert-StagingRuntimeHealth -AfterRollout` →
`Assert-StagingTargetHealth`) sets draining targets aside only after a rollout, as `deploy-app.ps1`
does, and in both modes now also requires the active targets to be exactly the running tasks
(by private IP) and as many as desired (previously "at least"). The pre-release check still
rejects any draining target. Redeploy uses `-DeployOnly`, which never applies a migration.

Revision 185 (`a3fa985`) has run on the migrated schema since 03:11 with no errors: 043 only
grants privileges, 044 adds guards, and 045 keeps the three-argument
`finish_cognito_password_operation` call working (new fourth parameter has a default) and
re-grants it to `tracepoint_runtime`.

### Release blockers found and fixed on this branch

- **Staging image build would fail.** The candidate's Dockerfile runs the migration tests, and
  `next build` type-checks `scripts/`; both need `infra/lib/production-target.ts`, which the
  application image archive did not contain (`.dockerignore` and the migration image archive
  already allowed it). Reproduced by building the exact archive locally (migration test
  "archives ... include its validation dependencies" and `next build` TS2307), fixed in
  `TracePoint.Staging.psm1`, and re-verified on the rebuilt archive.
- **Release stopped at the lease check under Windows PowerShell 5.1.** 5.1 prefixes JSON piped to
  `node` with a UTF-8 BOM; the lease, provider-config, secret-replacement and storage-activation
  validators rejected it (fails closed). They now remove one leading BOM (`scripts/stdin-json.mjs`).
  `test-staging-image-archive.ps1` also failed on 5.1 (zip types not loaded); fixed.
- **Release guard expected the wrong ledger state.** Staging's ledger already records 042 (see
  below); the guard required 001–041 recorded and 042–045 pending, so the release would have
  refused. It now requires 001–042 recorded and exactly 043–045 pending, and the post-apply check
  verifies the 043–045 rows written by this release.
- This branch is on the approved staging release branch list.

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

Observed staging ledger: the last migration status report in CloudWatch
(`/tracepoint/staging/application`, stream `database-bootstrap/bootstrap/350b3333…`,
2026-10-14 14:22 UTC) lists 001–042 applied and nothing pending; no later report exists, and staging
has run `a3fa985` (task definition 185) since 2026-10-14 14:40 UTC.

| Version | File | Staging (observed 2026-10-14) | Recorded hash (= this branch's CRLF archive bytes) |
| --- | --- | --- | --- |
| 001–037 | historical | recorded | (checked by the runner on every status) |
| 038 | `agency_documents_template_builder` | recorded | `83f1ffdb10c646d4…` |
| 039 | `document_template_analysis` | recorded | `ef5a8670edc6dba6…` |
| 040 | `document_template_structured_bindings` | recorded | `640a5c8093413a17…` |
| 041 | `document_template_write_authority` | recorded | `72ba79c43da8c4f9…` |
| 042 | `default_module_entitlements` | recorded by `a3fa985`, staging apply | `f24425f5370f1ab3…` |
| 043 | `range_workspace_authenticated_writes` (production's 038) | pending | — |
| 044 | `cognito_password_global_scope` (production's 039) | pending | — |
| 045 | `password_operation_resolution` (production's 040) | pending | — |

Staging hashes are of the canonical archive bytes (`git -c core.autocrlf=true archive`),
which `apply-app-migrations.ps1` keeps for staging; `migration-release-core.tests.ps1` pins the
five recorded hashes above. Nothing previously applied is re-run: the runner's staging `apply`
refuses unless 001–042 are recorded with exactly matching filenames and hashes and exactly 043,
044 and 045 are pending. (The earlier candidate `bd615bb5` expected 042 to be pending and would
have refused against the real ledger.)

## Staging state observed read-only (2026-10-19 01:5x UTC)

- Identity: account `559054714699`, SSO role `TracePointMigrationStaging`.
- ECS `tracepoint-staging`: ACTIVE, 1/1 running, task definition revision **185**, one PRIMARY
  deployment (COMPLETED 2026-10-14), image `tracepoint-staging@sha256:c264dab7323e9ebf…` = tag
  `a3fa9855f4c797dfb7b4dd16144cf6c85a445946-aws-native-staging`.
- RDS `tracepoint-staging-full-aws`: available, PostgreSQL 18.4, backup retention 1 day,
  PITR current.
- Ledger: 001–042 recorded, nothing pending (see Migration lineage).
- SSM `/tracepoint/staging/database-release-lease`: present (version 1, written 2026-10-07 by the
  GitHub lease workflow), **expired 2026-10-09 22:25 UTC**.

### The release lease is not required by this procedure

The lease is read only by `release-tracepoint-staging.ps1` (the GitHub runtime/infrastructure
release lane) and `deploy-tracepoint-staging.ps1 -Action DeployRuntime`. The migration-first
procedure below (`release-entitlements-staging.ps1` → `publish-tracepoint-staging-image.ps1`,
`migrate-db.ps1`, `deploy-app.ps1`) never reads it — the 2026-10-14 release applied 042 while the
lease was expired. No lease write is needed for this release. If a lease is wanted for
coordination, the established procedure is the `origin/main` workflow "Renew staging database
lease" (`aws-staging-database-lease.yml`, dispatch from `main`, protected `aws-staging`
environment, OIDC role) which runs `renew-staging-database-lease.ps1 -Execute`: one
`ssm put-parameter --overwrite` of that single parameter (expiry 30 min–7 days ahead, owner
`github-<actor>`, reference `github:<run>:<attempt>`), then a validated readback. It touches no
other resource.

## Redeploy after the 2026-10-19 rollback (application only; no migration)

Staging now records 001–045 with nothing pending. Use the deploy-only mode; it never applies a
migration and has no `APPLY` prompt:

```powershell
aws sso login --sso-session tracepoint-staging
git -C <checkout> status --porcelain --untracked-files=all   # must print nothing
npm ci
.\scripts\release-entitlements-staging.ps1 -ToolingCommit <HEAD> -ApplicationCommit <HEAD> `
    -DeployOnly -RecordedMigrationCommit e3b06e6ada3a7ef93f41f49831d0723dd345e7d7
```

It runs the same steps 1–3 and 6 below. Step 4 becomes: `status` must show exactly 001–045
applied, 0 pending, every row hash-matching this commit's files, and the 043–045 rows recorded
by `e3b06e6a` (`staging`, `apply`); `e3b06e6a` must be an ancestor of the application commit.
Step 5 is skipped. Without `-DeployOnly` the script now stops at step 4 (nothing is pending).

## Original deployment procedure (used 2026-10-19; requires explicit approval; every step fails closed)

Run in Windows PowerShell from a clean checkout of this branch at its HEAD (`<HEAD>` below is
`git rev-parse HEAD`; tooling and application commit are the same reviewed commit):

```powershell
aws sso login --sso-session tracepoint-staging
git -C <checkout> status --porcelain --untracked-files=all   # must print nothing
npm ci                                                      # the script runs node_modules\.bin\tsc.cmd
.\scripts\release-entitlements-staging.ps1 -ToolingCommit <HEAD> -ApplicationCommit <HEAD>
```

What the script does, in order — it stops at the first failure:

1. Verifies HEAD = `-ToolingCommit`, a clean tree, the application commit is a local ancestor,
   the staging identity and region; runs `tsc --noEmit`, the AWS-native provider reachability
   check and `migration-release-core.tests.ps1` (which pins staging's recorded 038–042 hashes).
2. Verifies staging is healthy and on task revision **185** (records it as the rollback target)
   and that RDS PITR is no older than 30 minutes.
3. Publishes the application image through CodeBuild (approved-branch and archive checks; the
   Docker build runs the lint ratchet, application suite, migration tests and `next build`),
   requires a clean ECR scan, and records the digest. **No ECS change.**
4. Runs migration `status` against the live ledger with that image: requires 001–042 recorded
   with matching names and hashes and exactly 043, 044, 045 pending. Re-checks PITR and that the
   service is still on revision 185.
5. Prompt **`APPLY 043-045`** — the only database write. Each migration runs in its own
   transaction with its ledger row. Then `status` again must show nothing pending, and the
   043–045 rows must carry this commit, `staging`, `apply`.
6. Prompt **`DEPLOY APPLICATION`** — `deploy-app.ps1` re-runs the application suite locally,
   reuses the scanned image (digest asserted), registers a new revision from revision 185 (only
   the image changes) and updates the ECS service; verifies steady state, ALB health, running
   digest and `/api/health`. The release then re-checks runtime health with draining targets of
   the previous task set aside. On any failure it restores revision 185 automatically.

Answering anything other than the exact prompt text stops the release at that point.

After deployment: confirm Cognito login (web and mobile bearer), module visibility for demo
agencies, Range Day save/load, inventory and fleet pages, and an Agency Documents upload →
setup → publish → generate → unpublish → "revision 2" cycle with synthetic data only.

Operator notes:
- 044 refuses membership and platform-admin changes for users with an unresolved password
  operation until it is resolved; check `authentication_lifecycle_operations` if such a change is
  refused after the release.

## Rollback (preserves the current staging environment)

- **Before the database step**, nothing in staging changes; abandon the release.
- **Application:** the release records the pre-rollout task definition and digest. On a
  failed deployment `release-entitlements-staging.ps1` restores it automatically
  (`deploy-app.ps1 staging -RollbackTaskDefinitionArn <prior>`). Manually:
  `scripts/invoke-tracepoint-staging-rollback.ps1 -TaskDefinitionArn <prior> -ExpectedImageDigest <recorded digest> -Execute`.
  The rollback verifies the running task serves exactly that digest. For this release the prior
  target is `arn:aws:ecs:us-east-1:559054714699:task-definition/tracepointstagingruntimeServiceTaskDefC2B9B4C5:185`
  with digest `sha256:c264dab7323e9ebf55df7400e233b76e88e9efe18dfa99a26df212ce4efa9afb`.
- **Database:** 043–045 are additive and are not reversed automatically. The prior app
  `a3fa985` does not check the migration ledger at startup, so it still boots after them. A full database rollback is a restore from the
  pre-release snapshot/PITR into a new instance — an operational decision, not a script.
- Do not retry a partially failed apply blindly: run `status`, reconcile, then decide.

## Known limitations

- Docker is not installed on the release workstation. The image build was emulated instead: the
  exact `git archive` the publisher uploads, with `.dockerignore` applied, `npm ci`, then the
  Dockerfile's builder steps (lint ratchet, application suite, migration tests, `npm run build`,
  mobile route image contract). The CodeBuild build in step 3 is still the first real Docker
  build (Linux, distroless runner stage, image scan).
- Not covered locally: browser interaction with the builder and generate pages, Word/LibreOffice
  rendering of generated .docx files (soffice is not installed), and real agency forms.
- `042_default_module_entitlements` (already applied on staging) enables every active feature for
  every existing agency (noted for production in `docs/production-followups-20261017.md`); not
  cleared for production.
- Production is not a target of this candidate. Its ledger-adoption path still refuses
  (see `docs/agency-documents-integration-20261018.md`).
