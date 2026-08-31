# Supabase data-access inventory

**Inventory date:** 2026-08-31
**Evidence:** first-party `src/**/*.ts(x)` only; protected integration demo,
tests, backups, generated output and vendor directories excluded

`scripts/inventory-supabase-access.mjs` produces the stable machine-readable
`docs/aws-supabase-access-inventory.json`. It uses Node built-ins only, reads no
environment value, and makes no network/provider call. Two in-memory runs must
produce identical bytes. This is regex-assisted static evidence: it does not
prove runtime authorization, RLS enforcement, query reachability, transaction
boundaries, or the live schema.

## Counts

| Measure | Static count |
|---|---:|
| First-party source files scanned | 200 |
| `.from(...)` calls | 478 |
| `.rpc(...)` calls | 65 |
| Combined data calls | 543 |
| Auth/session/Auth Admin calls | 39 |
| Distinct table/view/RPC targets | 87 |
| Browser data calls | 24 |
| Server data calls | 519 |
| Calls statically associated with service-role context | 483 |
| Server-user calls | 14 |
| Client privilege uncertain | 22 |

Classified operations are 296 selects, 72 inserts, 58 updates, 24 upserts, 22
deletes, 65 RPCs, and 6 unknown chains. An independent token count finds 345
`.select`, 73 `.insert`, 61 `.update`, 24 `.upsert`, and 23 `.delete` tokens;
these totals differ because selection after mutation and variable-built chains
can contain more than one operation token per `.from` call.

The generated JSON records, for every detected call, its bounded context, path,
line, runtime, client/privilege evidence, target, operation, department-filter
evidence, authorization helper, workflow/side-effect hints, risk and uncertainty.

## Major findings

- Settings is the largest context with 134 calls, followed by agency training
  (67), armory (66), fleet (48), training (27), notifications (26), and off-duty
  firearms (24). This supports bounded waves rather than a generic adapter.
- The 24 browser calls are concentrated in the app landing page, shell, settings
  UI and range-rule panel. They include reads, mutations and four RPCs. Each must
  move behind a server API before RLS can stop being the browser authorization
  boundary.
- Static classification associates 193 service-role calls with no department
  filter in the same statement. This is a review queue, not a vulnerability
  count: global reference tables, helper-scoped queries, nested workflows and
  filters outside the captured chain create false positives. Each requires manual
  tenant/control classification.
- SQL contains 106 `auth.uid()` occurrences, 38 `security definer` declarations,
  44 function declarations, 51 trigger declarations and 161 literal policy
  declarations. No `auth.role()` call was found by the current pattern. These
  source counts do not describe live drift or dynamically generated SQL.
- Sixty-five RPC calls target 17 names. Permission predicates dominate:
  `has_department_permission` (31) and `is_platform_admin` (16). Workflow RPCs
  include off-duty submission/decision/inspection, agency-training close/reopen,
  firearm update-with-audit, department/member/role management and platform
  agency creation.

## RPC disposition design

Keep transaction-heavy, invariant-enforcing operations as stored procedures for
the first database wave: off-duty submit/resubmit/inspection/decision,
agency-training close/reopen, firearm update-with-audit, department creation,
member/role/group changes, and platform agency creation. They combine writes,
audit or authorization and need atomicity. Permission predicates may eventually
move to a deny-by-default authorization service, but remain database functions
until every service-role route supplies trusted transaction-local subject and
department claims. A function moves into application code only after its SQL,
locking, error and audit contract has an explicit transaction test.

Every `security definer` function requires owner, execute grant and fixed
`search_path` review. Every `auth.uid()` dependency requires a target mapping to
an immutable application subject and a transaction-local claim; missing claims
must deny access.

## Pilot comparison

| Candidate | Evidence | Decision |
|---|---|---|
| `GET /api/qualifications` imported history | Server-only; `resolveServerAccess`; service-role read of one table; explicit department and `historical_import` filters; deterministic descending date order; no side effects | Selected. Smallest complete tenant-bound read contract and entirely mockable. |
| `GET /api/settings/current-rules` | One department-scoped read, but defaulting logic is policy-bearing and settings is the largest/highest-coupling context | Deferred. Defaults and configuration semantics deserve separate contract coverage. |
| `GET /api/command-dashboard/operations` | Authorized read-only route, but joins two bounded contexts, tolerates missing tables, runs concurrent queries and derives time-sensitive aggregates | Rejected for the first pilot. Multi-source fallback and clock behavior materially increase parity risk. |

The selected route now uses a narrow server-only
`QualificationHistoryRepository`. Supabase is the only/default implementation.
It requires the authorized department at construction and as explicit method
input, rejects a mismatch before querying, exposes no generic table/filter/RPC
surface, preserves fields/filters/order/null-list mapping, maps provider failure
to a stable 500 message, and rejects unsupported provider selection. No mutation,
Auth, RLS, audit, notification or adjacent qualification path changed.

## Ordered conversion waves

1. Complete low-risk server-only single-table reads by bounded context, with
   tenant-negative and query-contract tests for each route.
2. Convert read-only reference/configuration contexts (equipment, certification,
   department rules), explicitly testing defaults and global-vs-tenant scope.
3. Convert multi-table server reads (readiness, dashboards, fleet/training views)
   with snapshot/clock/fallback contracts and consistent-read requirements.
4. Move the 24 browser calls behind authenticated server APIs while Supabase RLS
   remains active as defense in depth.
5. Encapsulate single-table mutations with audit and compensation tests.
6. Encapsulate transactional workflows and retained RPCs; define explicit DB
   transactions for PostgREST sequences currently spread across calls.
7. Rehearse target PostgreSQL claims/RLS/security-definer compatibility and data
   validation. Keep Supabase authoritative until all waves pass.
8. Migrate Auth last, preserving immutable application subject IDs.

Rollback is per route/provider boundary before target writes. Dual-read is
permitted only for read comparison with redacted mismatch metrics and an
explicitly authoritative source. Dual-write is prohibited until idempotency,
ordering, reconciliation ownership and rollback replay are solved.
