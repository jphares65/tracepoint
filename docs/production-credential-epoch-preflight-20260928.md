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

The rollback key must stay out of every running writer until abort. A
deterministic Vercel redeployment with replacement secret, ECS secret update
and restart, Auth/Storage restoration, and single-authority verification is
still required; deleting a modern key is not the reversal operation.

**Production remains unfenced and Supabase-authoritative.** Do not claim the
preflight passed based on this inventory or on the paid-project rehearsal.
