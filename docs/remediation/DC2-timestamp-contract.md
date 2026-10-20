# Remediation DC2: AWS-native timestamp and type contract

Base: `claude/integration-defects-20261020` (`e19e84c`). Follows DC (`cec3235`, calendar dates). Evidence: `DC-date-contract.md`, the DC production impact inventory on `claude/hotfix-date-contract-candidate` (§6 "adjacent finding"), and `NATIVE-CLIENT-CONTRACT-CHANGES.md` §2.

Scope: defects only. **No SQL migration** (054 was not needed). One file of runtime code changes: `src/lib/database/postgres-type-parsers.ts`.

## Defects addressed

| ID | Status | Defect (verified on the base) | Change |
|---|---|---|---|
| DC2-1 (High where AWS-native is live) | **Fixed** | The AWS-native pool (`postgres-pool.ts`, `types: postgresRuntimeTypes`) left `timestamptz` (OID 1184) and `timestamp` (1114) to `pg-types`, which builds a JavaScript `Date`. The web and mobile code was written against PostgREST, which returns ISO **text** (`"2026-10-20T20:55:26.123456+00:00"`). String helpers drop or mangle a `Date`: `typeof v === "string"` guards return `""`/0/`null`, `String(d)` gives `"Tue Oct 20 2026 …"`, and `localeCompare` on that text sorts by weekday name. A `Date` also loses microseconds, so an equality filter on a value just read (`.eq("updated_at", row.updated_at)`) can match no row. `timestamp` was also read in the **server's** local zone, and `infinity` became an Infinity `Date` that serialises as `null`. | `timestamptz` and `timestamp` text is returned as `to_json` writes it: the space becomes `T` and a bare offset `+00` becomes `+00:00`. Fractional digits, offsets with seconds, `BC` and `infinity` are kept. Nothing is parsed into a `Date`, so the result does not depend on the Node time zone. |
| DC2-2 (Low) | **Fixed** | `interval` (1186) became a `PostgresInterval` object, which serialises as `{"hours":72}`. PostgREST returns the text `"72:00:00"`. Reached by `GET /api/armory/firearms/{id}/custody` (`firearm_possession_restrictions.maximum_custody_duration`, `select("*")`). No client code reads the field today. | `interval` text is returned unchanged. |
| DC2-3 (Latent) | **Fixed** | Arrays of these types did not match PostgREST: `date[]` and `timestamp[]` became `Date`s (shifted by the server zone), `timestamptz[]` became `Date`s, `interval[]` became objects, and `int8[]` became **strings**. No column or RPC uses them today, so nothing is live. | The same element rules apply inside arrays (`NULL` elements stay `null`). `int8[]` uses the existing safe-number rule, so an unsafe value throws, as for scalar `int8`. |

**Kept deliberately:**
- `int8` and `numeric` stay JSON numbers, and **unsafe values throw** (`"unsafe PostgreSQL numbers fail instead of losing precision"`). PostgREST would emit the literal, and `JSON.parse` would silently round it. `numeric[]` (`parseFloat`) already matched and is unchanged.
- `date` stays as DC left it.
- Binary-format parsers are untouched (the app uses text format).

## Type-contract matrix

**Method.** The schema was bootstrapped clean: all `supabase/migrations` plus `database/aws` (130/130) on PostgreSQL 16 (127.0.0.1:55664). Its column types were read from `information_schema.columns`, and its function result types from `pg_get_function_result`.

For each type, a real query ran through a `pg.Pool` using the app's `postgresRuntimeTypes`. Each result was compared with `to_json(<same expression>)`, which is exactly what PostgREST emits. The query shape was `select <expr> as v, to_json(<expr>) as j`. The comparison ran under Node `TZ=UTC` and `TZ=America/Los_Angeles`, with session `timezone=UTC` unless stated.

A sweep then checked 12,030 random `timestamptz` values from 1800 to 2100 in three shapes (`timestamptz`, `timestamp`, `timestamptz[]` with `NULL`). It used six session zones: UTC, America/Los_Angeles, Asia/Kolkata, Australia/Lord_Howe, Pacific/Chatham and Europe/Amsterdam. It included BC values, ±infinity, year 10000 and microsecond edges. **Result: 0 mismatches with `to_json` after the fix.** The scripts are in scratch `dc2-timestamp-contract/matrix.mts` and `sweep.mts`.

**Schema usage (public tables):**

| Type | Columns |
|---|---|
| `uuid` | 424 |
| `text` | 424 |
| `timestamptz` | **236** |
| `boolean` | 112 |
| `int4` | 89 |
| `date` | 47 |
| `numeric` | 32 |
| `jsonb` | 19 |
| `text[]` | 12 |
| `int8` | 5 |
| `int4[]` | 2 |
| `time` | 2 (`range_days.start_time`, `end_time`) |
| `interval` | 1 (`firearm_possession_restrictions.maximum_custody_duration`) |
| enums | 22 |

There are **no** `timestamp` (without time zone) columns and no `date[]`, `timestamptz[]`, `int8[]` or `numeric[]` columns. The views add `int8` counts (`v_range_day_summary`), `date` and `timestamptz`.

RPCs with time or number results:
- `get_department_members` returns `joined_at timestamptz`.
- `list_platform_agencies` returns `created_at timestamptz` and two `date` columns.
- Composite returns (`checkout_inventory`, `return_inventory_checkout`, `record_inventory_transaction` and `record_off_duty_firearm_inspection`) expand to table columns through `select * from f()`.
- `deliver_fleet_audit_outbox` returns `bigint`.

| PostgreSQL type | PostgREST (`to_json`) | node-postgres before | node-postgres after | What the code expects | Match before → after |
|---|---|---|---|---|---|
| `date` | `"2028-03-01"` | `"2028-03-01"` (DC) | same | `YYYY-MM-DD` text | yes → yes |
| `timestamptz` | `"2026-10-20T20:55:26.123456+00:00"` | `Date` (ms) → JSON `"2026-10-20T20:55:26.123Z"` | `"2026-10-20T20:55:26.123456+00:00"` | ISO **string** (typeof guards, `String()`, `localeCompare`, `.slice`) | **no → yes** |
| `timestamptz`, whole second | `"2026-10-20T20:55:26+00:00"` | `Date` → `"…26.000Z"` | `"2026-10-20T20:55:26+00:00"` | same | **no → yes** |
| `timestamptz`, session zone America/New_York / Asia/Kolkata | `"…16:55:26.5-04:00"` / `"…02:25:26.5+05:30"` | `Date` → `"…20:55:26.500Z"` | identical to `to_json` | same | **no → yes** |
| `timestamptz`, LMT offset (1850, LA) | `"1849-12-31T16:07:02-07:52:58"` | `Date` | identical | same | **no → yes** |
| `timestamptz` `infinity` | `"infinity"` | Infinity `Date` → JSON `null` | `"infinity"` | string | **no → yes** |
| `timestamp` | `"2026-10-20T20:55:26.123456"` | `Date` in **Node local** time. With `TZ=America/Los_Angeles` it gives `"2026-10-21T03:55:26.123Z"`, 7 h shifted | `"2026-10-20T20:55:26.123456"` | string (no columns use it) | **no → yes** |
| `time` | `"07:30:00"` | `"07:30:00"` | same | string | yes → yes |
| `interval` | `"3 days 04:00:00"` | object `{"days":3,"hours":4}` | `"3 days 04:00:00"` | string (unread) | **no → yes** |
| `numeric` | `123.45` | `123.45` | same | number; unsafe values throw (deliberate) | yes → yes |
| `int8` | `26214400` | `26214400` | same | number; unsafe values throw (deliberate) | yes → yes |
| `int4`, `bool`, `uuid`, `text`, enum | number, boolean, string | same | same | same | yes → yes |
| `jsonb`/`json`, including a nested timestamp | `{"at":"2026-10-20T20:55:26.123456+00:00","n":1.5}` | identical object (built in SQL) | same | object | yes → yes |
| `text[]`, `int4[]`, `numeric[]` | arrays | same | same | arrays | yes → yes |
| `date[]` | `["2028-03-01"]` | `[Date]`, local midnight; LA gives `"…T08:00:00.000Z"` | `["2028-03-01"]` | — (unused) | **no → yes** |
| `timestamptz[]` / `timestamp[]` | ISO strings | `[Date]` (timestamp[] shifted) | ISO strings | — (unused) | **no → yes** |
| `int8[]` | `[26214400]` | `["26214400"]` (strings) | `[26214400]` | — (unused) | **no → yes** |
| `interval[]` | `["3 days"]` | `[{"days":3}]` | `["3 days"]` | — (unused) | **no → yes** |
| Embedded relation (`row_to_json` in `postgres-data-client.ts`) | ISO text | ISO text: the JSON is built in SQL, so it is unaffected | same | string | yes → yes |
| RPC `TABLE(...)` / composite columns | ISO text | `Date` (top-level result columns) | ISO text | string | **no → yes** |

Other notes from the matrix:
- **Before the fix, embedded relations and top-level columns disagreed in the same response.** The same `created_at` was a string in an embedded relation and a `Date` at top level.
- Values built inside SQL with `to_json`, `row_to_json` or `jsonb_build_object` were already ISO strings and are unchanged. These include the jsonb workspaces and audit `details` snapshots.
- `bytea` (pgcrypto functions) is not read through the data client. It is out of scope and unchanged.
- **Assumption, true for RDS defaults:** `DateStyle` is `ISO` and `IntervalStyle` is `postgres`. `pg-types`' own `Date` parser had the same `DateStyle` assumption. With session `timezone` UTC (RDS default; no parameter group in `infra/lib` sets it), the offset is `+00:00`, exactly as PostgREST on Supabase (UTC).

## Consumers affected (server side, AWS-native)

Method:
- Grep for string operations on the names of the 64 distinct `timestamptz` columns. The operations searched were `typeof … "string"` guards, `String()`, `.slice`/`.localeCompare`/`.split`/`.includes`/regex, string `<`/`>` comparisons and template literals. The search also covered helper calls (`text()`, `asString()`, `dateValue()`, `get(…, "x_at")`).
- Grep for code that relies on `Date` objects: `instanceof Date`, `.getTime()`/`.toISOString()` on a database value, and `Date`-vs-number comparisons.
- Every server path found was traced. Browser pages receive JSON, so for them the change is format only. They already accepted both forms, because the bridge served PostgREST strings. No client code depends on `Z` or exactly three fractional digits (grep for `endsWith("Z")`, `.000Z`, `length === 24` and fixed `slice(11, …)` found nothing).

**Code that depended on `Date` objects (would break after the fix): none.** The only `instanceof Date` uses accept strings too: `format/date.ts`, `notifications/date-value.ts` and `mobile-workflows.ts:110`. The authentication stores (`postgres-refresh-sessions.ts`, `postgres-transactions.ts`) and `email-dispatch` wrap values in `new Date(…)`. `postgres-transactions.ts` and `postgres-sessions.ts` compare in SQL. **So no consumer needed a code change**: the parser fix is the root-cause fix.

Before/after values come from real PostgreSQL rows fed through the base parser and the fixed parser, then through each consumer's own expression (scratch `probe.mts`). They are identical under `TZ=UTC` and `TZ=America/Los_Angeles`.

| # | Module (path) | Screen / API | Production symptom while AWS-native | Before → after |
|---|---|---|---|---|
| 1 | `src/lib/tracepoint/command-operations.ts:36-40` (`dateValue` rejects non-strings) via `src/lib/operations/read-repository-supabase.ts` (`agency_training_events.starts_at`) | Command Dashboard Agency Training card, upcoming list and attention list; `GET /api/command-dashboard/operations` | **Upcoming training and "no roster" attention lists are always empty.** In-progress items still show, because that check uses status. | upcoming/attention `0/0` → `1/1` (probe); `2/1` in the regression test |
| 2 | `src/lib/tracepoint/audit-server.ts:118,139` (`asString(row.created_at)`), `:157-185` | Settings → Audit Log viewer; `GET /api/settings/audit-log`, `/api/settings/audit-log/export` | **Every event time is blank** (`""` → "—"); CSV export has an empty timestamp column. Sorting compares `Date.parse("")` (NaN), so order and the 100-row limit are arbitrary. The legacy/canonical duplicate pairing never matches, so trigger events show **twice**. | `""` → `"2026-10-20T20:55:26.123456+00:00"` |
| 3 | `src/app/api/equipment/custody/route.ts:367-369` (`String(occurredAt).localeCompare`) | Equipment custody history, web **and native** (`/api/mobile/equipment/custody`) | History is sorted by **weekday name** ("Wed" > "Tue" > "Sun" > "Mon"…), not time. The `.slice(0, 10)` can drop the newest event. | `out@10-21, out@10-18, in@10-19` → `out@10-21, in@10-19, out@10-18` |
| 4 | `src/app/api/pilot/range-workspace/route.ts:195` and `…/drills/route.ts:45` (`.eq("updated_at", row.updated_at)`) | Range workspace save and drill removal | A row whose `updated_at` has microseconds (written by SQL `now()`, an import or an operator) can never be updated. Each save returns **409 "The workspace changed…"**, because the `Date` parameter is truncated to milliseconds. Rows written by the app itself use millisecond values and are unaffected. | rows matched `0` → `1` |
| 5 | `src/app/api/notifications/route.ts:310` (`text(firearm.updated_at)`) | My Home firearm condition alerts | `createdAt`/`source_created_at` is `null`. The alert shows no time and sorts as oldest. | `null` → ISO |
| 6 | `src/lib/platform/admin-access.ts:88` (`String(row.created_at)`) | Platform admin agency list | `created_at` is `"Tue Oct 20 2026 20:55:26 GMT+0000 (Coordinated Universal Time)"` (Node-zone dependent) | → ISO |
| 7 | `src/app/api/pilot/performance-summary/route.ts:276` (`String(recorded_at) >`) | Performance summary / Command Dashboard | For two results with the same run number on one range day, the "latest" is chosen by weekday text. This is low impact: results on the same day usually share a weekday. | `first (Sun)` → `second (Mon)` |
| 8 | `src/app/api/mobile/inbox/route.ts:51,107` (`Date.parse(<Date>)`) | Native Inbox | Ordering and snooze work, but at one-second precision (via `Date.toString`). | format only (below) |
| 9 | `src/lib/tracepoint/fleet-server.ts:186` (`String(created_at)`), `src/app/api/agency-training/events/[eventId]/route.ts:133` (`String(starts_at)`) | Safety-hold work order list; training PATCH validation | Long `Date.toString()` text; `new Date()` of it drops milliseconds. Cosmetic. | → ISO |
| 10 | `GET /api/armory/firearms/{id}/custody` (`restrictions[].maximum_custody_duration`) | Firearm custody panel | Object instead of text. Unread today. | `{"hours":72}` → `"72:00:00"` |
| 11 | All JSON responses carrying top-level timestamps (web pages, `/api/mobile/**`) | — | Format differs from the pre-cutover (bridge) contract: `…123Z` instead of `…123456+00:00`. Browser pages accept both. | see Native client contract |

Checked and unaffected:
- `postgres-refresh-sessions.ts`, `postgres-transactions.ts`, `postgres-sessions.ts` and `email-dispatch` (they use `new Date(x)`).
- `mobile-workflows.ts` restriction timing (accepts both).
- `rangeWorkspaceVersionConflict` (compares milliseconds; `no conflict` before and after).
- `fleet-server.ts:122` `time()`, `agency-training-notifications.ts:59` and `inventory/checkouts` `overdue` (all use `new Date(x)`).
- Server components (`training`, `training-alerts`, `activate`, `auth/setup`): none reads a timestamp as a string.
- The SES feedback Lambda (`ses-feedback-handler.ts`) builds its own `Pool` without `postgresRuntimeTypes`, and its raw SQL is unaffected.

**One-time side effect after deploy (same class as DC §5).** `notificationFingerprint = JSON.stringify(item)` includes `createdAt`. These alerts carry a timestamp read at top level:
- firearm condition alerts (`null` → ISO);
- fleet work-order alerts (`reported_at`);
- agency-training alerts with no computed due date (`requirement.created_at`);
- personal-rifle inbox alerts (`submitted_at`/`updated_at`).

Their fingerprint changes once. On each affected user's next My Home load, those events count as "changed": acknowledgement and snooze reset (`event-reconciliation.ts:65-66`). If email is enabled, a new `Pending` row is queued for them. New `audit_events.details` snapshots built from read rows will also carry `+00:00` microsecond strings instead of `Z`. That is a mixed format in jsonb history; nothing parses it strictly.

## Tests added

| Test | What it proves |
|---|---|
| `src/lib/database/postgres-type-parsers.test.ts` (+3 tests) | `timestamptz` (fraction, whole second, `+05:30`, LMT `-07:52:58`, BC, infinity) and `timestamp` keep the `to_json` text. `interval` keeps its text. `date[]`, `timestamptz[]`, `timestamp[]`, `interval[]` and `int8[]` (with `NULL`) map element-wise, and unsafe `int8[]` still throws. The existing number, unsafe-number and date tests are unchanged. |
| `src/lib/database/postgres-timestamp-contract.test.ts` (4 tests, embedded PostgreSQL; the pool uses `postgresRuntimeTypes` as production does) | Through `PostgresDataClient`: (1) top-level `timestamptz` equals `to_json`, an embedded relation and an RPC `TABLE` row carry the same format, and a `timestamp` column is not shifted by the Node zone. (2) **Command Dashboard**: `SupabaseOperationsReadDataSource` → `buildCommandOperationsPresentation` gives the upcoming list `[event1, event2]` and attention `[event2]`. (3) **Audit**: `TenantBoundAdministrationReadRepository.listAudit` returns `created_at` strings in time order, the input `audit-server` needs. (4) **Optimistic concurrency**: `.update(...).eq("updated_at", <value just read>)` matches a microsecond row. |

## Verification (local, synthetic; no remote systems)

### Fail before, pass after

The parser was restored to the base (`git diff > fix.patch && git checkout -- postgres-type-parsers.ts`) while the new tests stayed. The tests ran, and then the patch was re-applied (`git apply`).

| Test | Before (base parser) | After |
|---|---|---|
| `postgres-type-parsers.test.ts`, `TZ=UTC` and `TZ=America/Los_Angeles` | 3 pass (existing), **3 fail** (new) | 6/6 |
| `postgres-timestamp-contract.test.ts`, `TZ=UTC` | **0/4** | 4/4 |
| `postgres-timestamp-contract.test.ts`, `TZ=America/Los_Angeles` | **0/4** | 4/4 |
| Matrix (`matrix.mts`), both zones | 13 of 27 rows mismatch `to_json` | 0 mismatches; the UTC and LA tables are byte-identical |
| Sweep (`sweep.mts`), 12,030 values × 3 shapes × 6 session zones | — | 0 mismatches |

Failure detail before the fix:
- dashboard `upcoming` was `[]`;
- audit `created_at` was a `Date` (`2026-10-21T09:00:00.500Z`) instead of `'2026-10-21T09:00:00.5+00:00'`;
- the concurrency update returned `null` (0 rows).

### Production-faithful run of the existing embedded tests

Embedded PostgreSQL cannot run as root here, so all 20 embedded files ran through a shim against 127.0.0.1:55664. The shim replaces only the server start-up, the port and the database name. The 20 are the 19 already listed by earlier batches plus the new file. In this run, **every `pg.Pool`/`Client` in those files was given `postgresRuntimeTypes`**, which the files themselves never use (`TZ=America/Los_Angeles`).
- **113/114 pass.** This includes all authentication session, refresh, first-login, membership, notification, home-read, fleet, custody, import and member-save tests.
- The single failure is a test-side assertion in `postgres-refresh-sessions.test.ts:29`: `initial.last_seen_at instanceof Date` on the test's own raw query. The production store code under test passes (10/10 other tests). See Deferred.

### Required checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `node scripts/run-application-tests.mjs` | 732 tests: 728 pass, 4 fail. The 4 failures are the xlsx stub (`ai-importer/workbook.test.ts`). 20 embedded-PostgreSQL files "ran no tests", which is the environment limitation: the 19 listed by earlier batches plus the new `postgres-timestamp-contract.test.ts`, which passed through the shim (above). |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 351 tests: 350 pass. The 1 failure is the SheetJS round trip. |
| `npx eslint` on the 3 changed/new files | clean |
| SQL | None changed, so no bootstrap or validator run was needed. The schema bootstrap (130/130) was used only for the matrix. |

## Native client contract (code not available)

There is no response-shape change: no key is added, removed or renamed. **Only the text format of timestamp values changes**, back to the pre-cutover PostgREST format.

| | Before (AWS-native today) | After (= PostgREST / bridge) |
|---|---|---|
| `timestamptz` value | `"2026-10-20T20:55:26.123Z"`: always 3 fractional digits, `Z` | `"2026-10-20T20:55:26.123456+00:00"`: **0–6** fractional digits (trailing zeros trimmed; none for a whole second, e.g. `"2026-10-20T20:55:26+00:00"`), offset `+00:00` (session zone UTC) |
| `infinity` | `null` | `"infinity"` (no current column holds it) |
| `interval` | `{"hours":72}` | `"72:00:00"` |
| Server-generated times (`new Date().toISOString()`) | `…Z` | unchanged `…Z` (e.g. `inbox.generatedAt`, range-workspace POST `updatedAt`, fleet `safetyHold.since`) |

Every `/api/mobile/**` field that changes:

| Mobile route | Fields (source column) |
|---|---|
| `GET inbox` | `items[].createdAt` (`notification_events.source_created_at`), `items[].lastSeenAt` (`last_seen_at`) |
| `GET range-workspace` | `updatedAt` (`pilot_range_workspaces.updated_at`). The client echoes it back as `baseUpdatedAt`. The server compares through `Date.parse`, so **both formats are accepted**, including values cached by the app from before the deploy. |
| `GET fleet/vehicles` | `items[].created_at`, `updated_at`, `retired_at` |
| `GET fleet/vehicles/{id}` | `vehicle.created_at`, `updated_at`, `retired_at`, `safety_hold_cleared_at`; `workOrders[].reported_at`, `started_at`, `completed_at`, `returned_to_service_at`, `created_at`, `updated_at`; `equipment[].created_at`, `updated_at`; `documents[].created_at` (legacy) / `uploaded_at` (managed); `inspections[].inspected_at`, `created_at`, `inspections[].evidence[].uploadedAt`; `history[].created_at`. New `history[].details` snapshots get the new format; old ones keep `Z`. |
| `POST fleet/vehicles/{id}/inspections` (201 and the 500 bodies) | `inspection.inspected_at`, `created_at`; `workOrder.reported_at`, `created_at`, `updated_at` (and the other work-order timestamps when set) |
| `POST …/inspections/{id}/evidence` | `attachment.uploaded_at` |
| `GET equipment/assets` | `items[].created_at`, `updated_at`, `removed_at` |
| `GET equipment/custody` | `item.history[].occurredAt` (`equipment_asset_assignments.assigned_at`/`returned_at`). **The order is also corrected** (newest first by time, not weekday). |

Checked, no timestamp fields: `session`, `qr/resolve`, `range-days`, `range-days/{id}` (jsonb workspace), `drill-documents/{id}/view`, `attachments/{id}/download` (redirect), `readiness/equipment` (dates only, from DC).

**Owner check (staging S24):** confirm the native app parses ISO-8601 with an optional 0–6 digit fraction and a `+00:00` offset. A strict formatter fails here: for example, Swift `ISO8601DateFormatter` with `.withFractionalSeconds` rejects a whole-second value, and without it rejects any fraction. If the app cannot parse this, hold DC2 for the native release, or decide on a server-side format. The web needs no change either way.

## Impact inventory: read-only confirmation (production, if AWS-native)

**UI (read-only):**
- **Command Dashboard** (`/command-dashboard`): an agency with scheduled training in the next 30 days shows an empty upcoming list.
- **Settings → Audit Log**: every row's time is "—", and some changes appear twice.
- **Equipment** → custody history of an item with several check-outs: the order is not chronological.
- **My Home**: firearm condition alerts show no time.

Loading My Home **writes** notification events. Prefer the SQL below. It was checked to run without errors on the clean-bootstrapped schema.

```sql
BEGIN TRANSACTION READ ONLY;
-- R0: the session settings the parser relies on (run as the runtime role)
show timezone; show datestyle; show intervalstyle;
-- R1: agencies whose dashboard upcoming/attention training lists are empty but should not be
select department_id, count(*) filter (where starts_at between now() and now() + interval '30 days') as upcoming_30d,
       count(*) filter (where starts_at between now() and now() + interval '7 days'
                          and not exists (select 1 from public.agency_training_attendees a where a.event_id = e.id)) as unstaffed_7d
from public.agency_training_events e where status = 'scheduled' group by 1 having count(*) filter (where starts_at between now() and now() + interval '30 days') > 0;
-- R2: audit rows rendered without a time since cutover (all of them), and likely duplicate pairs
select department_id, count(*) from public.audit_events where created_at >= '2026-09-29' group by 1;
select count(*) from public.audit_events e join public.audit_log l
  on l.department_id = e.department_id and l.entity_id::text = e.entity_id::text and abs(extract(epoch from l.created_at - e.created_at)) <= 2
 where e.created_at >= '2026-09-29' and e.action in ('insert','update','delete');
-- R3: range workspaces that cannot be saved (microsecond updated_at)
select department_id, updated_at from public.pilot_range_workspaces where extract(microseconds from updated_at)::bigint % 1000 <> 0;
-- R4: equipment items whose custody history is long enough to be mis-ordered
select department_id, count(distinct equipment_asset_id) from public.equipment_asset_assignments
 group by 1 having count(*) > 1;
-- R5: firearm condition alerts stored without a time
select department_id, count(*) from public.notification_events
 where kind in ('firearm_out_of_service','firearm_maintenance','firearm_inspection_required') and source_created_at is null and resolved_at is null group by 1;
-- R6: interval values exposed as objects
select count(*) from public.firearm_possession_restrictions where maximum_custody_duration is not null;
ROLLBACK;
```

## Interaction with `claude/hotfix-date-contract-candidate` (base `555f061`; not modified)

**Should DC2 be folded into the hotfix? Recommendation: yes, subject to S24.**
- **Same file.** The hotfix's `postgres-type-parsers.ts` is byte-identical to this base's. The DC2 patch (parser + parser test, sha256 `d624ceb1…`) applies cleanly to `origin/claude/hotfix-date-contract-candidate`. This was checked in a scratch extract (`git archive` + `patch -p1`): 6/6 parser tests pass under UTC and LA, and `tsc` is clean.
- **Same bugs.** The affected consumers exist unchanged on `555f061`: `command-operations.ts:37`, `audit-server.ts:118,139`, `equipment/custody/route.ts:325`, `performance-summary/route.ts:276`, `notifications/route.ts:302`, `admin-access.ts:88` and `range-workspace/route.ts:168`. Production reads them through the same `PostgresDataClient` (`server-access-postgres.ts:89,123`).
- **No `Date` dependants on `555f061`.** Its only `instanceof Date` uses (`format/date.ts`, `notifications/date-value.ts`) accept strings, and its authentication stores use `new Date(x)`.
- **One staging pass for both.** The hotfix already changes the native `date` format (DC), so the native check for both changes can be done together.

Minimal diff for the hotfix: `src/lib/database/postgres-type-parsers.ts` exactly as in this commit (above), plus the three new tests in `postgres-type-parsers.test.ts`. The embedded test file is optional there: `555f061` lacks the B0 runner guard and the operations/administration modules are the same, so it would run, but it is not required. Leave it out if the hotfix should stay minimal. Hotfix staging must add S24 and the one-time notification-fingerprint note above.

## Staging (reconciliation README §8)

Image only; no migration. Deploy with the integration image, or with the hotfix image if folded in. Run S24 before and after, then S10.

**S24 — Timestamp contract (web, native app, API):**
1. As command staff of a synthetic agency with a scheduled training event 3 days out and no roster, open the Command Dashboard. **Expected after:** the event is in Upcoming Training **and** in Training Attention. **Before:** both lists are empty.
2. Settings → Audit Log: make one member change, then reload. **Expected:** the row shows date and time, appears once, and the CSV export has the timestamp. **Before:** "—" and possibly two rows.
3. Through the native app: check out and return an equipment item on two different days, or use seeded synthetic rows on a Sunday and a Monday. Open its custody history. **Expected:** newest first by time.
4. Native app, Inbox and fleet vehicle detail: confirm items load, times display, and ordering is correct. Record the raw JSON of `/api/mobile/inbox` and `/api/mobile/fleet/vehicles/{id}`. **Expected:** timestamps look like `2026-…T…:…:…[.ffffff]+00:00`. **Include a whole-second value:** in synthetic data, set one work order's `reported_at` to `date_trunc('second', now())` and confirm the app parses it.
5. Native live scoring: load the range workspace, save, then save again with a stale `baseUpdatedAt` cached before the deploy (`…Z` form). **Expected:** the first save is 200, and the stale save is 409 `stale_workspace`.
6. In synthetic data, set the agency's `pilot_range_workspaces.updated_at = now()` (microseconds) and save a range day on the web. **Expected:** 200. **Before:** 409 "The workspace changed…".
7. My Home as an officer with an out-of-service firearm: the alert shows a time. Expect a one-time reset of acknowledgement and snooze on alerts listed in the side-effect note. If email is on, check `notification_email_queue` for new `Pending` rows and decide with the B6 owner before running the dispatcher.
8. R0 (above) on staging: `timezone` `UTC`, `DateStyle` `ISO, MDY`, `IntervalStyle` `postgres`.

## Rollback

Revert the commit and redeploy the previous image. There is no schema or data change.

Rows written after the deploy keep their values: timestamps are stored as `timestamptz`, and the text form only affects reads. Notification events whose fingerprint changed will change back once on the next My Home load under the old image (one more ack/snooze reset).

## Deferred / owner decisions

- **Native parse format (S24 step 4):** an owner decision if the app's parser is strict (see Native client contract).
- **Embedded test fidelity:** the 19 existing embedded-PostgreSQL files create plain `pg.Pool`s, so they test with `pg-types` `Date`s, not the production parsers. Switching them to `postgresRuntimeTypes` needs one test-side change (`postgres-refresh-sessions.test.ts:29` asserts `instanceof Date`). That is a test-hardening change, not a defect fix, so it is not made here.
- **Session settings:** the contract relies on `timezone=UTC`, `DateStyle=ISO` and `IntervalStyle=postgres`, which are the RDS defaults. The parameter groups in `infra/lib` do not pin them. Pinning them would be an infrastructure change and is not made here.
- **Pre-existing bridge behaviour, unchanged:**
  - `format/date.ts` `formatDate` (calendar-date mode) on a `timestamptz` string shows the **UTC** calendar date. With a `Date`, it showed the browser's local date.
  - String comparisons of two timestamps with different offsets are only correct when the session zone is uniform.
- **Notification fingerprint churn:** fingerprints include `createdAt`, so they change once (see side effect). Making them ignore `createdAt` would change reconciliation semantics, which is left to B6.
