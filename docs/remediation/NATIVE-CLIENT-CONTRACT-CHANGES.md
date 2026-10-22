# TracePoint mobile API contract change inventory

- **Baseline (what the native iOS/Android client was built against):** `origin/codex/staging-mobile-api-release-20261007` @ `555f061`
- **Target:** `origin/claude/integration-defects-20261020` @ `97a4710` (31 commits; batches B0–B5, F1–F5, DC)
- **Separate, not in integration:** `origin/claude/fix-b6-notification-delivery` @ `1966f13`. It is based on integration @ `0496b14`, so it lacks F3, F5 and DC.
- **Method:** read-only `git diff`/`git show` of every route under `src/app/api/mobile/**` and `src/app/api/auth/mobile/**`, the routes they re-export, the libraries those routes call, `docs/remediation/*.md` and the table schemas in `supabase/migrations` and `database/aws`. Every claim below comes from the code diff. Where a remediation doc says something the code does not, this report says so.

> **Compatibility cannot be verified.** The native client's source is not in this repository, and no client build was available. Everything below describes what the **server** now does. Whether the client tolerates each change is an open question until the owner provides what §5 lists.

---

## 0. Route map (mobile path → implementation) and whether it changed

| Mobile route | Methods | Implementation | Route code changed? | Library / DB changes that affect it |
|---|---|---|---|---|
| `/api/auth/mobile/logout` | POST | own file | No | None |
| `/api/mobile/session` | POST | own file | No | B1: deactivation now revokes sessions (behaviour only) |
| `/api/mobile/inbox` | GET | own file | No | Row content (F3 alert kind; B6 if merged) |
| `/api/mobile/qr/resolve` | POST | own file | **Yes** (B5, F4, F5) | `mobile-workflows.ts`, `qr-identifiers.ts`, `fleet-server.ts`, DB 045 |
| `/api/mobile/range-workspace` | GET, PUT | own file | **Yes** (B3) | `range/workspace-mutation.ts`, DB 042 |
| `/api/mobile/range-days` | GET | own file | No | Data only (B3 packet-Ready rule) |
| `/api/mobile/range-days/[rangeDayId]` | GET | own file | No | Data only |
| `/api/mobile/drill-documents/[documentId]/view` | GET | own file | No | None |
| `/api/mobile/attachments/[attachmentId]/download` | GET | re-exports `/api/attachments/[attachmentId]/download` | No | None |
| `/api/mobile/fleet/vehicles` | GET | re-exports `/api/fleet/vehicles` GET | **Yes** (B4) | DC dates; DB 045 visibility |
| `/api/mobile/fleet/vehicles/[vehicleId]` | GET | re-exports `/api/fleet/vehicles/[vehicleId]` GET | **Yes** (F2, F3) | `read-repository-core.ts`, `fleet-server.ts`; DC dates; DB 046 columns |
| `/api/mobile/fleet/vehicles/[vehicleId]/inspections` | POST | re-exports `/api/fleet/vehicles/[vehicleId]/inspections` POST | **Yes** (B4, F2, F3) | `fleet-server.ts`; DB 040, 043, 045, 046 |
| `/api/mobile/fleet/vehicles/[vehicleId]/inspections/[inspectionId]/evidence` | POST | re-exports `/api/fleet/.../evidence` POST | No | None found (B2 notes inspector evidence upload was never verified) |
| `/api/mobile/equipment/assets` | GET | re-exports `/api/equipment/assets` GET | No | DC dates |
| `/api/mobile/equipment/custody` | GET, POST | re-exports `/api/equipment/custody` | **Yes** (B2, B5) | DB 038, 041 |
| `/api/mobile/readiness/equipment` | GET | re-exports `/api/readiness/equipment` GET | No | DC dates change both values **and** computed statuses (§2) |

Only GET is re-exported for the vehicle detail. The new `PATCH { clearSafetyHold }`, the vehicle PATCH validation and the work-order route are **web only**, and none of them are reachable under `/api/mobile/**`.

---

## 1. Per-route inventory

Codes used below: **[B]** breaking, **[BC]** behaviour-changing, **[A]** additive.

### 1.1 `POST /api/mobile/qr/resolve` (B5, F4, F5)

**Request**
- **[A] Printed label values are accepted.** `tracepoint://vehicle/<id>` and `tracepoint://equipment/<id>` were answered with **400**; now they resolve (`parseTracePointQrValue`).
  - The scheme and kind are case-insensitive, and one trailing `/` is allowed.
  - The id is URL-decoded, then must still match `^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$`.
  - The kind restricts the lookup to that table.
  - There is no `firearm` label kind. `tracepoint://firearm/...` and any `https://` URL still get 400.
- Bare handles are accepted exactly as before: UUID, unit number, VIN, asset number, serial. The input is still trimmed and cut to 2048 characters.

**Response and status codes**
- **[BC] Non-UUID handles:** a unit number, VIN, asset number or serial used to return **500**, because of a uuid cast error. Now it returns **200** with a decision.
- **[BC] New 409:** a handle that matches more than one readable row in one table returns **409** with `{"status":"unknown","message":"This code matches more than one record. Scan the TracePoint label for this item instead."}` and `Cache-Control: no-store`. The body has no `entityId` or `entityType`. Before, this case returned 500.
- **[BC] Vehicle decisions (F5).** Before, every vehicle returned `denied`, because the code required a `"fleet"` feature that does not exist. Now:
  - `allowed:true` with `workflow:"vehicle_inspection"` when the caller is inspection-eligible (`can_submit_fleet_inspection`):
    - `manage_fleet`, `administer_department` or `perform_fleet_inspections`; or
    - a listed `inspection_role_codes` role; or
    - `view_fleet` when no inspection roles are listed.
  - `denied` when the caller can see the vehicle but is not eligible.
  - The native client has probably never received a vehicle `allowed:true` before. That workflow path is likely untested.
- **[BC] Denied versus unknown (F4).** A record the caller may not read now returns the same `unknown` body as a record that does not exist: `{"status":"unknown","message":"This QR code is unknown, inactive, or unavailable."}`. `denied` now means the caller can see the record but may not use its workflow:
  - **Firearm:** readable (`manage_firearms`, `manage_inspections`, `view_command_dashboard`, admin, or the caller holds it) but no custody permission → `denied`. Not readable → `unknown`; before, this was `denied` in bridge mode.
  - **Equipment:** readable means `manage_equipment`, admin, assigned to the caller, or in the active unassigned pool with Equipment Readiness enabled. Equipment held by someone else is now `unknown`; before, it was `allowed` with an id in bridge mode. The `denied` "Equipment Readiness is not enabled" response still exists for readable equipment.
  - **Vehicle:** not readable (no fleet or command permission and not eligible) → `unknown`.
  - In AWS-native mode, RLS already hid these rows. The new pool policy (041) and the eligible-inspector read policy (045) now make *more* rows visible, so some scans move from `unknown` to `allowed`.
- **[BC] New 500 cause.** In AWS-native mode (`TRACEPOINT_DATA_PROVIDER=postgres`), the route calls the RPC `can_submit_fleet_inspection` on **every** scan. If migration 045 is not applied, **every QR scan returns 500** `{"error":"TracePoint could not resolve this QR code."}`. Deployment order matters: 045 must be applied before the image.
- Unchanged: the 200 decision shapes (`{entityType, entityId, displayName?, workflow, allowed:true}` or `{status, message}`), the 400 body, and the 500 body.

**Authorization:** the gate is still any authenticated member. What changed is the decision matrix above.

### 1.2 `GET /api/mobile/range-workspace` (B3)

- **[A]** New top-level `updatedAt`: the stored `pilot_range_workspaces.updated_at`, or `null` when nothing is stored yet.
  - AWS-native sends an ISO `...Z` string.
  - Supabase sends PostgREST's `+00:00` form.
- **[A]** New key `workspace.resultRevisions[]`, the server-maintained, append-only correction history. Each entry is `{id, collection:"results"|"malfunctions", recordId, rangeDayId, replacedById, revisedAt, revisedByUserId, previous:{...}}`.
- Status codes and authorization are unchanged. The gate is still `range_training` or `qualifications`, plus `manage_range_days`, `score_range_days` or `manage_qualifications`.

### 1.3 `PUT /api/mobile/range-workspace` (B3)

**Request**
- **[A] Optional `baseUpdatedAt`.** Send the `updatedAt` from GET or from the previous PUT, or `null` when GET returned `null`.
  - Omitting it keeps the old last-writer-wins behaviour.
  - **Pitfall:** any value that is not a string and not `null` (for example epoch milliseconds) is treated as stale, so every save gets 409.
  - Comparison is by `Date.parse` at millisecond precision. Send the string back exactly as received.
- `resultRevisions` sent by the client is ignored. The server rebuilds it from the stored copy, and `result_revisions` is deleted.

**Response and status codes**
- **[A]** The 200 body is now `{ok:true, updatedAt}`; before, it was `{ok:true}`.
- **[BC] New 409:** `{"error":"This range workspace was changed on another device or by another user after you loaded it. Reload to see the latest version before saving.","code":"stale_workspace"}`. It only happens when `baseUpdatedAt` is sent.
- **[BC] Corrections are accepted (RNG-01, RNG-23).** Previously refused with 409, now accepted:
  - Re-saving a result with a **new id** under the same `rangeDayId + drillId + runNumber + officerId` key.
  - Recreating a malfunction under a corrected result.
- **[BC] Packet Ready no longer locks the day (RNG-03).** Scoring, attendance, status changes and reverting Ready on a packet-Ready day now succeed. This needs DB 042 on AWS-native; without it the DB trigger still refuses.
- Unchanged:
  - Deleting a saved result with no same-key replacement still gets the same 409.
  - Finalized days (Completed, Locked, Archived) are still immutable.
  - The 409 "Scores changed before they could be saved. Reload and try again." (with no `code`) still exists for a lost compare-and-swap.

### 1.4 `GET /api/mobile/range-days` and `GET /api/mobile/range-days/[rangeDayId]`

- No code change. The payload is built from the JSON workspace, not from SQL `date` columns, so the date fix does not touch `date`, `startTime` or `endTime`.
- `packetStatus:"Ready"` days are now editable through the PUT.

### 1.5 `GET /api/mobile/fleet/vehicles` (re-export; B4)

- Response shape `{items, canManage}` is unchanged. The `VEHICLE_SELECT` column list is unchanged.
- **[B on AWS-native] Dates:** `items[].inspection_due_date`, `registration_expiration_date`, `insurance_expiration_date`, `in_service_date`, `last_service_date` and `next_service_date` were `"YYYY-MM-DDT00:00:00.000Z"` and are now `"YYYY-MM-DD"` (see §2).
- **[BC] Visibility (DB 045):** inspection-eligible members, such as a listed-role officer, can now read vehicles on AWS-native. Their list was empty or 404 before; now it has items.
- Side effect only: for fleet managers, the route calls `reconcileFleetAudit` first. Failures are logged and do not change the response.

### 1.6 `GET /api/mobile/fleet/vehicles/[vehicleId]` (re-export; F2, F3)

- **[B for strict decoders] Cost fields removed.** Callers without `manage_fleet`, `manage_fleet_maintenance` or `administer_department` (and not super admin) get:
  - `workOrders[]` **without** `labor_cost`, `parts_cost` and `total_cost`. The columns come from the explicit `FLEET_WORK_ORDER_FIELDS_WITHOUT_COST` list, and `withoutFleetCosts` strips them again.
  - `history[].details` with the same keys removed recursively.
  - This applies to inspectors, `view_fleet`-only viewers, command staff and officers. `vendor` is kept.
- **[A]** New top-level `safetyHold`: `null` or `{since: ISO timestamp, source: "inspection"|"work_order", reason: string}`.
- **[A] (UX-RB2-3, row C34)** New top-level booleans `canInspect` (the inspection POST's eligibility rule, `canSubmitFleetInspection`) and `canReportIssue` (maintenance access, or that rule). They say whether this caller's POST to `…/inspections` or an issue report would be accepted.
- **[A]** `vehicle` is still `select *`. After 046 it gains `safety_hold_cleared_at` (timestamptz), `safety_hold_cleared_by` (uuid) and `safety_hold_clearance_reason` (text).
- **[BC] New 500 cause:** a failed safety-hold read returns `500 {error}`.
- **[B on AWS-native] Dates:**
  - `vehicle.{inspection_due_date, registration_expiration_date, insurance_expiration_date, in_service_date, last_service_date, next_service_date}`
  - `workOrders[].{scheduled_for, due_date}`
  - `equipment[].warranty_expiration_date`
  - `documents[].expiration_date` (managed attachments and `fleet_vehicle_documents`)
  - `documents[].effective_date` (`fleet_vehicle_documents`)
  - `history[].details` is JSONB stored at write time. Old entries keep ISO midnight strings; entries written after the fix hold `YYYY-MM-DD`. Expect both formats.
- Authorization is unchanged in the route. Visibility under RLS widens with 045, as in §1.5.

### 1.7 `POST /api/mobile/fleet/vehicles/[vehicleId]/inspections` (re-export; B4, F2, F3)

**Request**
- **[BC] Blank readings.** `mileage` and `hours` that are blank, `null` or not numeric now mean "not provided": the vehicle's current reading is used. Before, a blank string was stored as **0**.
- Otherwise unchanged: `checklist`, notes and the validation 400s.
- **[BC] Unanswered items refused (UX-RB2-1, row C33).** Every checklist item the server expects (each required item, and each optional item that was sent) must carry `condition` `"Pass"`, `"Defect"` or `"Critical"` (exact case). Otherwise the response is **400** `{error:"Choose Pass, Defect or Critical for: <labels>", code:"inspection_items_not_answered", items:[{id,label}]}` and nothing is saved. Before, a missing or unknown `condition` was saved as **Pass**, or as Defect/Critical inferred from the equipment record's status. A `Defect` on a critical item is still stored as `Critical`.

**Authorization [BC]** (`canSubmitFleetInspection`, mirrored in DB 045)
- Always eligible: super admin, `manage_fleet`, `administer_department`, `perform_fleet_inspections`.
- When `inspection_role_codes` is **empty**: the caller needs `view_fleet`. Before, **every** member was allowed.
- When the list is **non-empty**: the caller needs a listed role. `manage_fleet_rules` alone no longer passes.
- The 403 text is unchanged: "Your agency role or permissions do not allow vehicle inspections."
- Under AWS-native RLS, an ineligible caller may get **404** "Vehicle was not found." before reaching the 403.

**Response 201 `{ok:true, inspection, workOrder, readiness, audit}`**
- **[A]** `audit`: `{"status":"recorded"}`, or `{"status":"pending","message":...}` (queued in outbox 043), or `{"status":"unrecorded","message":...}` (bridge mode, could not be queued). A 201 with `pending` or `unrecorded` still means the inspection was saved.
- **[A]** `readiness` gains `safetyHold`, so it is `{status, openIssueCount, safetyHold}`.
- **[B for strict decoders]** `workOrder` has **no cost fields** for non-maintenance callers (inspectors).
- **[B on AWS-native]** `workOrder.scheduled_for` and `due_date` are `YYYY-MM-DD` (usually null on inspection work orders).

**Failure responses (new) [BC]**
- **Critical defect and a later step failed.** The steps are equipment status, defect work order, vehicle update or readiness refresh.
  - Response: **500** `{ok:false, error, inspection, workOrder, vehicleOutOfService: boolean, audit}`.
  - The inspection **was saved and must not be resubmitted**. `error` says so in plain text.
- **Non-critical, and every step was reversed:** **500** `{error:"The inspection was not saved because ... submit the inspection again."}`. There is no `ok` key. Resubmitting is correct.
- **Non-critical, and not every step could be reversed:** **500** `{ok:false, error:"... Do not submit it again; tell a fleet manager.", inspection?, audit?}`.
- Before, side-effect failures were ignored and the route returned 201, or it returned 500 from an audit failure after the commit.

**DB dependencies:** 040 (inspector write grants), 043 (outbox, trigger), 045 (eligibility), 046 (hold).
- Before 040, an inspector-only user's critical inspection on AWS-native gave 500 with the vehicle left Available.
- After 040/045, the expected result is 201.

### 1.8 `POST /api/mobile/fleet/vehicles/[vehicleId]/inspections/[inspectionId]/evidence` (re-export)

- No code change found.
- The response comes from the unchanged handler.
- B2 lists evidence upload by inspectors as **not verified**. Include it in the staging tests.

### 1.9 `GET /api/mobile/equipment/custody` (re-export; B2, B5)

**Request**
- **[A]** `?identifier=` accepts `tracepoint://equipment/<id>`. The route strips it to the id. Before, this gave 404.
- A `tracepoint://vehicle/...` label is **not** stripped: it is matched as raw text and gets 404.

**Response:** the shape is unchanged.
- `item` contains `{id, manufacturer, model, serial_number, asset_number, lifecycle_status, assigned_location, custody, history[]}`.
- The response carries no SQL `date` columns. The timestamps are timestamptz.

**[BC] AWS-native visibility (041):** an officer can now find pool items (active and unassigned, with Equipment Readiness on). This was 404 before and is now 200. Items held by others are still 404, by design.

### 1.10 `POST /api/mobile/equipment/custody` (re-export; B2)

- The request (`id`, `action`, `condition`, `notes`) and its validation are unchanged.
- **[BC] AWS-native path.** The transfer runs through `operate_equipment_self_custody` (041). Officer check-out and check-in were 404 or 409 before and are now **200**. A damaged or not-serviceable check-in sets `lifecycle_status: "out_of_service"`; this needs 038.
- **[BC] New AWS-native 409 texts** for a lost race:
  - "This equipment was checked out by someone else."
  - "Equipment custody changed before check-in completed."
- **[BC]** A function error returns **500** with the raw DB `error.message`.
- Success body unchanged: `{item:{...,history}, result:"checked-out"|"checked-in"}`.

### 1.11 `GET /api/mobile/equipment/assets` (re-export)

- No code change.
- **[B on AWS-native] Dates:** `items[].issue_date`, `expiration_date`, `last_inspection_date` and `next_inspection_date` are now `YYYY-MM-DD`, from `equipment_assets select *`.

### 1.12 `GET /api/mobile/readiness/equipment` (re-export)

- No route code change. Read the DC note in §2: on baseline AWS-native, this route **did not** return ISO dates.
- The repository maps dates with `nullableString` (`String(value)`). On baseline AWS-native, a `Date` became `"Wed Mar 01 2028 00:00:00 GMT+0000 (Coordinated Universal Time)"`. The evaluator then builds `${value}T00:00:00Z`, which is an invalid date.
- **[B/BC] Effect of the fix:**
  - `rows[].assets[].expirationDate` and `nextInspectionDate` are now `YYYY-MM-DD`.
  - Per-asset day counts, `status`, `statusReason` and every `summary` count can change.
  - Assets with only `issue_date` plus a valid-days rule may have made the baseline throw (`toISOString` on an invalid date), which gives **500**. Those requests now return 200.
  - This is inferred from the code and was **not run**.
- `poolAssets` and `scope` are unchanged.

### 1.13 `GET /api/mobile/inbox`

- No code change, and the shape is unchanged. Every timestamp field is timestamptz: `createdAt` comes from `source_created_at`, plus `lastSeenAt`.
- **[A, content]** A new item `kind:"fleet_audit_pending"` (F3). It is High priority, appears for fleet managers and admins when inspection audit entries are more than 24 hours old, and has `href:"/fleet-management"`. Like every row, it appears only after web `GET /api/notifications` generates it.
- See §3 for B6.

### 1.14 `POST /api/mobile/session` and `POST /api/auth/mobile/logout`

- No code change and no change to the response shape. Neither response contains a date column.
- **[BC] Deactivation (B1, NEW-ADM-E).** Settings → Active=false now globally signs the user out, disables them in Cognito and revokes access and refresh sessions on AWS-native. The member's next mobile call returns **401** `{"error":"Authentication is required."}` or the access-failure body.
- Unchanged and still open (B1 §4): a *pending* invitee who first signs in through the native app is still refused at `/api/mobile/session`. Activation happens only on the web PKCE callback.
- The password minimum is now 14 characters (F1). The mobile API does not enforce it. It only matters if the app has its own password-set screen.

### 1.15 `GET /api/mobile/drill-documents/[documentId]/view` and `GET /api/mobile/attachments/[attachmentId]/download`

- No change.

---

## 2. Global serialization change: the date contract (DC, commit `cec3235`)

**What changed:** `src/lib/database/postgres-type-parsers.ts` returns PostgreSQL `date` (OID 1082) text unchanged.
- **Before:** `pg` built a local-midnight JS `Date`, which serialized as `"YYYY-MM-DDT00:00:00.000Z"`.
- **After:** `"YYYY-MM-DD"`.

**Scope:**
- Applies only when the runtime uses the AWS-native pool (`postgres-pool.ts`, `types: postgresRuntimeTypes`). That is staging and production on AWS-native.
- The Supabase/bridge mode already returned `YYYY-MM-DD`, so nothing changes there.
- `timestamptz` is unchanged.
- JSON stored inside `jsonb` (range workspace, audit `details`) is not re-parsed.

**Every mobile response field backed by a SQL `date` column:**

| Mobile route | Field | Table.column | Schema source |
|---|---|---|---|
| fleet/vehicles (list) | `items[].inspection_due_date` | fleet_vehicles.inspection_due_date | supabase/migrations/202608242100_fleet_v1.sql |
| | `items[].registration_expiration_date` | fleet_vehicles.registration_expiration_date | same |
| | `items[].insurance_expiration_date` | fleet_vehicles.insurance_expiration_date | same |
| | `items[].in_service_date` | fleet_vehicles.in_service_date | same |
| | `items[].last_service_date` | fleet_vehicles.last_service_date | same |
| | `items[].next_service_date` | fleet_vehicles.next_service_date | same |
| fleet/vehicles/{id} | `vehicle.<the six above>` | fleet_vehicles.* | same |
| | `workOrders[].scheduled_for`, `workOrders[].due_date` | fleet_work_orders | same |
| | `equipment[].warranty_expiration_date` | fleet_vehicle_equipment | same |
| | `documents[].effective_date`, `documents[].expiration_date` (legacy docs) | fleet_vehicle_documents | same |
| | `documents[].expiration_date` (managed docs) | attachments.expiration_date | 202610020001_vehicle_document_metadata.sql; database/aws/033 |
| | `history[].details.*` (embedded snapshots) | audit_events.details jsonb | Mixed: old rows ISO, new rows `YYYY-MM-DD` |
| inspections POST (201 and 500 bodies) | `workOrder.scheduled_for`, `workOrder.due_date` | fleet_work_orders | fleet_v1 |
| equipment/assets | `items[].issue_date`, `expiration_date`, `last_inspection_date`, `next_inspection_date` | equipment_assets | 202608190001_equipment_assignment_history.sql |
| readiness/equipment | `rows[].assets[].expirationDate`, `nextInspectionDate` (and derived statuses and counts) | equipment_assets (via evaluator) | same. Baseline value was `Date.toString()` text, not ISO |

**Checked, and carrying no SQL `date` fields:** session, logout, inbox (all timestamptz), qr/resolve, equipment/custody (timestamptz history), range-workspace, range-days, range-days/{id} (JSON), drill-documents, attachments download (redirect), and inspection rows (`inspected_at` is timestamptz).

`fleet_rules` was not exhaustively checked for date columns; none were found by pattern search.

---

## 3. `origin/claude/fix-b6-notification-delivery` (not in integration)

- **No `/api/mobile/**` route or response shape changes.** The changed routes are web or job routes: `/api/notifications`, `/api/notifications/generate` (new, secret-only), `/api/notifications/email-dispatch` and the off-duty routes. The proxy allow-list is unchanged for `/api/mobile/`.
- **Effects on `GET /api/mobile/inbox` content [BC, content only]:**
  1. Once an invoker is authorized, scheduled generation creates rows for members who never open the web app. The mobile inbox then shows items it previously never had.
  2. The TRN-10 fingerprint (v2) stops daily resets. Snoozed items stay snoozed, so they are hidden from the inbox longer.
  3. TRN-19: re-notified off-duty events reset `acknowledged_at` and `snoozed_until`, so they reappear in the inbox. Cross-user rows still fail under RLS on AWS-native.
  4. TRN-35: `in_app_enabled=false` no longer suppresses alerts.
- B6's `calendarDate` normaliser is harmless alongside DC. B6 was branched before F3, F5 and DC, so merging it needs its own conflict check (`notifications/route.ts` was rewritten).

---

## 4. Client compatibility checklist

"S#" refers to `docs/remediation/STAGING-VERIFICATION.md` §4 on the integration branch. Steps marked **(new)** are proposed here and are not in that document.

| # | Change | Severity | What the native client must do | Staging test |
|---|---|---|---|---|
| C1 | SQL `date` fields become `YYYY-MM-DD` on AWS-native (§2 table) | **Breaking** if the decoder requires an ISO datetime | Parse `YYYY-MM-DD` as a calendar date in local or agency time. Do not shift time zones. Tolerate both formats inside `history[].details`. | **S17** (native part: equipment expiry, vehicle inspection due date), plus vehicle list and detail screens. Stop the deploy if the app fails to parse. |
| C2 | readiness/equipment dates, statuses and counts change; some 500s become 200 | Breaking / behaviour-changing | Same date parsing as C1. Do not cache the old statuses. Expect different badges. | **S17** (new sub-step: compare the readiness screen before and after for a synthetic asset that has `expiration_date` and one that has only `issue_date`) |
| C3 | QR printed labels accepted | Additive | If the app strips `tracepoint://kind/`, that keeps working. Posting the raw label now also works. | **S4** (vehicle and equipment labels) |
| C4 | QR unit, VIN, asset and serial: 500 → 200 | Behaviour-changing | Handle real decisions where it used to see errors. | **S4** (unit number, serial) |
| C5 | QR **409** ambiguous, body `{status:"unknown", message}` | Behaviour-changing (new status code) | On 409, open **no** item or workflow. Show `message`. Do not retry with a guess or reuse a cached resolution. | **S4** (duplicated serial: 409, no item opened) |
| C6 | QR denied versus unknown realignment | Behaviour-changing | Navigate only on `allowed:true` with `entityType` and `entityId`. For `unknown` and `denied`, show `message` only. | **S4** (firearm without read: identical to `NOPE-1`; held firearm: `denied`) and **S10** |
| C7 | QR vehicle `allowed:true` now returned (was always `denied`) | Behaviour-changing | The `vehicle_inspection` workflow launched from a scan is probably untested in the app. Verify that it opens the inspection for `entityId`. | **S4** (a) inspector, (b) role-only eligible user: allowed; (c) `view_fleet` user not listed: denied |
| C8 | QR 500 on every scan if 045 is not applied (AWS-native) | Deployment risk | Show the `error` text on 500. Operations must apply 045 before the image. | Pre-flight / §2 migration order; **S4** after deploy |
| C9 | range-workspace GET `updatedAt` and `workspace.resultRevisions` | Additive | Ignore unknown keys. Do not fail on a large `resultRevisions` array. Round-tripping or dropping it is safe, because the server re-attaches it. | **S5** (native: app loads the workspace with `resultRevisions` present) |
| C10 | range-workspace PUT `baseUpdatedAt` / 409 `stale_workspace` / `updatedAt` in the 200 | Additive (opt-in) / behaviour-changing | Recommended: send `baseUpdatedAt` as the exact string from GET or the last PUT, or `null`. Never send a number. On 409 with `code:"stale_workspace"`, reload and do not auto-retry. Update the base from each 200 `updatedAt`. Without it, last-writer-wins remains. | **S5** (stale save from a second device: 409 with a reload prompt) |
| C11 | Corrections with regenerated ids accepted; packet Ready no longer locks | Behaviour-changing (409 → 200) | None required. Saves that used to fail now succeed. Check that the app does not depend on the old 409. | **S5** (correct a score; score after Ready) |
| C12 | Vehicle detail and inspection `workOrder` cost fields removed for non-cost roles | **Breaking** for strict decoders | Make `labor_cost`, `parts_cost` and `total_cost` optional or absent-tolerant in work orders and history details. | **S15** (inspector versus manager on the mobile vehicle view and in the inspection response) |
| C13 | Vehicle detail `safetyHold`; new `vehicle.safety_hold_*` keys | Additive | Tolerate unknown keys. Optionally show the hold `reason`. | **S12** (native view of the held vehicle) |
| C14 | Inspection 201 `audit {status, message?}`; `readiness.safetyHold` | Additive | Treat 201 as saved. Optionally show `audit.message` when the status is `pending` or `unrecorded`. | **S2** (`audit.status` recorded), **S11** (pending) |
| C15 | Inspection 500 bodies: `ok:false` with `inspection` means saved, do not resubmit | Behaviour-changing | On 500, always show `error`. If the body has `ok:false` (or has `inspection`), mark it submitted and **disable resubmit or offline retry**. A 500 without `ok` means not saved, and resubmitting is correct. | **(new) S2b:** staging fault drill (as in S11) that makes the work-order insert fail on a Critical inspection. The app shows the text and does not resubmit. |
| C16 | Inspection eligibility rule (empty role list needs `view_fleet`; `manage_fleet_rules` alone refused; role-code inspectors allowed) | Behaviour-changing (who gets 201, 403 or 404) | Show the 403 or 404 `error`. Do not assume that seeing the vehicle means the user may inspect it; use the QR decision. | **S16** (inspection part), **S2**, plus F2 staging steps 2–4 |
| C17 | Inspection blank `mileage` and `hours` mean "not provided" | Behaviour-changing | Send `null` or omit the field when not entered. Do not send 0 as a placeholder. | **(new)** submit with the mileage blank: the vehicle odometer is unchanged |
| C18 | Custody GET accepts an equipment label | Additive | None. | **S4** (equipment label), **S3** |
| C19 | Custody on AWS-native: officer pool check-out and check-in work; new 409 texts; damaged → `out_of_service`; DB error text on 500 | Behaviour-changing | Show the `error` on 409 and 500. Refresh the item after a 409 race. | **S3** |
| C20 | Fleet list and detail visibility for eligible inspectors (045) | Behaviour-changing | Handle a list that was empty before. | **S16** / F2 staging step 2 |
| C21 | Deactivation revokes mobile sessions | Behaviour-changing | On 401, return to sign-in. Do not loop refreshing. | **(new)** B1 staging step 4 (NEW-ADM-E) with a native session open |
| C22 | Inbox `fleet_audit_pending` kind; with B6, more and longer-lived items | Additive (content) | Tolerate unknown `kind` values. Use `href` as given. | **S11** follow-on (F3 step 8: manager inbox in the app); B6: **S6** after its infrastructure is authorized |
| C23 | Pending invitee first sign-in on mobile still refused (unchanged) | No change (known gap) | Tell the user to complete their first sign-in on the web. | **S1** (do the first sign-in on the web, then the app) |
| C24 | Unchanged routes: logout, session shape, drill documents, attachments, range-days, evidence | None | None. | **S10**; add an evidence upload as an inspector-only user **(new)** |
| C25 | Range workspace PUT returns **400** with a message for a new or changed result with an impossible score, time or hit count (B10; numeric strings still accepted) | Behaviour-changing | Show the `error` text; do not retry the same payload. | **S21** (impossible score from the app) |
| C26 | Scorer-only devices may mark attendance and add present walk-ups on open days; before, 403 (B10) | Additive (permission) | Enable those controls for instructors, or leave them hidden. | **S21** from the app as an Instructor |
| C27 | Optional result field `firearmTypeSnapshot` (B10). Qualification statuses shown to the app change (closed days only; "Any" drills count; same-day re-shoot) | Additive / behaviour-changing | Ignoring the field is safe; send it if the app wants "Any" drills attributed to the firearm used. Do not cache old statuses. | **S21**, S5 |
| C28 | Armory web routes (B8): archive of an issued firearm without a not-returned reason 400 (was 409); Retired while issued 409; invalid inspection payload, empty caliber, count variance without reason, foreign lot 400; stale count 409; off-duty self-decision, rifle self-review and self-certify 403. No `/api/mobile/**` route changed | Behaviour-changing (web routes only) | Only relevant if the app calls these web routes directly: show the `error` text. | **S22** |
| C29 | Admin web routes (B11): invite of an existing member 409 (was 500, or 200 with an overwrite in bridge mode), known Cognito invite refusals 409/403/400; admin 500 responses carry fixed text; `/api/settings/data` accepts a new `save_department_member` command (existing commands unchanged); training event report CSV prefixes `'` on formula-like cells. No `/api/mobile/**` route changed | Behaviour-changing (web routes only) | Only relevant if the app calls these web routes directly. | **S23** |
| C30 | ADM-07: the admin password-reset 409 text now names the remedy (Send Activation before first sign-in, Assign Password after). Assign Password no longer sets `email_verified`. No `/api/mobile/**` route changed | Message text only | Show the `error` text. | **S23-3 (revised)** |
| C31 | **DC2: every database timestamp in `/api/mobile/**` responses changes from `…T…:…:….mmmZ` to the PostgREST form `…T…:…:…[.f0–6]+00:00`** (whole seconds have no fraction); intervals become text. Server-generated times (`generatedAt`) keep `…Z`. `baseUpdatedAt` is accepted in both forms. Per-route field list: DC2 record, "Native client contract" | **Breaking for a strict parser** | Parse ISO-8601 with an optional 0–6 digit fraction and a numeric offset. A strict formatter (for example one fixed to 3 fractional digits and `Z`) fails. | **S24** steps 3–5 |
| C32 | B8a armory web routes: names resolve where "Unknown User" was shown (members added through the lookup have `email: ""`); inspection managers get 200 instead of 404 on off-duty inspections; rifle rows on AWS gain `workflow_note` (always null). No `/api/mobile/**` route changed | Additive (web routes only) | Tolerate the extra key. | **S22a** |
| C33 | **UX-RB2-1: vehicle inspection items without an explicit `condition` are refused with 400 `inspection_items_not_answered`** (`items` lists `{id,label}`); before they were saved as Pass, or inferred from the equipment status. Applies to `/api/mobile/fleet/vehicles/[vehicleId]/inspections` (re-export) | **Breaking** for a client that omits `condition` for untouched items or relies on the server's equipment-status inference | Send `condition` for every item, chosen by the inspector (or a conscious "mark remaining Pass"); never default to Pass. On 400 with this `code`, keep the form open and highlight `items`; do not resubmit the same payload or queue it for offline retry. | **S27-N (new):** from the app, submit with one item untouched: 400 shown, no inspection in the vehicle history, vehicle status unchanged; then answer it: 201 |
| C34 | **UX-RB2-3: vehicle detail gains `canInspect` and `canReportIssue`** (`/api/mobile/fleet/vehicles/[vehicleId]`, re-export) | Additive | Tolerate the keys. Recommended: hide or disable Inspect and Report Issue when the value is `false`, instead of letting the user fill the form and receive 403. Treat a missing key as unknown (older server). | **S27-R (new):** as a `view_fleet` user whose role is not in the inspection roles, open a vehicle: no Inspect or Report Issue; as a listed role: both shown and accepted |

**Regression tests for every route:** run **S10** (tenant-negative). Every cross-tenant attempt must still be denied or return `unknown`.

---

## 5. What the owner must provide to verify compatibility

The client cannot be checked from this repository. Provide **either** A **or** B:

**A. Client source access.** Read access to the native iOS and Android repositories at the commit or tag built against `555f061`. The review will cover:
- the DTOs and decoders for every route in §0;
- the date parsing code;
- QR result handling (HTTP 409, `unknown`/`denied`);
- the range-workspace save and conflict handling;
- the inspection submit, retry and offline queue;
- the custody error handling.

**B. A runnable client build plus a staging test setup:**
1. Installable iOS (TestFlight or ad hoc) and Android (APK or internal track) builds pointed at staging, built from the `555f061` contract.
2. Synthetic test accounts on staging (`acceptance-<UUID>` tenants) for each role:
   - inspector-only (`perform_fleet_inspections`);
   - officer eligible only through a configured inspection role;
   - `view_fleet` viewer not in the configured roles;
   - fleet manager;
   - mechanic;
   - plain officer with Equipment Readiness enabled (custody pool);
   - officer holding a firearm;
   - officer with no firearm read;
   - range instructor or scorer;
   - a second agency's user (for S10);
   - one pending invitee.
3. Seed data:
   - printed vehicle and equipment labels;
   - two equipment assets sharing a serial;
   - a vehicle with date fields set;
   - equipment with `expiration_date`, and one with only `issue_date`;
   - a range day with saved scores.
4. A staging environment with migrations 038–046 and the integration image deployed (STAGING-VERIFICATION §2–3), a way to run the S11 fault drill, and permission to capture HTTP traffic or app logs.

---

## 6. Doc-versus-code notes (verified)

- B5's "the HTTP codes are unchanged" is true only for absent records. The code adds a 409 for ambiguous matches, and 500 → 200 for non-UUID handles.
- F4 says "the response shapes and messages are unchanged". That matches the code. However, the decision for a given record changes (`denied`/`allowed` → `unknown` for unreadable records in bridge mode).
- The F2 cost rule matches the code: `canViewFleetCosts` calls `canPerformFleetMaintenance`, which ignores `rules` and checks `canManageFleet` or `manage_fleet_maintenance`. Mechanic access through a role code does not reveal costs; only the permission does.
- DC says "`/api/mobile/*` date fields change from ISO midnight to `YYYY-MM-DD`". For `readiness/equipment` the baseline was **not** ISO: it was `Date.toString()` text, which broke the evaluator (§1.12).
- B3 says the native client keeps last-writer-wins without `baseUpdatedAt`. That is correct. But a non-string, non-null `baseUpdatedAt` always conflicts. This is not stated in the doc.
