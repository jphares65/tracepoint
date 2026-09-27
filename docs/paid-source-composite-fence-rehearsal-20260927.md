# Paid-source composite fence rehearsal — 2026-09-27

Scope: isolated paid Supabase project `reukdouvpshshvqnzsgw` only. The public
project `izlkwggluhlhzlumtzes`, its maintenance listener, data, schema, DNS,
and application authority were not changed. Do **not** use the paid-project SQL
in a production SQL Editor. The local artifact ZIP contained only six source
files; customer artifacts were read and compared inside AWS CodeBuild, never
downloaded to the workstation.

## Writer inventory and controls

| Writer family | Rehearsal observation | Fence-on control and real-interface evidence |
| --- | --- | --- |
| Application/PostgREST/RPC | Exact-project modern secret and one synthetic fleet row | Existing 190 public fence triggers plus `write_fence_state.frozen=true`; service-role REST `PATCH` rejected with PostgreSQL `55000`, unchanged row. The public application has no connection to this paid source project. |
| Service-role/server/background | Exact-project modern key stored in the rehearsal-only AWS secret; no paid-project application worker | Same database trigger; Auth-admin create and Storage REST upload both rejected HTTP 500 with zero persisted probe rows/objects. Trusted AWS capture CodeBuild made only bounded reads. |
| Auth API | One existing synthetic Auth user; signup initially enabled | Signup disabled reversibly and existing 50 Auth fence triggers remained enabled. Auth-admin create was rejected while frozen. Re-enabling signup alone would not block administrative or existing-user Auth writes; it is defense in depth, not sole proof. |
| Storage API | One existing synthetic object | Existing eight Storage fence triggers; direct Storage REST upload rejected while frozen with zero probe objects. |
| S3-compatible Storage | S3 protocol initially enabled; **zero separate S3 access keys** | Protocol disabled reversibly; dashboard showed zero access keys throughout. There was no configured separate-key writer to exercise. No claim is made that RLS would constrain a future separate S3 key; such a key would require an independent deny/probe before live use. |
| Scheduled/import/admin automation | `cron.job` count 0, active count 0; no paid-project import task started | No autonomous paid scheduler to pause. Frozen captures and pre/post census showed no unreviewed mutation. |
| Privileged human operator | Paid-project SQL Editor `postgres` | Explicitly excluded from the autonomous-writer negative condition by owner instruction. Only the recorded fence transitions and read-only verification were executed while frozen. |

The paid-project legacy `anon`/`service_role` API keys were disabled through
the dashboard for the frozen interval and re-enabled afterward. This setting
is reversible but blocks only use as an `apikey` header; the underlying JWT can
remain valid. No modern `sb_secret_...` key was deleted or rotated. There was
no separate S3 credential to delete or rotate.

## Versioned executable sequence and evidence

1. Attest the paid project URL, `postgres` database/operator, exactly one
   synthetic department ID `acb5b501-2309-4a9e-a504-f36c08728fa9`, 248
   existing fence triggers, fence-function MD5
   `53045ace60d3a55a673066017d814b38`, zero active cron jobs, one Auth
   user, and one Storage object. The paid project began with the database
   fence on; the first execution of
   `supabase/source-rehearsal/20260927_composite_fence_off.sql` succeeded.
2. With the fence off, run
   `node scripts/probe-paid-source-auth-storage-fence.mjs --off`. It created
   and deleted one synthetic Auth user and one synthetic Storage object; a
   self-ID `PATCH` of the synthetic fleet row returned 204. Results were
   Auth 200, Storage 200, REST 204, and zero leftover probe records.
3. Disable paid-project signup, S3 protocol, and legacy `apikey` acceptance
   in the dashboard, retaining the modern read/capture secret. Execute
   `supabase/source-rehearsal/20260927_composite_fence_on.sql` only in the
   attested paid SQL Editor. It committed `frozen=true` at
   `2026-09-27 13:46:31.917479+00`. Verify all three dashboard controls are
   saved and unchanged, zero separate S3 keys, and zero active cron jobs.
4. Run `node scripts/probe-paid-source-auth-storage-fence.mjs --on` and
   `node scripts/probe-paid-source-rest-fence.mjs`. The Auth-admin and Storage
   uploads each returned 500 with no persisted probes. The service-role REST
   write returned 500 with PostgreSQL `55000`; the synthetic row remained.
5. Start two separate runs of the existing exact paid-project CodeBuild
   `tracepoint-production-source-rehearsal-capture-20260925` from S3 source
   VersionId `GVQ9I6YuUtLc.XY9HaSsklUDucJvTKSU`, with environment values
   `TRACEPOINT_EXPECTED_AWS_ACCOUNT=193644343389`,
   `TRACEPOINT_SOURCE_REHEARSAL_PROJECT_REF=reukdouvpshshvqnzsgw`, and
   `SOURCE_REHEARSAL_SECRET_KEY` as the Secrets Manager ARN ending `mk9wbs`
   (type `SECRETS_MANAGER`, never a plaintext override). Use distinct run IDs
   `7043af9d-4d3b-40ce-a9d6-c9534129f876` and
   `b1d2e179-53cf-4a7d-98fa-bad17f468e3d`; each output is create-only,
   encrypted, versioned, and read back. Build IDs: `def59205-c83c-433d-85b2-e617814871a8`
   and `fec8636b-5edc-4884-98a9-7bb997a74c09`; both `SUCCEEDED`.
6. Artifact A: `migration/source-rehearsal/7043af9d-4d3b-40ce-a9d6-c9534129f876/final-canonical.json`,
   VersionId `fqtRR9_4EXaKYdQAJOSA3WrObNhxO61q`, whole-file SHA-256
   `6bac090ec09adef58d8caf53155e1480c2b1cfafd02c89ba282ead5228c21378`.
   Artifact B: `migration/source-rehearsal/b1d2e179-53cf-4a7d-98fa-bad17f468e3d/final-canonical.json`,
   VersionId `cn1Aq3I8mvkhLG0WRD0JRhp05Qus69mn`, whole-file SHA-256
   `4790d4006871264a53af45c856ec7cb65cf2efb29e818b3b0f1f70633fd78a8a`.
7. Run the tracked `buildspec.source-rehearsal-double-compare.yml` and
   `scripts/compare-frozen-source-captures.mjs` inside AWS CodeBuild from the
   six-file immutable source ZIP
   `source/tracepoint-source-rehearsal-double-compare-7f1d327042c96957.zip`,
   VersionId `a3tlHci43bBMbqgwPrJx01GkGAbUj9B8`. Comparator build
   `8b8175c8-756c-41e3-ace5-bba6470e9032` returned
   `FROZEN_SOURCE_QUIESCENT`: 123,378 ms quiet interval, 90 contracts,
   170/170 rows, one/one identity and membership, one/one object, and zero
   changed relations/identities/memberships/objects. No row payload was logged.
8. Re-enable legacy keys, signup, and S3 protocol while the database fence
   remains on. Execute the exact guarded paid-project `_off.sql` transaction
   last. It committed `frozen=false` at
   `2026-09-27 14:05:37.921264+00`. Run the `--off` positive probes again:
   Auth 200, Storage 200, REST 204; all Auth/Storage probes cleaned up.
   Final read-only census: one department, one Auth user, one Storage object,
   one synthetic fleet row, 42 audit events, zero cron jobs. Two expected
   synthetic fleet self-updates produced one audit event each outside the
   frozen interval. No customer data was touched.
9. The temporary exact-resource capture role policy
   `PaidRehearsalDoubleCaptureExact20260927` was removed. The isolated role
   again has only `SourceRehearsalCaptureExact20260925`. The reviewed exact
   policy document is retained at
   `infra/source-rehearsal-double-capture-grant-20260927.json` solely for
   reproducibility; it is not attached.

## Live-source precheck: **cutover remains stopped**

Read-only TLS-pinned production catalog inspection still reports 122 base
relations (87 public, 27 Auth, eight Storage), zero fence triggers, and no
cutover schema. The existing production ownership preflight exits 1:
`OWNER_TRIGGER_PREFLIGHT_BLOCKED`. The `postgres` SQL Editor role does not own
the 35 Auth/Storage tables, so the previously reviewed 244-trigger activation
cannot be used. The production final-capture runner also expects that old
244-trigger status RPC and has a single-run artifact pin. The paid-project
proof does not repair those production commands or demonstrate a reversible
production-wide Auth/Storage/customer-writer exclusion. Therefore the
maintenance response must **not** be reopened using the old package. A
reviewed production-specific operational control and dual-capture binding,
plus read-only effective-action prechecks, are required before resuming §2.1.

This is a production safety prerequisite, not a new rehearsal gate. Stable
paid-project captures show quiescence only for that isolated project and
interval; they do not prove a live production source fence.
