# Remediation batch B0 — proof foundation

Base: `codex/staging-mobile-api-release-20261007` @ `555f061`. Scope and priorities come from `docs/operational-audit-20261020/reconciliation-20261020/README.md` on branch `claude/tracepoint-operational-audit-w567t8`.

This batch adds no product behaviour. It lets every later batch be proven by CI and by a clean database build.

## Defects addressed

| ID | Defect | Change |
|---|---|---|
| NEW-ARM-C | `db:validate-bootstrap` expected 75 migrations and 21 permissions. The repo now has 79 and 24, so the validator threw before it ran anything. | Counts updated in `scripts/validate-clean-bootstrap.mjs`. |
| ARM-02 | A clean bootstrap failed at `202610020001_vehicle_document_metadata.sql` because `attachments` was missing. Seven tables used at runtime were never created by any tracked migration: `attachments`, `firearm_status_history`, `ammunition_lots`, `ammunition_transactions`, `ammunition_reconciliations`, `ammunition_reconciliation_items`, `pilot_ammunition_workspaces` and `pilot_remediation_workspaces`. | Added `supabase/migrations/202609100001_complete_module_tables.sql`, ported verbatim from the project's own fix `b465a33` (branch `codex/production-tls-20260919`), which was never carried into the current line. Every statement is `if not exists` or guarded. |
| (new) | `202610020002_inventory_phase1.sql` cannot apply anywhere. PL/pgSQL reads the `THEN` inside an unparenthesised `CASE` as the end of the `IF` condition, which gives "syntax error at end of input". The AWS copy (`database/aws/035`) is already parenthesised. | Parenthesised the two `CASE` expressions, matching 035. The file could never have been applied, so no deployed ledger records it. |
| EQP-09 | The tracked `equipment_assets.lifecycle_status` CHECK rejects `out_of_service`. The API, custody check-in and readiness all write that value. Production was patched only by the one-off cutover script `final-target-fixed-schema-prep.cjs`. | Added `database/aws/038_equipment_out_of_service_lifecycle.sql`, which produces exactly the production constraint. It is idempotent: on production it drops and recreates an identical constraint. |
| NEW-ADM-G | The clean-bootstrap validation never applied the `database/aws` ledger that deployed environments run. | The validator now applies all `database/aws` migrations after the Supabase lineage. It asserts the equipment lifecycle and that `update_firearm_with_audit_internal` is not executable by `authenticated` (an ARM-04 regression guard). |
| (runtime audit) | Test files whose setup never settles report "ok" with zero tests. This happened to 11 embedded-PostgreSQL files when PostgreSQL could not start. | `scripts/run-application-tests.mjs` writes a TAP report as well and fails if any test file ran no tests. |
| ARC-K2 / RNG-36 | No quality gate on pull requests. | `.github/workflows/application-quality.yml` runs on every PR and on pushes to `main` and the current line: script tests, app tests, infra tests, `tsc`, `db:validate-bootstrap` and `next build`. Lint is **not** in the gate yet, because the current line has 427 existing lint errors. That is tracked separately. |

## Verification (local, synthetic; no remote systems)

The environment was a disposable PostgreSQL 16 on 127.0.0.1, owned by a non-root user, plus repository dependencies with `xlsx` stubbed. The SheetJS CDN is blocked in this sandbox.

| Check | Before | After |
|---|---|---|
| Supabase lineage clean apply | 75/78 (fails at 202610020001, 202610020002, 202610020003) | **79/79** |
| Supabase + `database/aws` clean apply | 111/115 | **117/117** (79 + 38) |
| `db:validate-bootstrap` (run through a shim that targets the local server, because embedded PostgreSQL cannot run as root here) | Throws "Expected 75 migrations, found 78" | **Passes**, including `validate-local-armory-workflows.sql`, `validate-local-tenant-isolation.sql`, the permission matrices, retirement and the new AWS stage |
| Control: the same run with 038 removed | — | **Fails** with "AWS-native schema checks failed: equipment_out_of_service_allowed" (the regression test catches EQP-09) |
| `run-application-tests.mjs` in a sandbox where embedded PostgreSQL cannot start | Exit 0 except for xlsx failures; 11 files silently ran nothing | **Exit 1**, listing the 11 files that ran no tests |
| `tsc --noEmit` | — | 0 errors |
| `scripts/*.test.mjs` | — | 348/349 pass. The one failure is the SheetJS round trip, because `xlsx` cannot be downloaded in this sandbox |
| `next build` | — | Passes with no environment values |

## Staging and production

- No runtime change and no deployment.
- `038` must be applied to staging with `scripts/migrate-db.ps1 staging -Action status`, then `apply`. Expected: one pending entry (038), which applies and is a no-op change on a database already repaired.
- Production application of 038 needs separate authorization. Production should already hold the identical constraint (verify with `select pg_get_constraintdef(oid) from pg_constraint where conname='equipment_assets_lifecycle_status_check'`).

## Rollback

- Delete the workflow file to remove the gate.
- Revert the commit for the scripts and the Supabase migrations; these are used only for clean bootstraps.
- If 038 has been applied, it needs no rollback: the constraint is a superset of the previous one.
