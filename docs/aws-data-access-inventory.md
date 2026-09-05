> 2026-09-04 refresh: the current generated JSON now scans 274 source files and records 495 .from calls, 65 RPC calls, 39 matched Auth calls, 24 browser data calls, 536 server data calls, 399 statically identified service-role calls and 125 uncertain client contexts. The historical analysis below describes its dated snapshot. Regex inventory is not runtime authorization proof. See aws-migration-checkpoint-20260904.md for current migration decisions.

# Supabase data-access inventory

**Inventory date:** 2026-09-01
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
| First-party source files scanned | 231 |
| `.from(...)` calls | 484 |
| `.rpc(...)` calls | 65 |
| Combined data calls | 549 |
| Auth/session/Auth Admin calls | 39 |
| Distinct table/view/RPC targets | 88 |
| Browser data calls | 24 |
| Server data calls | 525 |
| Calls statically associated with service-role context | 448 |
| Server-user calls | 14 |
| Client privilege uncertain | 63 |

Classified operations are 297 selects, 75 inserts, 58 updates, 24 upserts, 23
deletes, 65 RPCs, and 7 unknown chains. An independent token count finds 347
`.select`, 76 `.insert`, 61 `.update`, 24 `.upsert`, and 24 `.delete` tokens;
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
| `GET /api/settings/current-rules` | One department-scoped read with deterministic policy defaults | Selected in wave 2; exact query/default/tenant/error contracts are tested. |
| `GET /api/command-dashboard/operations` | Authorized read-only route, but joins two bounded contexts, tolerates missing tables, runs concurrent queries and derives time-sensitive aggregates | Rejected for the first pilot. Multi-source fallback and clock behavior materially increase parity risk. |

Fifteen selected routes now use narrow server-only repositories: qualification
history, current department rules, certification types, the agency-training
course catalog, equipment types, assets/member directory and requirements,
settings overview, equipment and certification readiness, and Agency Training
instructors, requirements, and events.
Supabase is the only/default implementation.
It requires the authorized department at construction and as explicit method
input, rejects a mismatch before querying, exposes no generic table/filter/RPC
surface, preserves fields/filters/order/null-list mapping, maps provider failure
to a stable 500 message, and rejects unsupported provider selection. No mutation,
Auth, RLS, audit, notification or adjacent qualification path changed.

The equipment wave moved five reads used by three GET handlers behind one
tenant-bound repository: type catalog, assets, active memberships, member
profiles, and requirements. The core requires the server-resolved department on
every entry point and the authenticated user for asset visibility. Users without
department-wide permission remain restricted to their own assigned assets. The
Supabase adapter preserves projections, active-member filtering and sort order;
all colocated POST/PATCH paths remain direct and unchanged.

The settings-overview wave moved ten reads behind one tenant-bound repository:
department, rules, permission-gated security settings, role and permission
catalogs, department role permissions, and four support-mode membership/profile
reads. It preserves the existing permission and support-mode gates, projections,
ordering, empty-profile short circuit, member aggregation, and provider error
messages. The authorization-sensitive non-support membership RPC remains direct
and unchanged.

The readiness wave moved ten reads used by the equipment and certification
readiness GET handlers behind one tenant-bound repository. Both production
callers retain their feature and permission gates. Equipment self-only
visibility is applied to both memberships and assigned assets before provider
access. Exact projections, active/required filters, profile fallbacks, empty
profile short-circuiting, aggregation output, and provider error messages are
covered by focused tests. Twenty-nine of 551 static data calls are now behind
production repository boundaries; Supabase remains the sole/default provider.

The Agency Training read wave moved four more reads behind the tenant-bound
boundary: active instructor memberships and their profiles, recurring training
requirements with course references, and the event catalog with attendee and
instructor aggregates. The three GET handlers preserve their exact projections,
tenant filters, ordering, mapping, permission-derived `canManage` value, empty
results, and provider error responses. Colocated event and requirement mutations
remain direct and unchanged. Thirty-three of 551 static data calls are now behind
production repository boundaries.

The first Armory read checkpoint moves five reads across firearm inventory and
inspection-history GET handlers. It preserves archived and self-only visibility,
active assignment and member mapping, Auth Admin display-name fallbacks, feature
and permission-derived access flags, inspection joins, descending date order,
and the 100-row inspection limit. Thirty-eight of 551 static data calls are now
behind production repository boundaries; all colocated mutations remain direct.

The Fleet read checkpoint moves eleven production reads across vehicle list,
vehicle detail, related equipment, work-order/document/inspection/audit history,
profile display names, and Fleet rules behind a tenant-bound repository. Exact
projections, department and vehicle filters, ordering, limits, not-found and
provider-error behavior, optional related-query behavior, permissions, and
network-field masking are covered by focused tests. Forty-nine of the original
551 static data calls are behind production repository boundaries; Fleet
mutations remain direct and unchanged. The generated inventory now contains 549
calls because eleven route calls are represented by nine thin-adapter calls.

The Training certification checkpoint moves six reads across certification
workspace and certification-requirement GET handlers. The next Range and
reporting checkpoint moves thirty additional reads: fifteen Range/Pilot reads,
thirteen Agency Training reporting/roster/file/certificate reads, and two
policy-metadata reads. Converted GET bodies contain no direct `.from(...)`
calls, while colocated mutations remain direct. Eighty-five of the original 551
static calls (15.4%) are now behind production repository boundaries. The
regenerated inventory contains 545 calls after consolidated query relocation.

The notifications and operational metadata checkpoint moves eighteen more
production reads: ten notification/readiness/preference reads, two command
dashboard aggregation reads, five platform agency/feature reads, and one
authenticated active-department membership read. Notification GET writes retain
their exact Supabase behavior behind a separate tenant/user-bound writer and are
not counted as converted reads. One hundred three of the original 551 calls
(18.7%) are now behind production repository boundaries. The deterministic
inventory contains 542 static calls after consolidated relocation.

The off-duty and evidence checkpoint moves sixteen reads behind two bounded
repositories. It preserves officer-only visibility, inspection ordering and
identity enrichment, rules defaults, not-found behavior, attachment filters,
workspace membership checks, no-store responses, and signed-download metadata
scope. One hundred nineteen of 551 original calls (21.6%) are isolated. The
generated inventory contains 544 static calls because mutation-only route helpers
remain in place while provider-specific read construction is represented in the
new adapters.

The administration and personal-rifle checkpoint adds six reads across audit
feeds, onboarding personnel directory, and personal-rifle list/history/inbox
paths. One hundred twenty-five of 551 original reads (22.7%) are isolated.

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
