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

**Not done here:** the staging release tooling (`run-aws-native-migrations.mjs` staging guard,
`migration-release-core.psm1`, `release-entitlements-staging.ps1`) still only knows the 048–063 release.
Applying 064–065 needs that follow-up first. The new application code requires 065 (the inventory
routes pass `p_idempotency_key`), so this branch's image must not be deployed before 064–065 apply.

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

See the release report for results: `tsc --noEmit`, ESLint lint ratchet, `validate-clean-bootstrap`
(embedded PostgreSQL), `run-application-tests.mjs`, `scripts/*.test.mjs`.
