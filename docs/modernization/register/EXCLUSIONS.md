# Register exclusions

Source findings deliberately not turned into requirements; every other finding id in the sources is cited by at least one requirement.

Doc keys follow [SCHEMA.md](SCHEMA.md): `UX` is the UI/UX audit (2026-10-22), `OA` is the operational audit (2026-10-20) with its reconciliation. "R1" means `reconciliation-20261020/R1-provenance-and-architecture.md` §5 (Appendix F re-classification).

| Source | Id | Reason | Evidence (where the source says so) |
|---|---|---|---|
| UX | A-44 | Obsolete under Cognito: the `/activate` and `/auth/setup` bridge forms now redirect to `/login`, so their pending-state and field-clearing problems cannot occur. The legacy-link notice is MOD-AUTH-015; retiring the bridge is MOD-OPS-041. | Appendix A row A-44 "Obsolete (aws-native)"; summary table "Obsolete: A-41, A-44, A-45". |
| UX | D-56 | False positive: the server already nulls `static_ip` when the viewer lacks network-detail permission, and did on main too. | Appendix D row D-56 "Obsolete"; `lib/fleet/read-repository-core.ts:47`. |
| OA | ADM-28 | Not applicable under Cognito: the admin-initiated reset uses `AdminResetUserPassword` and Cognito sends the code; there is no Supabase email-template dependency. Bridge path retirement is MOD-OPS-041. | finding-status "Outdated / not applicable — Close"; R6 ADM-28 (`cognito-password-lifecycle.ts:97-113`); defect-stage-ledger "ADM-28 does not apply under Cognito". |
| OA | ARC-06 | Resolved: no hard-coded `current-user` module or import remains. The stray root `current-user.txt` snapshot is part of the root `.txt` clean-up under ARC-K5 (MOD-OPS-040). | R1 "Resolved"; Appendix F "No `current-user` file or import in `src`". |
| OA | ARC-09 | Resolved: missing catalog permissions registered. | R1 "Resolved"; `202609050002_granular_permission_authority.sql`, `granular-permissions.test.ts:8`. |
| OA | ARC-10 | Resolved: role-name authorization shortcuts removed. A behavioral check is part of MOD-OPS-006/MOD-OPS-009. | R1 "Resolved"; `granular-permissions.test.ts:69`. |
| OA | ARC-11 | Resolved: only the exact `administrator` role inherits the catalog. | R1 "Resolved"; `permission-authority.ts:6-12`, `granular-permissions.test.ts:24`. |
| OA | ARC-14 | Resolved: agency-training writes require `manage_training`. | R1 "Resolved"; `database/aws/008_training_closeout_authorization.sql`. |
| OA | ARC-15 | Resolved: dead Training Alert and off-duty permission codes retired. | R1 "Resolved"; `202609060001_retire_legacy_training_alert_permissions.sql`. |
| OA | ARC-18 | Resolved: controlled 401/403 responses and `/unauthorized`, plus native 503 fail-closed. | R1 "Resolved"; `proxy-authorization.test.ts:10-33`, `server-access.ts:196`. |
| OA | ARC-19 | Resolved: obsolete client authority module removed. | R1 "Resolved"; Appendix F "Module absent". |
| OA | ARC-21 | Not applicable: the test runner now uses `--import tsx`, so the legacy parse problem is gone. | R1 "Not applicable"; `scripts/run-application-tests.mjs`. |
| OA | ARC-23 | Resolved: separate staging and production accounts with SCPs (gate G1). | R1 "Resolved"; `infra/policies/tracepoint-production-guardrails.scp.json`. |
| OA | ARC-39 | Resolved: production account created, CDK bootstrapped, foundation stacks deployed. | R1 "Resolved"; `docs/aws-production-live-evidence-20260907.json`. |
| OA | ARC-40 | Resolved: production runtime, control and alert stacks deployed. | R1 "Resolved"; commit `978acd9`. |
| OA | ARC-41 | Resolved: ACM certificate `ISSUED`. | R1 "Resolved"; `aws-readiness-20260909.json`. |
| OA | ARC-47 | Superseded by the AWS-native architecture: the `pg_dump` rehearsal is replaced by snapshot/PITR restore and the atomic importer. The production restore drill is MOD-OPS-047. | R1 "Superseded by AWS-native architecture". |
| OA | ARC-54 | Not applicable: no partner webhooks exist. | R1 "Not applicable"; Appendix F "Defer until partner API work". |
| OA | ARC-57 | Resolved: migration wave 1 (contracts and observability). | R1 "Resolved". |
| OA | ARC-59 | Resolved: server-only S3 storage adapter is forced in native mode. The only remaining action is a stale internal doc (`aws-provider-conversion-status.md`), not product work. | R1 "Resolved"; `object-store.ts:10`. |
| OA | ARC-66 | Superseded by the AWS-native architecture: attachments bucket defined in `infra/lib/private-storage-stack.ts`. | R1 "Superseded by AWS-native architecture". |
| OA | ARC-67 | Resolved: Supabase Auth UUIDs kept as the immutable subject; 96/96 subject links. | R1 "Resolved"; `final-completion-ledger-20260924.md:14`. |
| OA | ARC-70 | Not applicable: partner `/api/v1` is deferred by design; no such API exists. | R1 "Not applicable"; Appendix F "Deferred by design". |
| OA | ARC-71 | Resolved: no internal routes are exposed through `/api/v1`; the proxy denies by default. | R1 "Resolved"; `proxy-authorization.test.ts`. |
| OA | ARC-72 | Superseded by the AWS-native architecture (private storage stack). The only remaining action is an infra README update. | R1 "Superseded by AWS-native architecture". |
| OA | ARC-74 | Resolved: real `cdk diff` / change sets reviewed before runtime deploys. | R1 "Resolved"; `infra/changesets/*`. |
| OA | ARC-82 | Superseded: the six Training Alert permissions were retired and mapped to `manage_training` / `view_analytics`. Server-side alert state is MOD-TALR-001. | R1 "Superseded by AWS-native architecture"; `permissions.ts:17-30`. |

## Reported as exclusions but cited by a requirement

The group agents reported these ids as not turned into requirements. On checking, each is already cited in a requirement's `sources`, so it is not an exclusion:

| Source | Id | Cited by | Note |
|---|---|---|---|
| UX | D-34 | MOD-FLT-063 | Fixed in RC (inline document form); the residual nits (`window.confirm`, Archive `aria-label`) are the cited requirement. |
| UX | D-49 | MOD-FLT-001 | Fixed in RC (Fleet Help article live); the QR/app mention is the cited requirement. |
| UX | C-R2 | MOD-FA-001 | Merged into C-63 (record-page restricted custody transfer). |
