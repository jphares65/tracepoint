# Reconciled staging release (2026-10-21)

Branch `claude/integration-defects-rebased-20261021` (local; not pushed or merged). Release commit: see the
commit that adds this file. Base: the staging lineage `b423cc69` (`claude/staging-rc-agency-documents-20261018`),
merged with the defect remediation `5b9ec98` (`claude/integration-defects-20261020`).

## Why

The read-only staging preflight of 2026-10-21 (evidence `TracePointEvidence\staging-before-20261021T174035Z`)
found staging's ledger at 001-046, with 038-046 from the Agency Documents and entitlements lineage. The
remediation release reused 038-046 for different files, so the runner would have stopped with `MIGRATION_DRIFT`.
Staging's 001-046 are the applied history; nothing applied was edited, renumbered or re-hashed.

## Migration manifest

`database/aws/MANIFEST.json` allocates every number (LF and CRLF sha256; staging's ledger records the CRLF
archive bytes). `scripts/aws-migration-manifest.test.mjs` runs inside the image-build test and refuses an
unlisted, edited or reserved-number file.

| Version | File | Lineage | Staging |
|---|---|---|---|
| 001-037 | unchanged | shared | applied |
| 038 | agency_documents_template_builder | Agency Documents | applied 2026-10-08 |
| 039 | document_template_analysis | Agency Documents | applied 2026-10-08 |
| 040 | document_template_structured_bindings | Agency Documents | applied 2026-10-08 |
| 041 | document_template_write_authority | Agency Documents | applied 2026-10-09 |
| 042 | default_module_entitlements | entitlements | applied 2026-10-14 (a3fa9855) |
| 043 | range_workspace_authenticated_writes | staging release | applied 2026-10-19 (e3b06e6a) |
| 044 | cognito_password_global_scope | staging release | applied 2026-10-19 |
| 045 | password_operation_resolution | staging release | applied 2026-10-19 |
| 046 | agency_documents_module_toggle | Agency Documents | applied 2026-10-20 (75499335) |
| 047 | fleet_inventory_feature_catalog | Agency Documents release (1b48972e) | pending |
| 048 | equipment_out_of_service_lifecycle | remediation, was 038 | pending |
| 049 | account_access_remediation | was 039 | pending |
| 050 | fleet_field_write_authorization | was 040 | pending |
| 051 | equipment_self_custody | was 041 | pending |
| 052 | range_packet_ready_is_not_final | was 042 | pending |
| 053 | fleet_inspection_audit_outbox | was 043 | pending |
| 054 | personnel_import_preservation | was 044 | pending |
| 055 | fleet_inspection_eligibility | was 045 | pending |
| 056 | fleet_safety_hold_clearance | was 046 (baseline audit labels now say 056) | pending |
| 057 | training_record_visibility | was 048 | pending |
| 058 | equipment_separated_holder | was 049 | pending |
| 059 | training_closeout_records | was 050 | pending |
| 060 | range_instructor_line_actions | was 051 | pending |
| 061 | armory_separation_of_duties | was 052 | pending |
| 062 | armory_audit_and_access (expand) | was 053 | pending |
| 063 | reserved: armory_history_contract | B8a contract, was 054 on `claude/fix-b8a-contract-054` | no file |
| 064 | reserved: notification_job_recipients | B6, was 047 on `claude/fix-b6-notification-delivery` | no file |

Next free number: 065. B6 and the 063 contract must be renumbered on their branches before they merge; the
manifest test refuses their old numbers. Older remediation documents still use the 038-053 numbering.

The staging apply guard (`scripts/run-aws-native-migrations.mjs`) requires 001-046 recorded, optionally followed
by a contiguous part of 047-062, and exactly the rest pending. It retries a migration that loses a deadlock or
lock wait (40P01, 55P03; 5 attempts; `lock_timeout` 15s) and resumes an interrupted apply.

## Overlap review

No schema object is created, replaced or altered by both lines. The coupling points were checked in the
rehearsal: `pilot_range_workspaces` (043 grants with 052/060 triggers), `department_memberships` and lifecycle
operations (044/045 guards with 049/054 writers), and `department_features` (051 gates on
`equipment_readiness`, the 042 catalog code). After apply, every changed object is one a release migration
names; no Agency Documents, entitlement, feature-catalog or password-scope object changed.

Application conflicts (30 files) kept both sides. Decisions where one side's behaviour changed:
- Fleet inspection uses `canSubmitFleetInspection` (mirrors 055) instead of staging's `canPerformFleetInspection`.
- Fleet module gating (staging) applies on top of the remediation rules; Fleet reads need a Fleet permission.
- timestamps follow DC2 (ISO text); this fixes the 568 audit rows shown without a time.
- Assign Password no longer marks email verified (ADM-07); the 045 provider-unchanged semantics stay.
- Super-admin entitlements go only through the platform-admin repository (no direct table writes).
- A packet marked Ready is not final (RNG-03, 052).
- Release tooling keeps the staging lineage's archive and tag contract plus the remediation's scan/publish helpers.
- The clean-bootstrap validator and native suites skip `supabase/migrations/202610120001` (the Supabase-bridge
  copy of 042). The staging tree's own bootstrap failed before this work (missing `202609100001`).

## Rehearsal (PostgreSQL 18.4, offline)

Evidence: `TracePointEvidence\rehearsal-20261021\`.
- Lineage: staging's history rebuilt with the real runners (reconcile, 030-045, 046 through 75499335's guard);
  the ledger equals live staging (46/46 rows). Release runner: status pending exactly 047-062, no drift; apply;
  status 062, nothing pending. Same with 047 applied first. The renumbered preflight kit runs read-only with
  0 errors before and after; every after-apply check matches the expected values.
- Mixed version (`harness\`): real route modules of the running app d9d2624 and the release, P1 046, P2 apply
  under old-image writes, P3 new, P4 rollback, P5 roll-forward, P6 alternating plus races. All invariants pass
  (Agency Documents, entitlements, fleet audit and holds, inventory balances, tenant isolation, append-only
  history) except a pre-existing gap (inspector inspections at 046 have no audit row; 053 does not backfill).
  The first runs found the 055 deadlock (D-1); the runner fix was re-run in 12 trials and resume tests.
- Tests on the release commit (LF, as the image build): 1111/1116 pass, 2 skipped, 3 ADM-07 failures that also
  fail on 5b9ec98 here (Windows ESM loader); scripts 425/426 (the archive test passes in a git checkout); clean
  bootstrap 80 + 62 migrations with every validator; `tsc` clean; eslint unchanged from the staging lineage.

## Known defects (not fixed here)

- Old image during apply: a fleet inspection that loses a deadlock gets 500 (nothing stored); when the loser is
  its work-order insert the old route still answers 201 without the work order (R-2). Apply in low traffic.
- D-2 officer equipment condition report is refused by RLS (route updates `equipment_assets` directly; present in
  the running app). D-3 `GET /api/inventory/checkouts` 500. D-4 Agency Documents person search 500. D-5 old
  ammunition reconciliation uses a Supabase-only API. D-6 old personnel import blanks rank and unit.
- The mobile range-workspace PUT lacks the web route's tenant-boundary merge (both lines).
- Not exercised offline: S3 (template upload, generation, evidence files), Cognito/SES flows, mobile bearer routes.
