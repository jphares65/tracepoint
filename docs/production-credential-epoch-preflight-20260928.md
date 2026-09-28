# Production credential-epoch preflight — 2026-09-28

Status: **READ-ONLY INVENTORY IN PROGRESS; LIVE CUTOVER NOT STARTED.** Source
project `izlkwggluhlhzlumtzes` is the only approved live source. This record
does not authorize a maintenance response, key creation/deletion, source fence,
capture, import, or authority switch. The paid-project proof at `7308a507` is
retained and was not repeated.

## Live attestation and key inventory

- AWS STS: account `193644343389`, `TracePointMigrationProduction` role.
- TLS-pinned, read-only production catalog: 122 relations (87 public, 27 Auth,
  eight Storage); fingerprint `36558b0730e3e96cad6426f38088a5b0`; zero
  cutover triggers and no cutover schema. This is the pre-fence baseline.
- Signed-in Supabase project `izlkwggluhlhzlumtzes` (dashboard display name
  `TracePoint Development`) shows one modern publishable key `default`, one
  modern secret key `default`, and enabled legacy JWT `anon`/`service_role`
  keys. No production key was revealed, created, or deleted.
- The AWS migration REST secret is a modern key for the exact live project and
  returned HTTP 200 for a bounded read. Its in-memory fingerprint equals the
  public ECS application secret's elevated key. The Vercel Production and
  Preview `SUPABASE_SECRET_KEY` values are write-only and were not compared.
- Dedicated production capture and rollback secrets do **not** exist in AWS
  Secrets Manager. The reserved purpose names and exact paths are versioned in
  `scripts/source-credential-epoch-core.mjs`; neither key has been created.
- The exact project's Storage S3 dashboard shows protocol enabled but **no
  separate S3 access keys**. Recheck this immediately before freeze; it does
  not substitute for authenticated/elevated Storage API controls.
- The exact project's Auth provider page shows Email enabled, new-user signup
  enabled, and email confirmation enabled. These are the current states to
  capture before any reversible cutover restriction; none was changed.
- The production Supabase Edge Functions page shows no deployed function;
  the live Vercel project's Cron Jobs page shows no configured cron job.
  Neither observation rules out direct APIs, the known Supabase `pg_cron`
  dispatcher, or external secret holders.
- Aggregate-only read-only SQL in the exact production project found one
  `cron.job` row, active, with the expected dispatch job name. It also found
  16 Auth sessions and 21 refresh-token rows. These are pre-fence counts,
  not consent to revoke them outside the approved maintenance sequence.

## Writer and control inventory

| Path | Live binding / current evidence | Remaining control gate |
| --- | --- | --- |
| Public ECS bridge | Service `tracepoint-production`, task revision 4, desired/running 1/1; application secret injects the modern elevated key | Exact 1→0 drain and pinned 1-task reverse only inside maintenance |
| Vercel Production | `prj_V03LJyQIc231luvZ9u0gcOAt4xK4`, Production Supabase URL/server secret | Exact-project pause, external 503, and deterministic rollback-key redeploy/unpause procedure |
| Historical Vercel Preview | Same project; separate current Preview secret, but old deployments may contain live-source credentials | Reviewed project-wide Preview deny, historical URL negatives, exact inverse |
| Auth new/existing sessions | Email and legacy JWT path active; guarded session-drain SQL is versioned | Reattest settings and session counts; exact disable/drain/negative/inverse in live window |
| Auth service admin | Modern `default` or legacy `service_role` can be elevated | Stop old holders, disable legacy JWT keys, retire old modern key only after new epoch and rollback path are proven |
| Storage authenticated/elevated | Authenticated RLS permission-function control and S3 protocol control were rehearsed; elevated key bypasses RLS | Reattest production policy and negative-test both paths under live fence |
| Direct PostgREST/RPC | 87 public owner-controlled relations and 30 public definer functions inventoried | Reviewed 174-trigger public layer, RPC call-graph/negative checks, exact inverse |
| Cron/background | Previously attested `tracepoint-notification-email-dispatch` every 15 minutes; current reader cannot SELECT `cron.job` | Privileged read-only fresh attestation, guarded pause/drain/restore, external invocation census |
| Admin/import/AWS secret readers | Migration REST secret is shared with public bridge; three production-account CodeBuild projects exist | Verify no active import/build, restrict starts and retire old credential; capture role alone gets new key |
| External old-key holders | Identity need not be exhaustive **after** all old modern keys and legacy service key are retired and direct negatives pass | Recheck complete key table and direct unknown-holder negative at freeze |

The known old modern key is not the entire old epoch: the enabled legacy
`service_role` key remains a separate elevated path. Neither it nor unknown
historical holders can be ignored before the direct freeze-time negatives.
The currently running Phase 3B shadow and Phase 3C rehearsal task definitions
inject PostgreSQL/AWS-native secrets, not Supabase source credentials; the
no-traffic authority rehearsal service is at desired/running 0/0. The
production final-capture project has zero builds; the most recent paid-source
capture and image-build jobs completed successfully and are not running.

## Capture/rollback package state

The deployed CodeBuild project `tracepoint-production-final-source-capture-20260927`
has **zero builds**. It still references the old single-run source package and
its role can read `source-supabase-rest`; its role policy has one artifact key.
The local, **undeployed** candidate now injects only the reserved modern
capture secret, rejects legacy JWTs, and parameterizes its exact secret ARN in
the CloudFormation role policy. The candidate's A/B run IDs remain pinned.
The nine-file local capture package was rebuilt from clean HEAD `44a685b` and
verified at SHA-256 `ce6cf3442f13d12007d2aeb43b1c2409916ae741d1a4c904147da8a372b82351`.
On 2026-09-28 it was uploaded create-only to the exact private, versioned,
KMS-encrypted build-source bucket at
`source/tracepoint-production-final-capture-ce6cf3442f13d12007d2aeb43b1c2409916ae741d1a4c904147da8a372b82351.zip`,
S3 VersionId `knH8GdKZiGMFXiN.4uwrfdcEcbyG3GiO`. It has **not** been
deployed to CodeBuild or run; the deployed job still references the older
`d09407a9...` archive.
The S3 artifact bucket has versioning, KMS default encryption, and all four
public-access blocks enabled. Deployment must await actual key creation,
exact-ARN IAM review/change set, immutable package digest, and capture-role
negative checks proving it cannot read the old or rollback secret.
Current IAM simulation confirms the deployed capture role can read the old
`source-supabase-rest` secret but receives `implicitDeny` for both reserved
epoch paths. This is the correct **pre-deployment** state, not the desired
cutover state. The role trust is limited to the exact CodeBuild project and
account, with the existing production permissions boundary.

After refreshing the existing production SSO source profile on 2026-09-28,
STS again returned account `193644343389` and role
`TracePointMigrationProduction`. The two reserved production epoch secrets
were subsequently created at their exact paths, but their values came from
the **paid rehearsal** project: status-only bounded reads returned 401 for
both against `izlkwggluhlhzlumtzes` and 200 for both against
`reukdouvpshshvqnzsgw`. A read-only dashboard inspection independently found
the two production-named key rows in the paid project and neither in the
production project. This is a credential handoff mismatch, not a capture
executor defect. No key value or customer row was printed; no key was created,
changed, or retired by this validation. The reviewed local CloudFormation
template passed `ValidateTemplate`, but its change set must not be executed
until the AWS secret values are replaced by two keys issued by the exact
production project and the capture role's effective IAM is reviewed.

The rollback key must stay out of every running writer until abort. A
deterministic Vercel redeployment with replacement secret, ECS secret update
and restart, Auth/Storage restoration, and single-authority verification is
still required; deleting a modern key is not the reversal operation.

### Vercel rollback distribution gate

The live Vercel project is `prj_V03LJyQIc231luvZ9u0gcOAt4xK4` in team
`team_HCPS7YRtZfKg7WZtSDfjhaSR`. A change
to its Production `SUPABASE_SECRET_KEY` applies only to a **new** Production
deployment. Merely unpausing, re-aliasing, or rolling back to an older
deployment would resume a build containing the retired key. Before retiring
the old epoch, pin the exact current Production deployment, code commit,
environment-variable IDs/targets, deployment protection state, and a
credential-safe way to supply the rollback secret from its exact AWS path.
The signed-in, read-only deployment inventory currently identifies Production
deployment `AfRHke111kN5zaHR7NGiMaqi4UMk` at
`tracepoint-crbhnybq1-jphares65s-projects.vercel.app`, built from `main`
commit `6588576ee2c3e95c2094e37c22ee64d0cbfad357`. Reattest this identity
immediately before maintenance; it is not a permanent alias assumption.
The read-only project variable inventory shows `SUPABASE_SECRET_KEY` separately
for Production and Preview, and Production-scoped
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL`. No value
was revealed. The only Production elevated variable name observed is
`SUPABASE_SECRET_KEY`. On 2026-09-28, the approved one-day, project-scoped
Vercel token at `tracepoint/production/migration/vercel-cutover-operator-20260928`
passed read-only API attestation. The API returned the exact team, project,
GitHub binding `jphares65/tracepoint`, Production branch `main`, and baseline
deployment UID `dpl_AfRHke111kN5zaHR7NGiMaqi4UMk` at the pinned commit.
The distinct Production and Preview elevated variable IDs are
`e80TWGMDKlzEEkIJ` and `vHhZaYrgk5g0zNyI`, respectively. The token and
variable values were not printed. Reattest token validity, deployment,
variable IDs, and project ownership immediately before maintenance or abort.
The abort sequence must update the Production server secret (and any other
exactly attested old-key aliases), create a new deployment from the pinned
revision with the new environment, verify its identity and source-key read,
then restore its Production alias/ingress. Keep maintenance and the source
fence active until both Vercel and the exact public ECS bridge revision use
the rollback key and representative Supabase reads/writes pass. An old
deployment must not be resumed as the rollback target. Preview remains
denied until its production-source-bearing deployments cannot write.

This mechanism follows Vercel's documented deployment-scoped environment
semantics. The reviewed abort request plan patches only the exact Production
variable ID, then creates a new Git-source deployment at the pinned SHA. It
does not use `deploymentId` redeployment, which Vercel documents as inheriting
the original environment. The plan is unit-tested but has **not** been
operationally proven against the live project.
The read-only validator now requires positive evidence for the new deployment,
alias, ECS revision, Auth/Storage restoration, and single-source authority.
The rollback secret-transform contract in
`scripts/production-credential-rollback-core.mjs` permits only the elevated
key field to change in the exact public ECS application secret and migration
REST secret. It rejects project drift, old-key drift, a non-modern replacement,
and an unchanged key. Applying the transforms and restarting the bridge is
reserved for an abort under the maintained source fence; the tests use only
synthetic credentials, and no production secret has been rewritten.
The exact-project read-only Vercel API checker is
`scripts/inspect-production-vercel-rollback.mjs`. It accepts only the
production AWS profile, reads the approved short-lived token from
`tracepoint/production/migration/vercel-cutover-operator-20260928` without
printing it, and rejects a different Vercel team/project, ambiguous
Production/Preview secret variables, or a deployment/code mismatch. The token
is attested for exact-project reads. This checker makes **no** Vercel change.

### Current fail-closed result

The local production preflight validator remains BLOCKED. It now names the
missing exact credential-epoch attestation, old-epoch retirement proof, and
rollback distribution proof explicitly in addition to the pre-existing writer
and capture gates. Its synthetic-ready test passes, but that is a unit test,
not production evidence. No source key or production runtime has been changed.

**Production remains unfenced and Supabase-authoritative.** Do not claim the
preflight passed based on this inventory or on the paid-project rehearsal.

## 2026-09-28 corrected-key and capture-executor checkpoint

The earlier wrong-project secret-value finding is superseded by a fresh
status-only probe. STS returned account `193644343389`. The old migration
credential and both epoch credentials returned HTTP 200 against exact source
`izlkwggluhlhzlumtzes`; the capture and rollback credentials did not
authenticate against paid rehearsal `reukdouvpshshvqnzsgw`. All three values
are distinct. The signed-in production project's key-name inventory showed
one publishable `default` key and exactly three modern secret-key rows:
`default`, `tracepoint_epoch_production_capture_20260928`, and
`tracepoint_epoch_production_rollback_20260928`. Legacy JWT API keys remain
enabled. No value was revealed, rotated, or retired by this check.

The isolated four-resource capture stack
`tracepoint-production-final-source-capture-20260927` was updated by reviewed
change set `source-capture-epoch-20260928-cfbc8c3`. Its only resource changes
were `CaptureProject` and `CaptureRole`; the stack reached `UPDATE_COMPLETE`.
The CodeBuild source now points to the content-addressed `ce6cf344...` ZIP
at S3 VersionId `knH8GdKZiGMFXiN.4uwrfdcEcbyG3GiO`; the source object
remains KMS encrypted. The role policy references only the exact capture
secret ARN. IAM simulation allowed `GetSecretValue` for that ARN and denied
both the rollback secret and the old migration REST secret, with the
permissions boundary and Organizations evaluation included. The CodeBuild
project still has zero builds; no source capture was started.

The live source catalog still has 122 relations and pinned fingerprint
`36558b0730e3e96cad6426f38088a5b0`, with zero cutover triggers. The final
RDS target remains private, encrypted, available and deletion-protected under
resource ID `db-X4DYNS3TMVSAP7Z3RISDWEYDVE`. Public ECS remains the
Supabase bridge at revision 4, desired/running 1/1. The complete-ingress
baseline verifier returned 200 for `www` and unmatched Host, with original
forwarding and ALB-only task ingress. Production maintenance and source fence
remain OFF.

The exact Vercel operator secret is present in Secrets Manager, but the
read-only project API request now returns HTTP 403; its prior deployment and
environment-variable IDs cannot be freshly reattested. No Vercel project or
variable was changed. Until exact-project API access is restored and the
new-deployment rollback path passes, old-key retirement and live maintenance
remain fail-closed. The composite preflight validator still reports BLOCKED;
do not replace missing writer-control evidence with this checkpoint.

The Vercel checker and rollback request plan were corrected to append the
exact team ID to every team-owned API request, as required by Vercel's API.
Focused tests pass, but the exact project GET still returns HTTP 403 with
`forbidden`; the team diagnostic also returns 403. This is an access-token
scope/authorization gap, not a missing `teamId` parameter. The existing
Secrets Manager path is the only approved handoff location for a replacement
short-lived token; no token value should be entered in the repository or chat.

The available relational importer is **not** the final-target apply package.
`run-supabase-rest-initial-import.mjs` and `supabase-rest-import-core.mjs`
pin the September 23 rehearsal RDS resource ID `db-WX6GX35AIJ546ZRCZIRQ545B3E`,
the initial immutable source artifact, and historical row/identity counts.
The cutover target is the distinct final RDS resource ID
`db-X4DYNS3TMVSAP7Z3RISDWEYDVE`. No reviewed importer currently accepts
the production slot-B artifact and applies/reconciles its variable frozen
delta against that final target. Do not repoint the rehearsal importer by
editing constants or substitute its earlier 4,813-row baseline as final
reconciliation. Implement and rehearse a separate exact-target, exact-artifact
atomic apply path before source maintenance. This is an engineering/package
gap, not evidence of source or target corruption.
