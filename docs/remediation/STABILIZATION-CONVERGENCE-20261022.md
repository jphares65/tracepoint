# Stabilization convergence (2026-10-22)

Branch `claude/stabilization-convergence-20261022`, cut from the staging lineage `d9ef61e1`
(`claude/staging-baseline-20261022`, CI green) and merged with `c844398c`
(`claude/integration-final-20261022`, CI green). Nothing here is deployed or applied.

## Why

The defect remediation split into two lineages after `5b9ec98`:

| Lineage | Head | Contains | Deployable? |
|---|---|---|---|
| Staging | `d9ef61e1` | B0–B11, staging's own Range Day / Agency Documents / entitlement work, migrations renumbered 049–063 | Yes: staging's ledger is 001–063 (applied 2026-10-22, evidence `staging-after-20261022T172328Z`). The running image is still `22e543d`. |
| Integration | `c844398c` | UX-RB, UX-RB2, SV-28 custody, SV-29 settings, inventory D-62/63/65/70, C-07, C-32, C-48, D-14, D-22, reconciliation withdrawal and Save Draft/Submit concurrency | **No**: it numbers B0–B11 as 038–053 and adds 055/056, so the runner stops with `MIGRATION_DRIFT` against staging's ledger. |

This branch carries the integration lineage's fixes onto the deployable lineage.

## Migrations

| Version | File | Was | Status |
|---|---|---|---|
| 064 | `064_armorer_storage_location_permission.sql` | 055 on `c844398c` | pending, never applied anywhere |
| 065 | `065_inventory_idempotency_and_recipients.sql` | 056 on `c844398c` | pending, never applied anywhere |
| 066 | reserved: B8a armory history contract | was reserved 064 | no file |
| 067 | reserved: B6 notification job recipients | was reserved 065 | no file |

The real migrations take 064/065 because the manifest test and the runner both require contiguous files;
the two reservations have no file and no ledger row, so moving them changes nothing applied. Only the
audit text inside 064 changed (`'055'` → `'064'`). No applied migration was edited.

**Release tooling** (`89ce94b9`): the staging release unit is now 064–065 on top of a recorded 001–063
(a stopped apply with 064 recorded resumes with 065). The new application code requires 065 (the
inventory routes pass `p_idempotency_key`), so this image must not be deployed before 064–065 apply.
The pre-release task-revision pin (`':191$'`) must be re-pinned to staging's revision at release time.

**Rollback (G7).** 064 only grants a permission; 065 keeps the 035/036 signatures and the previous
image's calls are proven on real PostgreSQL through the data client ("the previous image's signatures
still record without a key"); `22e543d`'s data client builds RPC calls identically. The previous image
therefore keeps working if this release rolls back after 064–065 apply.

## Also fixed on this branch

| Defect | Commit | Evidence |
|---|---|---|
| Production's sidebar commit (`5700011`, not on any branch) carried forward so a promotion does not revert it | `6221e338` | its own test, 3/3 |
| D-3 `GET /api/inventory/checkouts` 500 on AWS-native: the data client did not know the `inventory_checkout_returns` relation | `b015d1d9` | `postgres-data-client-relations-native.test.ts`, real schema, fails before |
| D-4 Agency Documents person search 500 on AWS-native: an OR alternative could not name the embedded `profiles` relation | `b015d1d9` | same test; another agency's members never listed |

## Conflict decisions

| File | Decision |
|---|---|
| `range-days/page.tsx` | UX-RB's client (one device record per user and agency, version-checked saves with merge and visible conflicts) replaces staging's autosave queue. Kept from staging: Range Day immutability during hydration, a unique id for every library drill added to a day (exact deletion), the server's confirmation of the removed drill, a load failure shown instead of swallowed, the missing-template message, and a Save button whose label never turns into a result message. |
| `api/pilot` and `api/mobile` `range-workspace` GET/PUT | **New fix (tenant isolation).** Both GETs returned historical records stamped with another agency; staging's client hid them, UX-RB's would have shown them, and the mobile app received them. Both GETs now drop them, and the mobile PUT gets the web PUT's boundary check and protected-record merge, so the other agency's records stay byte for byte. Mobile PUT also stops reporting a database error as "Scores changed" (409); only a lost version race is 409. Test: `src/lib/range/workspace-tenant-isolation-routes.test.ts` (fails 3 of 8 before the fix; a mutation without the mobile merge fails it). |
| `lib/range/workspace-mutation.ts` | Auto-merge dropped the `existing` binding that staging's tenant check uses; restored. |
| `api/inventory/checkouts/route.ts` | Integration's idempotency and holder names, plus staging's null guard for `inventory_checkout_returns` (the 500), now also normalized in the response for the page. |
| Fleet vehicle and list pages | Staging's layout with integration's UX-RB2-3/4 and D-14 changes (inspect/report gated by the server; hold-blocked status buttons; applied status reported; open-issue count no longer typed; correction reason in the dialog). |
| `cognito-transport.ts`, `request-proxy-core.ts`, `proxy.ts`, login | Both: SV-32 return path plus staging's tenant-context clearing on account switch and `/support`, `/privacy` public paths. |
| Others | Integration's version (certifications, reconciliation, firearm inspection, off-duty, equipment readiness, settings), checked against staging's side for lost behaviour. |

## Gates run locally

On `b015d1d9`, from an LF checkout (as CI and the image build): `tsc --noEmit` clean; lint ratchet
passes (no new findings); `run-application-tests.mjs` 1369 pass, 0 fail, 2 skipped; `scripts/*.test.mjs`
426/426; `migration-release-core.tests.ps1` passes (pwsh and Windows PowerShell 5.1);
`validate-clean-bootstrap` passes (80 + 65 migrations, every `validate-local-*` check). Not yet run on a
GitHub runner (not pushed).

The D-2 fix (migration 066, its release unit) is stacked on this branch as
`claude/fix-d2-equipment-condition-report`, a separate release after this one.
