# Provider conversion wave 3: equipment reads

**Date:** 2026-08-31
**Starting checkpoint:** `0ba072ac9ac91fecd98cc4e75b9ffc5edcb9e2c1` (`main`)
**Evidence boundary:** local source, deterministic inventory, mocks, and offline validation only. No AWS, Supabase, database, storage, email, or other live-provider call was made.

## Converted production callers

| Caller | Reads moved behind the boundary | Preserved behavior |
|---|---|---|
| `GET /api/equipment/types` | `equipment_types` | wildcard projection; authorized department equality; category then name order; empty list; `canManage` response |
| `GET /api/equipment/assets` | `equipment_assets`, active `department_memberships`, and member `profiles` | newest asset first; self-only assigned-asset filter without department-view permission; active member list; profile/rank/unnamed display fallback; null fields; permission response |
| `GET /api/equipment/requirements` | `department_equipment_requirements` | wildcard projection; authorized department equality; created-at order; empty list; `canManage` response |

These are five provider reads across three frequently used equipment GET routes.
The colocated POST/PATCH handlers, officer-scope mutation validation, and all
other equipment/readiness routes remain unchanged and direct.

## Repository boundary

- `TenantBoundEquipmentReadRepository` is the provider-neutral core. It owns
  tenant equality checks, authenticated-user presence, self-only visibility
  input, profile lookup suppression for an empty member set, and member response
  mapping.
- `EquipmentReadDataSource` exposes only the five domain reads needed by the
  converted callers. It exposes no generic table, SQL, RPC, mutation, or client
  surface and is suitable for a later Aurora or DynamoDB implementation.
- `SupabaseEquipmentReadDataSource` is the thin query adapter. It alone owns
  table names, projections, filters and ordering.
- `createEquipmentReadRepository` is server-only, defaults to Supabase, and
  rejects any unsupported `TRACEPOINT_DATA_PROVIDER` value. No AWS SDK was added.

The provider-neutral core imports no Supabase package, AWS SDK, Next.js request
object, `NextResponse`, or environment-specific client.

## Tenant isolation

`getEquipmentServerContext` remains the sole route source of the authenticated
department, user and permissions. Browser agency input is not accepted. The
repository is constructed with that resolved department and requires the same
department on every operation; missing or mismatched values fail before provider
access. Asset reads also require the authenticated user ID. A user lacking
`manage_equipment`, `view_command_dashboard`, and `view_analytics` retains the
legacy `assigned_user_id = authenticated user` restriction. Membership reads
remain both department-bound and active-only.

## Inventory reconciliation

Two post-change generations were byte-identical at SHA-256
`05C63613084F377663D847B85ABC355F3B2EB47BC016DF5D4EC2C63D8229F6F8`.
The stable totals remain 543 data calls (478 `from`, 65 RPC), 39 Auth calls, 87
targets, 24 browser calls and 519 server calls. Three non-test repository files
increase scanned files from 208 to 211. Five calls moved from equipment routes
to the adapter, so context attribution changes from equipment 15/shared 10 to
equipment 10/shared 15; this is relocation, not provider elimination.

Nine of the 543 static data calls now sit behind production repository
boundaries, leaving 534 direct calls outside those boundaries. Remaining static
context counts are: settings 133; agency training 66; armory 66; fleet 48;
notifications 26; training 26; off-duty firearms 24; pilot 20; platform 18;
server-access 12; equipment 10; readiness 10; activation 10; super-admin 8; and
smaller contexts 53. The 15 generic `shared` calls contain all nine repository
adapter calls plus six other direct calls. These regex-assisted counts do not
prove runtime reachability or authorization.

## Validation

- Focused equipment repository tests: 6/6 passed.
- All repository tests from waves 1-3: 22/22 passed.
- Root TypeScript check: passed.
- ESLint for every changed TypeScript file: passed.
- Inventory generation repeated byte-for-byte.
- Static searches confirm the three converted GET bodies contain no `.from` or
  `.rpc`; remaining matches in those files belong only to unchanged mutations.
- Static searches confirm the provider-neutral core has no Supabase, AWS SDK,
  Next.js request/response, or environment-client import.
- Next.js 16.2.6 production build: passed, including TypeScript and 77 static pages.
- Full-project ESLint: failed on 813 pre-existing/unrelated findings, including
  generated `infra/cdk.out.*` bundles and existing application `any`/React-hook
  findings. Targeted changed-file lint remained clean; unrelated code was not
  modified to force a green result.
- `git diff --check` and final status are recorded in the final handoff.

## Migration estimate

Using the existing status-document method, local AWS preparation remains 96%,
data-access conversion rises from approximately 1% to approximately 2% (nine of
543 static calls behind used repository boundaries), Auth remains 0%, storage
remains 100% of five inventoried direct call sites, email remains 100% of two
inventoried callers, total provider conversion remains approximately 12% after
rounding, and total AWS migration remains approximately 34%. No provider was
cut over and no AWS infrastructure was changed.

## Recommended next wave

Convert the equipment readiness read model next: `GET /api/readiness/equipment`
and the read portions of `GET /api/equipment/requirements` consumers. It shares
the new catalog/asset/requirement domain but adds deterministic readiness
aggregation, department-member scoping and profile enrichment. Characterize its
clock/date rules and preserve per-user versus command-wide visibility before
moving it. Keep equipment mutations for a later audit/atomicity wave.
