# Agency Documents integration onto the production line (2026-10-18)

Branch `claude/agency-documents-integration` = `store/privacy-policy-20261017`
(production runs `e49e73dc`; the tip adds two docs commits) merged with
`claude/agency-documents-staging` (Agency Documents plus hardening).
Nothing has been deployed or migrated.

## Migration lineage

| Version | File | Origin | Recorded state |
| --- | --- | --- | --- |
| 038 | `038_agency_documents_template_builder.sql` | Agency Documents | Staging ledger row recorded (hash of CRLF content `83f1ffdb…`). |
| 039 | `039_document_template_analysis.sql` | Agency Documents | Staging: expected by the 2026-10-13 runbook (001–041 contiguous); hash not recorded. |
| 040 | `040_document_template_structured_bindings.sql` | Agency Documents | Same as 039. |
| 041 | `041_document_template_write_authority.sql` | Agency Documents | Same as 039. |
| 042 | — | unused | `042_default_module_entitlements` exists only on `codex/demo-pd-module-visibility`; not part of this branch. |
| 043 | `043_range_workspace_authenticated_writes.sql` | release line, was 038 | Production: applied ledger-free (range-workspace hotfix). |
| 044 | `044_cognito_password_global_scope.sql` | release line, was 039 | Production: applied ledger-free (`password-scope-039-040` unit, `ledger_modified:false`). |
| 045 | `045_password_operation_resolution.sql` | release line, was 040 | Same as 044. |

Contents of every file are unchanged (LF SHA-256 pinned in
`scripts/aws-native-migrations.test.mjs`). Only the release-line files were
renamed, because:

- Staging's AWS-native ledger already holds version 038 (and, per its runbook,
  039–041) for Agency Documents. Versions are the ledger's primary key, so the
  release files could never be recorded there at 038–040.
- Production has no AWS-native ledger table (`aws_native_ledger_present:false`
  in `live-precheck-post-039-040.json`); its 038–040 were applied by ledger-free
  release units. No ledger row anywhere names the old release numbers.

Tooling that referenced the old numbers now uses 043–045: live release-unit
pins (unit name `password-scope-039-040` kept, as recorded in evidence), the
production range-workspace hotfix, production `reconcile`, and the inspection
manifest (which also gained 038–041 Agency Documents checks).

### Before any migration in an environment

1. Run the read-only `status` / `inspect` first and record the actual ledger and
   catalog. Staging's 039–041 rows have never been dumped.
2. Staging expected result: ledger 001–041 exact (Agency Documents), pending
   043, 044, 045. The Agency Documents SQL is not re-runnable (its `create policy`
   statements are unguarded), so it must never be re-applied where it exists.
3. Production expected result: no AWS-native ledger; Agency Documents tables
   absent. Agency Documents would be applied as a new ledger-free release unit or
   after a ledger adoption plan — neither exists yet. The production `reconcile`
   path already refused on the release line (it requires exactly two pending
   migrations while three existed) and still refuses; adopting a production
   ledger needs its own reviewed design.
4. Production releases of this branch must ship the application code and the
   Agency Documents tables together, or keep the feature hidden until the tables
   exist.

## Conflict resolution summary

- Build/deploy/migration tooling, Cognito transport, UUID handling and server
  access: production-line versions. Staging runs neither agency-side variant.
- Dropped agency-only pieces that duplicated or conflicted with production-line
  fixes: `aws-native-migration-ledger-core.mjs`, `postgres-uuid.ts` and its two
  legacy-UUID tests, and the staging navigation diagnostic page. If legacy
  (version-0) or hyphen-less UUID identities are ever seen, revisit the
  production UUID policy deliberately.
- Shell: production version plus the Agency Documents Administration entry
  (`NAV_ITEMS` / `getVisibleChildren` exported for its navigation test).
- New dependency from the Agency Documents line: `@aws-sdk/client-textract`
  (optional flat-PDF scan path).

## Not integrated

- `codex/demo-pd-module-visibility` (what staging currently runs, app `a3fa985`):
  65 commits of mobile field-ops APIs, staging release tooling and 042
  entitlements that are on neither this branch nor production. Deploying this
  branch to staging would remove that work from staging until it is integrated.
- `codex/dual-ledger-mutation-guards-20261015`: 3 unmerged commits.
