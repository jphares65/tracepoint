# Remediation batch B5 — QR resolve

Base: `claude/fix-b0-proof-foundation` (stacked on `codex/staging-mobile-api-release-20261007` @ `555f061`). Scope and evidence come from `docs/operational-audit-20261020/reconciliation-20261020/README.md` §5 (B5), `R2-armory.md` (ARM-01, NEW-ARM-B, NEW-ARM-D, NEW-ARM-E) and `R5-fleet-equipment.md` (FLT-04, NEW-02).

No schema change and no migration. Label printing (`buildTracePointQrValue`) is unchanged.

## Defects addressed

| ID | Defect | Change |
|---|---|---|
| NEW-02 / NEW-ARM-B (High) | `POST /api/mobile/qr/resolve` always built `id.eq.<value>` into the `or()` group. `id` is `uuid`, so every unit number, VIN, asset number or serial raised `22P02 invalid input syntax for type uuid` and the route returned 500. Only bare UUIDs resolved. A value matching two rows in one table (for example a duplicated serial) also returned 500, because `.maybeSingle()` errors. | The lookup moved into `lookupQrRecords` (`src/lib/tracepoint/mobile-workflows.ts`). `qrLookupFilter` includes the `id` comparison only when the handle is a UUID. Each table query uses `.limit(2)` instead of `.maybeSingle()`. If a handle matches more than one row in a table, the route returns **409** with the existing error body shape `{ status: "unknown", message: "This code matches more than one record. Scan the TracePoint label for this item instead." }`. It does not pick a row, because picking could open custody on the wrong firearm or asset. The status value stays inside the two values the client already receives (`unknown` and `denied`), so a strict client decoder still parses it. A value matching rows in different tables keeps the existing precedence: vehicle, then equipment, then firearm. |
| FLT-04 / ARM-01, server side (High) | Printed labels encode `tracepoint://{vehicle\|equipment}/{encodeURIComponent(id)}`. The resolver's input pattern forbids `/`, so the printed label value got 400. The equipment custody lookup (`GET /api/(mobile/)equipment/custody?identifier=`) returned 404 for it. | Added `parseTracePointQrValue` (`src/lib/tracepoint/qr-identifiers.ts`), the inverse of `buildTracePointQrValue`. The resolver extracts the record ID and uses the kind as a hint, querying only that kind's table. The decoded ID must still pass the original handle pattern, so a label cannot smuggle `,` or `(` into the `or()` filter. Custody GET strips an `equipment` label to its ID before matching. Every value accepted before is accepted unchanged: an accepted handle cannot contain `/`, so it can never match the label pattern. No HTTPS deep-link form is defined anywhere in the code, so none was added and HTTPS links still get 400. |

## Not changed (documented)

| ID | Why not changed |
|---|---|
| NEW-ARM-E (Low): `denied` versus `unknown`; equipment has no permission check | **Across tenants there is no leak.** Every query is bound to the caller's `department_id`. The real-Postgres check below shows that another department's firearm serial (`B-SN-1`) returns the same `unknown` as a value that does not exist. That meets the §5 B5 acceptance criterion "a non-member gets the same response for absent and denied items". **Within a tenant,** an unauthorized firearm still returns `denied`. That is an explicitly tested contract (`mobile-workflows.test.ts`, "QR decisions do not disclose an unauthorized firearm": the denied body carries no ID). Changing it would alter what the unseen native client shows. In aws-native mode `admin` is the caller's RLS client, and `firearms_select_scoped` already limits the rows to firearms the caller may read. So `denied` only discloses a firearm the caller can already see. The residual disclosure exists only in bridge mode, where `admin` is the Supabase service role. **Equipment:** the resolver applies the same authorization as the custody route it routes to: `getEquipmentServerContext` checks only the `equipment_readiness` feature, and RLS applies in aws-native mode. A permission check only in the resolver would be inconsistent. **Owner decision:** whether within-tenant `denied` should become `unknown`. That is a one-line change in `qrDecision` plus the existing test. |
| NEW-ARM-D (Medium): resolver returns `workflow: "firearm_custody"`, but no bearer-callable mobile route serves it | This is missing capability, not a defect in existing code. No route was built. `/api/armory/firearms/[id]/custody` calls `resolveServerAccess()` without the request, and aws-native mode returns 401 for any `Authorization` header. The resolver still returns the firearm decision as before. |
| Observed, out of scope (already tracked as EQP-06 / NEW-01, batch B2) | On the local AWS-chain database, the officer user sees 0 rows in `equipment_assets` and 0 rows in `firearms`; the admin sees 3 and 1. So in aws-native mode, an officer who scans unassigned equipment gets `unknown` from the resolver and 404 from custody lookup, even after this fix. That is the RLS gap B2 addresses. |

## Verification (local, synthetic; no remote systems)

The environment was a disposable PostgreSQL 16 on 127.0.0.1:55615, owned by a non-root user. The schema came from a clean apply of `supabase/migrations` and `database/aws` (117/117), seeded with the `verify-db` synthetic tenants. One firearm (`FA-0001` / `A-SN-1`) and one equipment row with a duplicate serial (`RAD-1`) were added. Queries ran through the real `PostgresDataClient` as `tracepoint_runtime` (`set local role authenticated` and the subject and department GUCs), as the Dept A administrator. **Before** is the verbatim lookup from the HEAD route; **after** is `parseQrIdentifier` plus `lookupQrRecords`.

| Input (Dept A admin) | Before | After |
|---|---|---|
| vehicle UUID | 200 vehicle | 200 vehicle (unchanged) |
| unit number `A-101` | **500** (`22P02` ×3) | 200 vehicle |
| printed label `tracepoint://vehicle/<uuid>` | **400** | 200 vehicle |
| asset number `EQ-2` / serial `RAD-2` | **500** | 200 equipment |
| printed label `tracepoint://equipment/<uuid>` | **400** | 200 equipment |
| firearm asset `FA-0001` / serial `A-SN-1` | **500** | 200 firearm |
| firearm UUID | 200 firearm | 200 firearm (unchanged) |
| duplicate serial `RAD-1` (two equipment rows) | **500** | **409** ambiguous |
| Dept B firearm serial `B-SN-1` | **500** | 200 `unknown` (same as absent) |
| Dept B firearm UUID | 200 `unknown` | 200 `unknown` |
| absent `NOPE-1` | **500** | 200 `unknown` |
| `https://app.example/q/firearm/x` | 400 | 400 (no HTTPS form defined) |

Regression tests. Each failed against the pre-fix source with the test changes kept: 6 failing, 6 passing. Each passes after the fix.

| Test | What it proves |
|---|---|
| `src/lib/tracepoint/mobile-workflows.test.ts`, "QR resolver accepts the printed label value and every previously accepted handle" | Labels parse to handle and kind. Bare UUID, unit, asset, serial and VIN handles are unchanged. HTTPS links, the `firearm` kind, spaces and an encoded `,` injection are rejected. |
| same file, "QR lookup compares only UUID handles to uuid id columns" | The `or()` filter string has no `id.eq` for a non-UUID handle. |
| same file, "QR lookup SQL never binds a non-UUID handle to an id comparison" | The SQL compiled by `PostgresDataClient` for `FA-0001` has no `t."id" =` term and uses `limit 2`. For a UUID handle the id term is present. |
| same file, "QR lookup honours the label kind and reports duplicate matches as ambiguous" | A vehicle label queries only `fleet_vehicles`. Two matching rows give `ambiguous`. |
| `src/lib/tracepoint/qr-identifiers.test.ts`, "parses printed TracePoint QR identities back to their record" | Build and parse round-trip, and malformed values give `null`. |
| `src/lib/equipment/mobile-custody-route.test.ts` (one added assertion) | Custody GET strips an equipment label before matching. |

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `node scripts/run-application-tests.mjs` | 561 tests, 557 pass. The 4 failures are the xlsx-stub tests in `src/lib/ai-importer/workbook.test.ts` (environment). The 11 embedded-PostgreSQL files that ran no tests are the same list as B0 (environment). |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 349 tests, 348 pass. The only failure is the SheetJS round trip (xlsx stub). |
| `npx eslint` on the changed files | Clean |

## Staging and production

- Runtime change only (application image); no migration.
- Run reconciliation README §8 **S4** on staging, before and after: scan a printed vehicle label and a printed equipment label, then resolve a unit number, an asset number and a serial. Expected after: all 200 with the right entity. Also resolve a deliberately duplicated serial and expect 409 with `status: "unknown"`.
- Run **S10** (tenant-negative suite). A Dept B identifier scanned from Dept A must return `unknown`.
- **Check with the native-client owner:** a printed label value posted as-is now returns 200 instead of 400. A client that already strips `tracepoint://kind/` is unaffected. Confirm the client shows the `message` for a 409 the same way it does for a 400.

## Rollback

Revert the commit and redeploy the previous image. There is no data or schema change.
