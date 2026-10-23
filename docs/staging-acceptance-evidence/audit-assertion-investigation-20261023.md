# Staging authenticated acceptance: audit assertion investigation

**Status:** audit assertion classified as a test-contract mismatch; full authenticated acceptance remains incomplete and staging remains on hold during Batch 3.

## Finding

The earlier acceptance assertion inspected `event.details.result`. The `/api/settings/audit-log` endpoint returns `loadAuditFeed()` output, not raw `audit_events` rows. `normalizeEvent()` maps the canonical `audit_events.details` object to `UnifiedAuditEvent.new_values` when `new_value` is absent. The patch route writes `result: "succeeded"` inside `details`, so the normalized response exposes it as `event.new_values.result`.

The current harness assertion uses `event.action === "department_patch_upload" && event.new_values?.result === "succeeded"`. This matches the API contract. The failed assertion was therefore an **incorrect assertion**, not evidence of an application defect, permission denial, or fixture-schema problem.

## Evidence and boundaries

- `src/app/api/settings/department-patch/route.ts` inserts the `department_patch_upload` audit event after updating the department patch. If that audit insert fails, the route restores the previous patch and returns HTTP 500.
- `src/app/api/settings/audit-log/route.ts` requires `view_audit_log` or `administer_department`; the acceptance Administrator is expected to satisfy the latter.
- `src/lib/tracepoint/audit-server.ts` normalizes `details` into `new_values` and scopes feed reads to the requested department.
- `scripts/test-staging-cognito-acceptance.mjs` now checks the normalized event shape. The live run that exposed the assertion mismatch did not complete the audit check or reach Agency B isolation, so neither result is marked passed here.
- The earlier `42703` fixture failure was separate: fixture SQL referenced the nonexistent `auth.users.aud` column. It was corrected to use the AWS-native `id`, `email`, and `raw_user_meta_data` columns and reproduced locally.

## Acceptance evidence handling

The runner now writes a run-specific JSON report under this directory. Reports include the source commit, staging task revision, immutable application image digest, per-check status, safe expected/actual fields for audit and tenant-isolation assertions, and cleanup status. The report schema omits credentials, MFA material, identity values, and raw database or browser error text. A report is evidence for the run it records; it does not itself declare the staging baseline.

No additional live staging operation was run for this investigation. Resume only after the Batch 3 release coordinator explicitly confirms deployment and database operations are complete.
