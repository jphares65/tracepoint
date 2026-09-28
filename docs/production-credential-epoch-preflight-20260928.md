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
The S3 artifact bucket has versioning, KMS default encryption, and all four
public-access blocks enabled. Deployment must await actual key creation,
exact-ARN IAM review/change set, immutable package digest, and capture-role
negative checks proving it cannot read the old or rollback secret.
Current IAM simulation confirms the deployed capture role can read the old
`source-supabase-rest` secret but receives `implicitDeny` for both reserved
epoch paths. This is the correct **pre-deployment** state, not the desired
cutover state. The role trust is limited to the exact CodeBuild project and
account, with the existing production permissions boundary.

The rollback key must stay out of every running writer until abort. A
deterministic Vercel redeployment with replacement secret, ECS secret update
and restart, Auth/Storage restoration, and single-authority verification is
still required; deleting a modern key is not the reversal operation.

### Vercel rollback distribution gate

The live Vercel project is `prj_V03LJyQIc231luvZ9u0gcOAt4xK4`. A change
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
`SUPABASE_SECRET_KEY`; the exact variable ID and a credential-safe update
channel remain to be pinned. The Preview value must not be assumed equal to
Production merely because the variable names match.
The abort sequence must update the Production server secret (and any other
exactly attested old-key aliases), create a new deployment from the pinned
revision with the new environment, verify its identity and source-key read,
then restore its Production alias/ingress. Keep maintenance and the source
fence active until both Vercel and the exact public ECS bridge revision use
the rollback key and representative Supabase reads/writes pass. An old
deployment must not be resumed as the rollback target. Preview remains
denied until its production-source-bearing deployments cannot write.

This mechanism follows Vercel's documented deployment-scoped environment
semantics; it has **not** been operationally proven against the live project.
The read-only validator now requires positive evidence for the new deployment,
alias, ECS revision, Auth/Storage restoration, and single-source authority.

### Current fail-closed result

The local production preflight validator remains BLOCKED. It now names the
missing exact credential-epoch attestation, old-epoch retirement proof, and
rollback distribution proof explicitly in addition to the pre-existing writer
and capture gates. Its synthetic-ready test passes, but that is a unit test,
not production evidence. No source key or production runtime has been changed.

**Production remains unfenced and Supabase-authoritative.** Do not claim the
preflight passed based on this inventory or on the paid-project rehearsal.
