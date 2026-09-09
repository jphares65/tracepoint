# TracePoint AWS migration status

**Verified:** 2026-09-09 UTC

**Formal weighted readiness:** **79.00%**

**Staging target:** account `559054714699`, `us-east-1`

**Integration branch:** `codex/aws-staging-integration-20260908`

## Current result

The production-account checkpoint previously established 73.00% readiness. Three
subsequently verified production capabilities add 6.00 percentage points under
the unchanged binary checklist: the issued production ACM certificate (2.00),
the healthy production runtime (2.00), and bounded production load/failure
validation (2.00). No staging work or repeated evidence is double-counted.

The staging runtime is healthy on ECS task-definition revision 24, built from
commit `b4ec137f58d4bb82ec18c963415d90efe9ecf2d0`. Its running ECR digest exactly
matches `sha256:e4116b1168691e4e6e619781ad9e76585fbe195f550f42cbde7e20d13c7ae80f`;
the scan is complete with zero findings. CloudFormation is `UPDATE_COMPLETE`,
runtime drift detection is `IN_SYNC` with zero drifted resources, and the final
live CDK diff reports no differences.

## Source and database reconciliation

`origin/main` is `53a6f1bacbde4b5d983a25255a6fd623bf1606b3` and does not contain the completed
AI importer repair `953e7b351f65c90dc4288b83b95750d2f6b24c48` or its equivalent. The isolated
integration branch combines the hardened AWS lineage with only the importer
sequence, excluding unrelated Fleet and analytics work. Its deployable source
checkpoint is `b4ec137f58d4bb82ec18c963415d90efe9ecf2d0`; the follow-up deployment guard is
`f980e73`.

The live staging database already contains all 75 committed migrations through
`202609080001`. The two importer-workspace migrations, table, expiry function,
four RLS policies, expected authenticated/service-role grants, and zero residual
workspace rows were verified. No migration was applied and no production data
was read or changed.

## Live staging validation

- The full disposable authenticated acceptance run passed, including login and
  tenant resolution, session persistence, cross-tenant denial, equipment,
  custody, ranges, off-duty, training, armory, certifications, personnel, Fleet,
  S3 patch/document lifecycle, audit checks, password recovery, refresh-token
  revocation, cleanup, and bounded authenticated reads.
- The AI importer passed a disposable two-file workspace flow through upload,
  staging, edit, preview, execution, deletion, single-file compatibility, and
  cleanup; two synthetic vehicles were created and removed.
- Bounded health and rejection tests passed: 200 health requests at concurrency
  8 (`p95=209 ms`), 20 invalid-auth requests at concurrency 4 (`p95=38 ms`), and
  post-failure health recovery (`p95=33 ms`). TLS redirect and WAF rate
  enforcement/recovery passed.
- The synthetic runtime alarm reached the encrypted SQS machine path in both
  `ALARM` and `OK` states. All six runtime alarms returned to `OK`; failed and
  stale notification queue counts are zero. The active task produced no matched
  errors or filesystem-permission errors in the final 60-minute window.
- A real ECS rollback moved revision 24 to the previously validated immutable
  revision 23, waited for a healthy completed deployment, and restored revision
  24. Rollback completed in 436.8 seconds; restoration completed in 450.5
  seconds. Exact digest, targets, routes, alarms, logs, and queues passed after
  restoration.
- Root TypeScript, the Next.js 16.3.4 production build (81 pages), 85 focused
  importer/storage/range tests, 30 infrastructure suites, the runtime-template
  suite, runtime synthesis, and the zero-difference live diff passed. Repository-
  wide lint retains 462 pre-existing findings; targeted changed-file lint passed.

## Recovery status

The latest 75-migration lineage completed a clean disposable PostgreSQL bootstrap
and tenant-isolation workflow. Its dump/restore phase could not run because this
Windows environment has no `pg_dump.exe` and no `TRACEPOINT_PG_BIN`; no live
database was mutated. The previously credited 73-migration local restore remains
valid, but no new restore or production PITR credit is claimed.

Production Supabase reports PITR disabled and no available physical backup. An
isolated production recovery test therefore requires the data owner to approve
an eligible backup/PITR plan and recovery target. This is a paid/external owner
gate and was not changed.

## Remaining gates and exact owner actions

1. Review and merge `codex/aws-staging-integration-20260908` into `main`; the
   importer repair is not currently on `origin/main`.
2. Do not request another SNS email subscription before **2026-09-15 02:48 UTC**.
   After that suppression window, request one subscription for the intended
   production runtime-alert topic, confirm it from `contact@tracepointHQ.com`,
   remove any safe stale pending duplicate, and execute one bounded ALARM/OK
   human-delivery test. The working SQS alert path must remain intact.
3. Install a PostgreSQL client matching the rehearsal server and set
   `TRACEPOINT_PG_BIN` to its binary directory to rerun the latest isolated
   dump/restore test.
4. Approve a Supabase backup/PITR tier and isolated recovery target if production
   database-recovery credit is required; this may create recurring cost.
5. Complete the remaining production data rehearsal/move, identity-provider and
   MFA/session cutover, backup restore, human notification escalation, DNS
   cutover/rollback, and agency approval under their separate owner gates.

No production DNS, customer traffic, SES configuration, customer records, or
production database state changed during this staging integration run.
