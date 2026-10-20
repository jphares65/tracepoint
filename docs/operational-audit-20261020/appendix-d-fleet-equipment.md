# TracePoint Audit: Fleet Management and Equipment Accountability

**Scope:** `src/app/fleet-management` (+ `[vehicleId]`), `src/app/settings/fleet`, `src/app/api/fleet/**`, `src/lib/fleet`, `src/lib/tracepoint/fleet-server.ts`, `src/lib/tracepoint/fleet-notifications.ts`, `src/app/equipment/page.tsx`, `src/app/api/equipment/**`, `src/app/api/readiness/equipment`, `src/lib/equipment`, `src/lib/tracepoint/equipment-readiness.ts`, `src/app/inspections`, `docs/clean-inspections-workflow.md`, `src/app/components/TracePointQrLabel.tsx`, `src/lib/tracepoint/qr-identifiers.ts`, and the related migrations (`202608242100_fleet_v1.sql`, `202608260200_fleet_roles_permissions.sql`, `202608190001/0002_equipment_*`, `20260822202500_equipment_rls_hardening.sql`, `202609020001_equipment_assignment_rls_and_targets.sql`, `202609060002_reconcile_permission_controlled_editing.sql`). I also read `src/app/api/notifications/route.ts` (alert generation) where it consumes fleet and equipment data.

**Method:** This was a static code read only. Nothing was executed at runtime: no dev server, no tests, no database. Every "Confirmed defect" below comes from handler, UI or SQL code that I read. Runtime effects are inferred from that code. Where the outcome also depends on production-only schema or permission data, the finding says so.

---

## 1. Workflow inventory

| Workflow | Route(s) / API | Operational purpose | Primary roles |
|---|---|---|---|
| Fleet inventory list / add / edit vehicle | `/fleet-management`; `GET/POST/PATCH /api/fleet/vehicles` | Vehicle master records: unit, VIN, plate, assignment (free text), mileage, due dates | Fleet manager (`manage_fleet`) |
| Vehicle detail (overview, inspections, maintenance, equipment, documents, history tabs) | `/fleet-management/[vehicleId]`; `GET/PATCH /api/fleet/vehicles/[vehicleId]` | Single-vehicle view; status override with reason | All fleet users; status changes by fleet manager |
| Quick vehicle inspection (pre-shift, post-shift, weekly) | Inspections tab → `QuickInspectionPanel`; `POST /api/fleet/vehicles/[id]/inspections` | Checklist with exceptions only; defects auto-create a work order; updates mileage and next inspection due date | Patrol officer (`perform_fleet_inspections`, or anyone when `inspection_role_codes` is empty) |
| Inspection photo/video evidence | `POST /api/fleet/vehicles/[id]/inspections/[inspectionId]/evidence` (**no UI caller**) | Attach damage photos to an inspection | Inspector, fleet manager |
| Report vehicle issue | "Report Issue" → `FleetWorkOrderDialog` (issue mode); `POST /api/fleet/vehicles/[id]/work-orders` | Officer reports a problem; routed to the mechanic role | Any authenticated department member |
| Maintenance / repair work orders | "Add Maintenance" / "Manage Work Order"; `POST/PATCH .../work-orders` | Mechanic records service, cost, completion and next service targets | Mechanic (`manage_fleet_maintenance`), fleet manager |
| Vehicle equipment (installed/required) | "Add Equipment" → `FleetEquipmentDialog`; `POST .../equipment` (POST only) | Link inventory or create fleet-only checklist equipment (MDT, radar, AED) | Fleet manager |
| Vehicle documents | `window.prompt` chain; `POST .../documents` | Registration, insurance and similar records, stored as URL only | Fleet manager |
| Fleet rules | `/settings/fleet`; `GET/PUT /api/fleet/rules` | Checklist template, automation flags, notification flags, role codes | `manage_fleet_rules` |
| Fleet reports (CSV) | `GET /api/fleet/report` via report definitions | Vehicles, inspections, work orders, equipment export | `view_fleet` / `manage_fleet` |
| Fleet alerts | `GET /api/notifications` → `collectFleetNotifications` | Due-date, status and work-order alerts | Fleet manager, mechanic |
| QR labels (vehicle and equipment) | `TracePointQrLabel` on fleet list rows and equipment detail | Print a 4x3 label encoding `tracepoint://{kind}/{uuid}` | Fleet manager, quartermaster |
| Equipment types and requirements | `/equipment`; `/api/equipment/types`, `/api/equipment/requirements` | Define equipment types (validity and inspection intervals) and required-by-scope rules | Quartermaster (`manage_equipment`) |
| Equipment asset issue / edit / reassign / remove | `/equipment` asset modal; `POST/PATCH /api/equipment/assets` | Issue gear to an officer, vehicle or location; lifecycle active, out_of_service or removed | Quartermaster |
| Self-service custody check-out / check-in | `GET/POST /api/equipment/custody` (**no UI caller in `src/app`**) | Look up by ID, asset number or serial; check out or check in with condition | Officers (intended "mobile custody") |
| Equipment readiness | `/equipment` readiness view; `GET /api/readiness/equipment`; command dashboard | Per-officer required-equipment status: missing, expired, inspection overdue | Officer (self), quartermaster, command |
| Equipment bulk load | `/settings/import-export` → `/api/settings/onboarding/equipment` | Onboarding import (admin only); the closest thing to bulk issue | Department administrator |
| `/inspections` | `src/app/inspections/page.tsx` → `redirect("/firearms/inspections")` | Legacy alias; **firearm** inspections only | Armorer |

---

## 2. Role-based end-to-end assessments

**A. Patrol officer, start-of-shift inspection on a phone, finds body damage (about 9–11 taps, no photo possible).**
1. Log in. 2. Open the nav and go to Assets & Fleet → Fleet Management. This is hidden unless the officer has been granted a fleet permission; the default `officer` role has none. 3. Search the unit number. The list is a `min-w-[1260px]` table, so the officer scrolls sideways on a phone. 4. Tap the row. 5. Tap "Quick Inspect" (or the Inspections tab). The `?tab=` deep link is ignored. 6. Tap "Start Inspection". 7. Mileage is pre-filled with the last known odometer, and the officer can submit without changing it. 8. Tap "Defect" or "Critical" on "Body, windshield and mirrors". The buttons are about 9px text with `px-2 py-1`. 9. Type a note. 10. Submit.

The server writes the inspection, inserts a "High" or "Critical" work order assigned to the first mechanic role code, sets the next inspection due date, and runs `refreshFleetVehicle`. A Critical defect sets the vehicle to Out of Service, but only if no manual status override was ever applied (FLT-01). The defect is not pushed to the fleet manager. It appears only when the manager or mechanic next opens the app and the notifications endpoint runs (FLT-05). The UI cannot attach a photo (FLT-03). The QR label on the vehicle cannot be scanned into the app (FLT-04).

**B. Mileage-based oil change.** The mechanic completes a PM work order and must type the next service mileage and date by hand. The `default_service_miles` and `default_service_days` rules are never applied (FLT-06). A "Service Mileage Reached" alert appears only once current mileage is at or above the target. There is no "due soon by miles". Current mileage is reliable only if every inspection captures a real odometer value. In practice it can be rolled back by issue reports and work-order edits (FLT-02), or zeroed by a blank field (FLT-09).

**C. Vehicle assigned to an officer / pool checkout and return.** There is no workflow for either. `assigned_to` is free text (`fleet_v1.sql`, `assigned_to text`). There is no checkout, return, key or driver log (FLT-12).

**D. Accident or damage report (5 steps).** Report Issue → category "Damage" → title, details and operability → submit. There is no photo, location, other-party, supervisor-review or claim linkage (FLT-13).

**E. Out of service and back in service.** The manager taps the "Out of Service" status button and enters a reason in a `window.prompt`. That sets `status_override_active = true` permanently for the vehicle. Returning it to service is another override, so the automation stays off. When the mechanic completes the last critical work order on a vehicle without an override, the status goes straight back to Available. `require_return_to_service_approval` is never checked (FLT-01, FLT-06).

**F. Quartermaster issues body armor with an expiration date (about 8 actions per item).** Open Equipment → "+ Equipment" → pick a type → pick an officer → enter serial, issue date, expiration and notes in a 15-field modal → Save. The DB trigger opens an `equipment_asset_assignments` row. If the armor type is *required* for that officer, expiry shows in that officer's own notifications. The quartermaster and supervisors are never notified (EQP-02). If the type is not a requirement, no expiry evaluation or alert happens at all (EQP-03).

**G. Academy class of 25 recruits, 5 items each.** There is no bulk issue. That means 125 separate modal submissions of about 8 actions each, roughly 1,000 interactions. The only alternative is the admin-only onboarding CSV import (EQP-07).

**H. Separation, retrieving everything an officer holds.** No single view combines firearms, equipment and vehicle. Once the membership is deactivated, the officer's equipment shows as "Unassigned" in the asset list and vanishes from the per-officer view. Marking that gear lost or out of service fails validation until it is unassigned first (EQP-01, EQP-04, EQP-05).

**I. Lost or damaged equipment.** The only lifecycle values are active, out_of_service and removed. There is no lost or stolen state, incident link or cost recovery. The self-service condition-on-return API exists but has no UI (EQP-06, EQP-08). In a database built from the tracked migrations, `out_of_service` violates the CHECK constraint (EQP-09).

**J. Inventory count or audit.** No function exists: no count session, no scan-to-verify and no reconciliation report (EQP-10).

**K. Command staff.** The command dashboard calls `/api/readiness/equipment`. The API marks `view_command_dashboard` as department scope, but the query runs through the RLS client. RLS only exposes self rows unless the user has `manage_equipment` or `administer_department`, so department readiness quietly collapses to the viewer's own row (EQP-11).

---

## 3. Findings

### FLT-01: Any manual status change permanently disables automatic out-of-service, including for critical inspection defects
- **Classification:** Confirmed defect | **Priority:** Critical | **Module:** Fleet status automation
- **Scenario:** After a repair, the manager sets Unit 3101 back to "Available". A week later an officer marks "Brakes" Critical. The work order is created, but the vehicle stays Available and can be dispatched.
- **Evidence:**
  - `src/app/api/fleet/vehicles/[vehicleId]/route.ts:119-121`: `if (body.status !== undefined) update.status_override_active = true;` and `if (body.clearStatusOverride === true) update.status_override_active = false;`
  - `src/app/api/fleet/vehicles/route.ts:322`: `status_override_active: nextStatus === existing.status ? existing.status_override_active : true`
  - `src/lib/tracepoint/fleet-server.ts:94`: `if (rules.status_automation_enabled !== false && status !== "Retired" && vehicle?.status_override_active !== true) {`
  - grep: `clearStatusOverride` is never sent by any UI. Neither the `[vehicleId]/page.tsx` `updateStatus` nor the list page `updateVehicleStatus` sends it.
- **Correction:** Treat overrides as one-way safety holds only. Allow manual Out of Service or Maintenance, and never let an override suppress automation to a *more restrictive* status. Clear the override automatically when the manager selects "Available" or when the work order that caused it closes. Add a visible "Override active, resume automation" control.
- **Benefit:** Unsafe vehicles cannot be dispatched because of an earlier, unrelated manual edit.
- **Complexity:** S

### FLT-02: Odometer can be rolled back by issue reports and by editing older work orders
- **Classification:** Confirmed defect | **Priority:** High | **Module:** Work orders / mileage
- **Scenario:** A mechanic opens a work order reported three weeks ago at 18,000 mi to close it. The dialog pre-fills `mileage: item.mileage`, and saving sets the vehicle's `current_mileage` back to 18,000 even though the vehicle is now at 19,200. "Service mileage reached" alerts then clear incorrectly.
- **Evidence:**
  - `work-orders/route.ts:11`: `if (body.mileage !== undefined) update.current_mileage = Math.round(numeric(body.mileage));` has no `Math.max` (compare `inspections/route.ts`, which uses `Math.max(mileage, current)`).
  - `:73` and `:120`: `updateVehicleService(...)` is called on both POST (including officer Issues) and PATCH.
  - `FleetWorkOrderDialog.tsx:30`: `mileage: item?.mileage ?? vehicle.current_mileage ?? ""`
  - `:18`: on completion, `last_service_mileage = Math.round(numeric(body.mileage)) || null`, which records the *reported* mileage, not the service mileage.
- **Correction:** Never lower `current_mileage` without an explicit "odometer correction" action with a reason. Use `max(existing, submitted)`. Keep work-order mileage separate from vehicle mileage, and capture "mileage at completion" separately.
- **Benefit:** Reliable mileage-based preventive maintenance and accurate cost-per-mile figures.
- **Complexity:** S

### FLT-03: Inspection photo/video evidence API has no UI, so officers cannot photograph damage
- **Classification:** Confirmed defect | **Priority:** High | **Module:** Vehicle inspection
- **Scenario:** An officer finds a new dent at shift start and cannot attach a photo. The next shift's driver disputes when the damage happened, and there is no evidence.
- **Evidence:**
  - `inspections/[inspectionId]/evidence/route.ts` (full POST handler with upload and audit).
  - grep for `/evidence` in `src/app` finds only qualification components. `QuickInspectionPanel.tsx` *renders* `item.evidence` (lines 575-618) but has no file input.
  - The issue dialog (`FleetWorkOrderDialog.tsx`) has no attachment either.
  - A camera component already exists: `src/app/components/QuickQualificationCamera.tsx:96-97` (`capture="environment"`).
- **Correction:** Add a per-defect "Add photo" control using `capture="environment"`, uploaded after the inspection is created (the API needs the inspection ID). Make a photo mandatory for "Damage" and Critical defects (configurable). Add the same control to Report Issue.
- **Benefit:** Damage attribution between shifts, and evidence for claims and discipline.
- **Complexity:** M

### FLT-04: QR labels encode a custom `tracepoint://` URI that nothing can open, and no in-app scanner exists
- **Classification:** Confirmed defect | **Priority:** High | **Module:** QR labels (fleet and equipment)
- **Scenario:** The fleet manager prints and affixes labels to 80 vehicles. An officer points the phone camera at a label and gets either nothing or an "unsupported link" message. The officer falls back to logging in, navigating, searching the unit and tapping into it.
- **Evidence:**
  - `src/lib/tracepoint/qr-identifiers.ts:6`: `` return `tracepoint://${kind}/${encodeURIComponent(normalizedId)}`; ``
  - `TracePointQrLabel.tsx:166`: the label UI claims "Scan with a mobile device to open this vehicle."
  - `:109`: the printed label says "Vehicle inspection" / "Equipment custody".
  - grep for `tracepoint://`, `BarcodeDetector`, `getUserMedia`, `zxing`, `jsqr` and `html5-qrcode` in `src` finds only the builder and its test. There is no route that parses the URI, and no native app in the repo.
  - `GET /api/equipment/custody?identifier=` matches only a raw id, asset number or serial (`custody/route.ts:58-62`), so the scanned string would not match either.
- **Correction:** Encode an HTTPS deep link, for example `https://<host>/fleet-management/<id>?tab=inspections&start=1` and `https://<host>/equipment/scan/<id>`. Native cameras open these, and login redirects back. Optionally add an in-app scanner using `BarcodeDetector` with a fallback library. Teach the custody lookup to accept the `tracepoint://` form for labels already printed.
- **Benefit:** Scan-to-inspect in about 3 taps instead of about 8; scan-to-checkout for gear.
- **Complexity:** S for the deep link, M for the in-app scanner.

### FLT-05: Alerts are generated only when the recipient opens the app, so critical defects and out-of-service events are not pushed
- **Classification:** Confirmed defect | **Priority:** High | **Module:** Fleet notifications
- **Scenario:** At 06:10 an officer flags a Critical brake defect. The on-call fleet manager receives no email until they personally load TracePoint, which also enqueues their email at that point. `notify_by_email` and `escalation_hours` have no effect.
- **Evidence:**
  - `src/app/api/notifications/route.ts:982`: `collectFleetNotifications(context)` runs inside the GET for the *current* user. Email outbox rows are created in the same per-user reconcile loop (around line 1060 onward).
  - `src/app/api/notifications/email-dispatch/route.ts` only delivers existing outbox rows.
  - No scheduled generator for fleet alerts was found (grep for cron in `src/app/api`).
  - `notify_by_email` and `escalation_hours` appear only in `api/fleet/rules/route.ts` and `FleetRulesPanel.tsx`.
- **Correction:** Generate fleet events on write. When an inspection or work order produces a Critical item or an out-of-service transition, enqueue notifications to every holder of the manager or mechanic role. Add a scheduled sweep for due dates and escalation.
- **Benefit:** Fleet staff learn about unsafe vehicles in minutes, not whenever they next log in.
- **Complexity:** M

### FLT-06: Several fleet rule settings are configurable in the UI but never enforced
- **Classification:** Confirmed defect | **Priority:** High | **Module:** Fleet rules
- **Scenario:** An agency enables "Require return-to-service approval" and "Default service miles = 5,000" and believes vehicles cannot return to service without approval and that PM is auto-scheduled. Neither happens.
- **Evidence:** grep shows these keys are used only in `api/fleet/rules/route.ts` and `FleetRulesPanel.tsx` (lines 216-273): `require_return_to_service_approval`, `default_service_miles`, `default_service_hours`, `default_service_days`, `inspection_warning_days`, `warranty_warning_days`, `registration_warning_days`, `escalation_hours`, `notify_by_email`. In addition, `fleet_manager_role_codes` is ignored for permissions: `fleet-server.ts:30-31` contains `export function canManageFleet(context: any, rules?: unknown) { void rules;`. It *is* honored in `fleet-notifications.ts:22-29`.
- **Correction:** Implement them or remove them. Priorities: (a) return-to-service approval as a work-order state that keeps the vehicle out of service until a manager approves; (b) auto-compute next service on PM completion; (c) use the separate warning windows; (d) apply role codes consistently, or remove the role-code field and rely on permissions.
- **Benefit:** Settings do what agencies expect, and policies cannot be silently ignored.
- **Complexity:** M

### FLT-07: Each inspection re-creates a new work order for an already-known defect
- **Classification:** Confirmed defect | **Priority:** Medium | **Module:** Inspection → work orders
- **Scenario:** A cracked mirror is reported Monday. Three shifts a day keep marking it as a defect, so by Friday the mechanic has 15 duplicate "Pre-Shift inspection defects" work orders. The open-issue count, alerts and reports are inflated.
- **Evidence:** `inspections/route.ts:241-264`: the code checks `if (defects.length && rules?.inspection_defect_creates_work_order !== false) { ... insert({ record_type: "Inspection", title: \`${record.inspection_type} inspection defects\` ...` without looking up open work orders for the same checklist item.
- **Correction:** Key defects by vehicle and checklist item ID. Append to an existing open work order, adding an "observed again" note, instead of inserting a new one. In the checklist, show "known open defect (WO #)" so the officer can confirm it is unchanged.
- **Benefit:** Clean mechanic queue and accurate defect metrics.
- **Complexity:** M

### FLT-08: Inspection write is non-atomic and silently drops the work order on failure
- **Classification:** Confirmed defect | **Priority:** Medium | **Module:** Inspection API
- **Scenario:** The work-order insert fails (constraint, transient error). The officer sees "Inspection saved. Vehicle remains ready.", which is false, because the Critical defect was never routed.
- **Evidence:**
  - `inspections/route.ts:242`: `const { data } = await context.admin.from("fleet_work_orders").insert(...)`. The error is discarded, and `:264` `workOrder = data` (null).
  - The equipment status updates at `:218-235` ignore errors.
  - The audit call `:285` throws *after* the inspection is committed, which returns a 500 even though the data was saved. The officer may then resubmit and create a duplicate.
  - The UI message in `QuickInspectionPanel.tsx:263-266` is chosen from `payload.workOrder`.
- **Correction:** Wrap the steps in an RPC or transaction. If the work-order insert fails, fail the request or flag the inspection as "routing failed" and alert. Use an idempotency key from the client to prevent duplicate submissions.
- **Benefit:** No lost safety defects and no duplicate records.
- **Complexity:** M

### FLT-09: Blank mileage is saved as 0: the inspection record shows 0 mi and an issue report sets the vehicle odometer to 0
- **Classification:** Confirmed defect | **Priority:** Medium | **Module:** Inspection and issue input validation
- **Evidence:**
  - `fleet-server.ts:16-18`: `numeric()` returns `Math.max(0, Number(value))`, and `Number("")` is 0, so the fallback is never used.
  - `inspections/route.ts:188`: `numeric(body.mileage, vehicle.current_mileage ?? 0)` stores 0 in the inspection record.
  - `work-orders/route.ts:11`: an officer issue with a cleared mileage field writes `current_mileage = 0`.
  - There is also no upper sanity check. A typo such as 184220 for 18422 becomes the permanent `current_mileage` through `Math.max` at `inspections/route.ts` line ~276.
- **Correction:** Treat empty input as "not provided". Reject decreases, and reject jumps larger than N miles since the last reading without confirmation.
- **Benefit:** Trustworthy odometer history.
- **Complexity:** S

### FLT-10: The default inspection flow invites "pencil-whipping": everything starts as Pass and the odometer is pre-filled
- **Classification:** Verified usability problem | **Priority:** Medium | **Module:** Quick inspection
- **Scenario:** An officer taps Start, then Submit, in 2 seconds without walking around the car. The record is indistinguishable from a real inspection.
- **Evidence:**
  - `QuickInspectionPanel.tsx:112`: `condition: "Pass" as Condition` for all configured items.
  - `:143`: `useState(String(vehicle.current_mileage ?? 0))`
  - `:362-363`: "All {n} items start as Pass… Mark only what changed."
  - `:507`: "Ready for one-tap submission."
- **Correction:** Require a fresh odometer entry (empty field). Optionally require explicit Pass on safety-critical items. Record the elapsed time and device, and flag inspections finished in under N seconds. Agency policy should decide the balance.
- **Benefit:** Defensible inspection records after a crash or claim.
- **Complexity:** S

### FLT-11: The vehicle detail page ignores `?tab=` deep links, so alert links land on Overview
- **Classification:** Confirmed defect | **Priority:** Low | **Module:** Vehicle detail navigation
- **Evidence:**
  - `fleet-notifications.ts:60` builds `href: /fleet-management/${id}?tab=maintenance`, and `:83` builds `?tab=equipment`.
  - `[vehicleId]/page.tsx:40`: `useState<Tab>("overview")`. `searchParams` is only used to build the back link (`:36-38`), so the "back" link becomes `/fleet-management?tab=maintenance`.
- **Correction:** Initialize the tab from `searchParams.get("tab")` and keep inventory filters in a separate parameter.
- **Benefit:** One-tap from an alert to the relevant work order.
- **Complexity:** S

### FLT-12: No vehicle assignment or pool checkout/return; "assigned to" is free text
- **Classification:** Potential gap requiring operational validation | **Priority:** High | **Module:** Fleet assignment
- **Scenario:** A supervisor asks "who drove pool car 3107 last night when the bumper was damaged?" No record exists other than whoever happened to submit an inspection.
- **Evidence:**
  - `fleet_v1.sql`: `assigned_to text` on `fleet_vehicles`.
  - `api/fleet/vehicles/route.ts:166`: `assigned_to: nullableText(body.assignedTo, 200)`.
  - No checkout, checkin or driver-log table or route exists (grep for "checkout" under fleet finds nothing).
  - Equipment already has an atomic custody model (`custody/route.ts:126-139`) that could be mirrored.
- **Correction:** Add `fleet_vehicle_assignments` (user_id, start/end, start/end mileage, condition). Make a pre-shift inspection the check-out event and a post-shift inspection the return event. Link permanent assignments to `department_memberships.user_id`.
- **Benefit:** Damage and fuel accountability, and readiness by driver.
- **Complexity:** M/L

### FLT-13: The accident/damage report is only an "Issue" category, with no accident data, photos or supervisor review
- **Classification:** Potential gap requiring operational validation | **Priority:** Medium | **Module:** Issue reporting
- **Evidence:** `FleetWorkOrderDialog.tsx:92` offers categories `["Mechanical","Safety","Damage",...]`. The record has no fields for date/time of the incident, location, other party, injuries, CAD/report number, supervisor or photos. There is no review state. The "Limited use / needs review" operability option (`:96`) maps to `affectsAvailability = false`, which is the same as "Safe to operate" (`:62`).
- **Correction:** Add a "Vehicle Damage / Collision" record type with required supervisor acknowledgement, photos (FLT-03) and a link to the incident number. Map "Limited use" to the Attention state with a flag.
- **Benefit:** Meets typical agency crash-review policy, and the fleet record matches the incident record.
- **Complexity:** M

### FLT-14: Fleet APIs enforce less than the UI and the RLS policies (no `view_fleet` check; inspections open to all members by default)
- **Classification:** Confirmed defect | **Priority:** Medium | **Module:** Fleet authorization
- **Evidence:**
  - `GET /api/fleet/vehicles` (`route.ts:113-125`) and `GET /api/fleet/vehicles/[id]` (`[vehicleId]/route.ts:13-95`) check only `resolveServerAccess()`. They return VINs, document URLs, work-order costs and `roleCodes`.
  - The RLS policy `fleet_vehicles_select_scoped` requires a fleet permission (`202609060002...sql:152-160`), and the page guard requires it too (`permissions.ts:71`).
  - `inspections/route.ts:71`: `if (permittedRoles.length && !hasInspectionPermission && ...)`. With the default empty `inspection_role_codes`, *any* member, including those without `perform_fleet_inspections`, can create inspections.
  - Issue POST has no permission check, and it also lets non-mechanics write `next_service_*` and `current_mileage` through `updateVehicleService` (`work-orders/route.ts:13-15`, `:73`).
- **Correction:** Require `view_fleet` or a related permission on GET routes. Require `perform_fleet_inspections` on inspection POST. Ignore service-target fields from callers without `manage_fleet_maintenance`.
- **Benefit:** The API matches the documented permission model; least privilege.
- **Complexity:** S

### FLT-15: Patrol officers cannot reach Fleet by default
- **Classification:** Potential gap requiring operational validation | **Priority:** Medium | **Module:** Role defaults
- **Evidence:**
  - `202608260200_fleet_roles_permissions.sql` grants fleet permissions only to `fleet_manager` and `mechanic`.
  - The nav entry (`TracePointShell.tsx:205-215`) and the page guard (`permissions.ts:71`) require a fleet permission. The `officer` role gets none.
- **Correction:** Seed `perform_fleet_inspections` for `officer`, or prompt during fleet onboarding. Give inspection-only users a mobile "My vehicle / Inspect" entry point.
- **Benefit:** Pre-shift inspections work on day one.
- **Complexity:** S

### FLT-16: Fleet inventory and vehicle detail are desktop layouts; tap targets are too small for phones in a parking lot
- **Classification:** Verified usability problem | **Priority:** Medium | **Module:** Mobile UX
- **Evidence:**
  - `fleet-management/page.tsx:841`: `<table className="w-full min-w-[1260px] ...">` with no card layout.
  - `QuickInspectionPanel.tsx:433`: condition buttons `rounded-lg border px-2 py-1 text-[9px]`, well below the 44px touch-target guidance.
  - Status changes and document entry use `window.prompt` (`[vehicleId]/page.tsx` `updateStatus` and `addDocument`).
- **Correction:** Add a mobile card list and a "Find unit" field. Use condition buttons at least 44px high. Replace prompts with modals.
- **Benefit:** Faster, error-free inspections with gloves or in the rain.
- **Complexity:** M

### FLT-17: No offline tolerance or draft persistence for inspections
- **Classification:** Potential gap requiring operational validation | **Priority:** Medium | **Module:** Field reliability
- **Evidence:** No `serviceWorker`, `navigator.onLine` or IndexedDB usage in `src` (grep). The inspection state lives only in React state (`QuickInspectionPanel.tsx:140-149`), so a reload or app switch loses it.
- **Correction:** Save the draft to localStorage per vehicle. Queue submissions while offline with an idempotency key (see FLT-08).
- **Benefit:** Inspections survive poor garage reception.
- **Complexity:** M

### FLT-18: Fleet vehicle equipment cannot be edited or removed; Fleet and Equipment keep separate records of what is in each car
- **Classification:** Confirmed defect | **Priority:** Medium | **Module:** Fleet ↔ Equipment integration
- **Scenario:** A radar unit is moved from 3101 to 3105. The Fleet equipment row cannot be removed or edited (only POST exists). Linking it in Fleet does not set `equipment_assets.assigned_vehicle_id`. The custody API will still let an officer check the same radar out to themselves.
- **Evidence:**
  - `api/fleet/vehicles/[vehicleId]/equipment/route.ts` exports only `POST`.
  - It inserts `linked_equipment_asset_id` (`:148`) without validating that the asset exists or updating the asset.
  - Separately, `equipment_assets.assigned_vehicle_id` exists (`202609020001...sql:57`).
  - `custody/route.ts:122` checks `assigned_vehicle_id`, not Fleet links.
  - The Fleet link picker reads `/api/equipment/assets` (`FleetEquipmentDialog.tsx:158`). For a fleet manager without `manage_equipment`, RLS returns only their own assets, so the picker is effectively empty (`equipment_rls_hardening.sql:36-49`).
- **Correction:** Use one source of truth. Linking in Fleet should set `assigned_vehicle_id` in the same transaction, and Fleet should read vehicle equipment from it. Add PATCH and remove endpoints with a reason. Give fleet managers read access to unassigned and vehicle-assigned assets.
- **Benefit:** No double entry, and each vehicle's equipment list is accurate.
- **Complexity:** M

### FLT-19: The manually editable "Open Issues" count conflicts with the computed value
- **Classification:** Confirmed defect | **Priority:** Low | **Module:** Vehicle form
- **Evidence:**
  - `fleet-management/page.tsx:1050`: `<Field label="Open Issues"><input type="number" ...>`
  - `api/fleet/vehicles/route.ts:185` and `:333` persist `openIssueCount`.
  - `fleet-server.ts:101` overwrites it with the real count on the next refresh. The list PATCH does not call `refreshFleetVehicle`, so the hand-entered value persists until another fleet action occurs.
- **Correction:** Make the field read-only and derived only.
- **Benefit:** The inventory filter "Has Open Issues" can be trusted.
- **Complexity:** S

### FLT-20: Two vehicle PATCH endpoints with different validation and side effects
- **Classification:** Confirmed defect | **Priority:** Low | **Module:** Fleet API
- **Evidence:**
  - `/api/fleet/vehicles` PATCH validates status and VIN, and rolls back on audit failure, but does not refresh readiness.
  - `/api/fleet/vehicles/[id]` PATCH accepts `status` through `nullableText` without validation (`:112-113`). The DB CHECK constraint turns a bad value into a raw 500 error. It changes mileage without a monotonic check (`:114`), and it does refresh readiness.
- **Correction:** Consolidate into one service function.
- **Benefit:** Consistent behavior and audits.
- **Complexity:** S

### FLT-21: Vehicle documents are URL-only, entered through prompts, and cannot be edited or deleted; document expirations are never alerted
- **Classification:** Verified usability problem | **Priority:** Low | **Module:** Vehicle documents
- **Evidence:**
  - `[vehicleId]/page.tsx` `addDocument()` uses 4 sequential `window.prompt` calls.
  - `documents/route.ts` is POST only. It does not check that `vehicleId` exists, and the audit at `:188` is outside a rollback.
  - `fleet-notifications.ts:77` alerts only on vehicle-level `registration_expiration_date`, not on `fleet_vehicle_documents.expiration_date`.
- **Correction:** Add a modal with file upload, reusing the attachment store. Add edit and archive. Include document expirations in alerts.
- **Benefit:** Registration and insurance are tracked in one place.
- **Complexity:** M

### FLT-22: The fleet report fans out per vehicle and silently truncates inspections
- **Classification:** Optional improvement | **Priority:** Low | **Module:** Fleet reports
- **Evidence:**
  - `api/fleet/report/route.ts:206` runs `Promise.all(vehicles.map(... getVehicleDetail ...))`, which is about 7 queries per vehicle including audit history.
  - `read-repository-supabase.ts` `listInspections(...).limit(100)` applies per vehicle, so a yearly inspection report for a daily-inspected car is cut off with no indication.
  - `report-definitions.ts:29` allows `perform_fleet_inspections` for the inspections report, but the endpoint requires `view_fleet` or `manage_fleet` (`route.ts:202`), so the report is listed but returns 403.
- **Correction:** Use dedicated date-bounded report queries, and align the permissions.
- **Complexity:** S

### FLT-23: No "shift inspection compliance" board; inspection-due alerts go only to managers and are vehicle-level
- **Classification:** Potential gap requiring operational validation | **Priority:** Medium | **Module:** Supervisor oversight
- **Evidence:**
  - `inspections/route.ts:267-278` sets `inspection_due_date = now + frequency` per vehicle.
  - `fleet-notifications.ts:66,77` alerts only for `isManager`. With the default daily frequency, every vehicle not driven that day raises a "Critical" overdue alert (`priority: dateValue(date) < now ? "Critical"`). That produces alert fatigue for parked spares, while supervisors get nothing.
- **Correction:** Add a supervisor view of "units on shift today, not inspected". Exempt vehicles that are out of service or not in use from overdue alerts.
- **Complexity:** M

### FLT-24: Fleet code has almost no behavioral tests
- **Classification:** Optional improvement | **Priority:** Medium | **Module:** Tests
- **Evidence:** `src/lib/fleet/*.test.ts` cover only inventory query state and the read repository. Nothing tests the inspection POST, `refreshFleetVehicle`, work-order mileage or override logic, which is where FLT-01, 02, 07, 08 and 09 sit.
- **Correction:** Extract the status and mileage rules into pure functions and unit-test them.
- **Complexity:** S/M

### EQP-01: Equipment held by a separated (inactive) officer shows as "Unassigned"
- **Classification:** Confirmed defect | **Priority:** Critical | **Module:** Equipment accountability / separation
- **Scenario:** An officer resigns and the membership is deactivated. Their vest, radio and TASER still carry `assigned_user_id`, but the asset list shows "Unassigned". The per-officer view drops them. Gear appears to be in stock, and no one recovers it.
- **Evidence:**
  - `equipment/page.tsx:1391`: `{member?.fullName ?? (vehicle ? \`Vehicle ${vehicle.unit_number}\` : asset.assigned_location ?? "Unassigned")}`. `memberMap` is built from active members only (`read-repository-supabase.ts:45-48`, `.eq("is_active", true)`).
  - `officer-assignments.ts:17`: `if (!userId || asset.lifecycle_status === "removed" || !activeMemberIds.has(userId)) continue;`
  - The same pattern applies to equipment on a Retired vehicle, because the vehicles list excludes Retired (`assets/route.ts:42`).
- **Correction:** Load inactive holders' profile names and show "Former member: Name (separated mm/dd)" with a red flag. Add an "Outstanding equipment held by inactive personnel" filter and summary tile.
- **Benefit:** Prevents loss of high-value, sensitive gear at separation.
- **Complexity:** S

### EQP-02: Department-level equipment alerts are never generated; only the holder sees their own expiry alerts
- **Classification:** Confirmed defect | **Priority:** High | **Module:** Equipment notifications
- **Scenario:** Thirty vests expire next month. Each officer sees an alert if they open the app. The quartermaster and sergeants receive none.
- **Evidence:**
  - `notifications/route.ts:663-665`: `const departmentScope = text(payload?.scope) === "department" && context.canViewDepartmentReadiness;` is computed and never used.
  - `:682`: `if (userId !== context.user.id) continue;`
- **Correction:** For users with department scope, generate aggregated alerts such as "12 body armor expiring within 30 days" that link to a filtered list, plus per-item alerts for out-of-service and expired required gear.
- **Benefit:** The quartermaster can order replacements before officers go out of compliance.
- **Complexity:** S

### EQP-03: Expiration and inspection tracking only runs for "required" equipment types and officer-held gear
- **Classification:** Confirmed defect | **Priority:** High | **Module:** Equipment readiness
- **Scenario:**
  - Body armor issued to a detective (requirement scoped to Patrol) expires, and nothing is evaluated.
  - AED pads in a vehicle, or a spare-pool TASER, expire with no alert.
- **Evidence:**
  - `equipment-readiness.ts` (around lines 457-475) filters `requirements.filter(r => r.isActive && r.isRequired)` and iterates `for (const member of members)`, so assets are evaluated only through member × requirement.
  - Vehicle-, location- and pool-assigned assets are never evaluated.
  - `/api/readiness/equipment?scope=operational` returns only pool assets that are *already* out of service (`route.ts:24-30`).
- **Correction:** Evaluate expiration and inspection per **asset**, regardless of requirement, and feed asset-level due/expired lists to the quartermaster. Keep requirement-based readiness as a separate layer.
- **Benefit:** Life-safety gear (armor, AED, tourniquets) never silently expires.
- **Complexity:** M

### EQP-04: Gear held by an inactive officer or a retired vehicle cannot be marked out of service or lost without first unassigning it
- **Classification:** Confirmed defect | **Priority:** High | **Module:** Equipment edit
- **Scenario:** The quartermaster tries to mark a separated officer's radio "Out of service – not returned". The request fails with "Assigned officer must be an active department member."
- **Evidence:**
  - `assets/route.ts:256-258`: PATCH keeps `existing.assigned_user_id` when it is not supplied.
  - `:268-271`: it then rejects when that member is inactive. `updateAssetStatus` (`equipment/page.tsx` ~981-1013) sends only `{id, lifecycleStatus}`.
  - The vehicle path behaves the same way (`:274-278`, `.neq("status","Retired")`).
  - The DB trigger `validate_equipment_asset_assignment` (`202609020001...sql:104-135`) fires `before update of ... assigned_user_id`. That column is always in the SET list, so the trigger rejects the update as well.
  - In the edit modal, an inactive holder has no matching `<option>`, so the select *displays* "Unassigned" while still submitting the old ID.
- **Correction:** Validate membership only when the assignment *changes*. Add explicit "Recover from separated member" and "Mark not returned / lost" actions.
- **Benefit:** Unreturned property can be recorded at separation.
- **Complexity:** S

### EQP-05: No consolidated "everything this officer holds" view across firearms, equipment and vehicles, and no separation clearance
- **Classification:** Potential gap requiring operational validation | **Priority:** High | **Module:** Cross-module accountability
- **Evidence:**
  - There is no personnel profile route in `src/app` (directory listing).
  - Equipment, firearms and fleet each have separate pages.
  - Fleet assignment is free text (FLT-12), so it cannot be joined to a person.
  - The deactivation path found (`api/settings/onboarding/personnel/route.ts:179-180`) sets `is_active`/`deactivated_at` without checking outstanding property.
- **Correction:** Add an officer property sheet (firearms + equipment + vehicle + keys/cards) with a printable separation checklist. Warn or block deactivation while property is outstanding.
- **Benefit:** One-stop clearance for HR and property, and audit defensibility.
- **Complexity:** M

### EQP-06: The self-service custody API (check-out/check-in with condition) has no user interface
- **Classification:** Confirmed defect | **Priority:** Medium | **Module:** Equipment custody
- **Evidence:** `src/app/api/equipment/custody/route.ts` is fully implemented, but grep for `equipment/custody` in `src/app` finds nothing. Its only reference is `src/lib/equipment/mobile-custody-route.test.ts`, which regex-matches the source text and does not test behavior.
- **Correction:** Build the mobile custody page, reached by HTTPS QR (FLT-04): scan → see item → check out or return with a condition. Alternatively, delete the dead route.
- **Benefit:** Shift-pool radios, PBTs and cameras get real chain of custody.
- **Complexity:** M

### EQP-07: No bulk issue (academy class, new deployment)
- **Classification:** Verified usability problem | **Priority:** Medium | **Module:** Equipment issue
- **Evidence:** The asset form is a single-item modal (`equipment/page.tsx` ~2260-2500) with about 15 fields. No "bulk" or multi-select exists (grep). The only batch path is the admin-only onboarding import (`/settings/import-export` → `/api/settings/onboarding/equipment`).
- **Correction:** Add a "Kit issue" flow. Pick recruits, pick a kit template (vest + radio + TASER + BWC), then scan or enter serials in sequence. Default the issue date to today and compute expiration from the type's `default_valid_days`.
- **Benefit:** About 125 modal submissions become 1 guided session.
- **Complexity:** M

### EQP-08: No lost, stolen or damaged workflow, and no condition capture when the quartermaster reassigns
- **Classification:** Potential gap requiring operational validation | **Priority:** Medium | **Module:** Equipment lifecycle
- **Evidence:**
  - `assets/route.ts:15-19`: `VALID_LIFECYCLE = new Set(["active","out_of_service","removed"])`. There is no lost or stolen state, report number or cost-recovery field.
  - A direct reassignment from A to B writes a generic `'Equipment reassigned'` return note (`equipment_assignment_sync.sql:73-77`). There is no condition, signature or acknowledgement.
- **Correction:** Add lost and stolen states with a required incident number and supervisor review. Capture condition on every return. Add an officer acknowledgement of issued items.
- **Complexity:** M

### EQP-09: The tracked schema's lifecycle CHECK rejects `out_of_service`, which the API, custody check-in and readiness all use
- **Classification:** Confirmed defect (tracked migrations); production must be validated | **Priority:** High | **Module:** Equipment schema
- **Scenario:** In any environment built from the repository migrations (staging, a new agency, disaster recovery), marking gear out of service or returning damaged gear fails with a CHECK violation.
- **Evidence:**
  - `202608190001_equipment_assignment_history.sql:39-40`: `lifecycle_status text not null default 'active' check (lifecycle_status in ('active', 'maintenance', 'expired', 'removed'))`
  - Code uses `out_of_service`: `assets/route.ts:15-19`, `custody/route.ts:167`, `equipment-readiness.ts:203`, `readiness/equipment/route.ts:30`.
  - No later migration alters this constraint (grep for `lifecycle` in migrations).
  - The migration comment says the table was originally created directly in production, so production may differ. Verify with `\d equipment_assets`.
- **Correction:** Add a migration that aligns the CHECK constraint with the app's values.
- **Complexity:** S

### EQP-10: No inventory count or audit capability
- **Classification:** Potential gap requiring operational validation | **Priority:** Medium | **Module:** Equipment inventory
- **Evidence:** No count, reconcile or verify routes or UI exist under `/api/equipment` or `/equipment` (grep). Compare ammunition, which has `ammunition_reconciliations` tables (seen in the `expand_accountability_audit_coverage.sql` list).
- **Correction:** Add an audit session: expected list (by location, officer or vehicle) → scan or confirm each item → variance report → sign-off.
- **Benefit:** Annual property audits stop being a spreadsheet exercise.
- **Complexity:** L

### EQP-11: Command staff "department" readiness quietly returns only their own data
- **Classification:** Confirmed defect (static analysis; runtime permission data not inspected) | **Priority:** High | **Module:** Equipment readiness / command dashboard
- **Evidence:**
  - `readiness/equipment/route.ts:11` sets `canViewDepartment` for `view_command_dashboard` and `view_analytics`, then queries through `context.db`, the RLS client (`:14`).
  - RLS on `equipment_assets` allows only `assigned_user_id = auth.uid()` or `manage_equipment`/`administer_department` (`equipment_rls_hardening.sql:36-49`).
  - `department_memberships` allows only self or `manage_users`/`manage_equipment`/`administer_department` (`:196-209`).
  - `equipment-server.ts:41-45` has the same mismatch for `/api/equipment/assets`.
  - The command dashboard calls this endpoint (`command-dashboard/page.tsx:329`).
- **Correction:** Either add `view_command_dashboard`/`view_analytics` to the read RLS policies, or run the department read through the admin client after the server-side permission check, as Fleet does.
- **Benefit:** Command sees real agency readiness instead of a misleading single-person view.
- **Complexity:** S

### EQP-12: Equipment asset edits have no reason field, and dates are not validated
- **Classification:** Verified usability problem | **Priority:** Low | **Module:** Equipment edit
- **Evidence:**
  - `assets/route.ts:172-180` and `:343-361`: dates pass through `nullableText` (no format or ordering check, so an expiration before the issue date is accepted). A bad string surfaces as a raw DB error.
  - Unlike Fleet (which requires `reason`), expiration and lifecycle edits do not capture why. The DB audit trigger records values only (`expand_accountability_audit_coverage.sql`).
  - Custody actions use the service-role client (`custody/route.ts:126`), so the trigger's actor attribution may be null. This was not verified at runtime.
- **Correction:** Validate ISO dates and expiration after issue. Require a reason for expiration, lifecycle or assignment changes.
- **Complexity:** S

### EQP-13: The equipment list is a desktop table and officers have no mobile "My gear" view
- **Classification:** Verified usability problem | **Priority:** Low | **Module:** Equipment UX
- **Evidence:** `equipment/page.tsx:1341`: `<table className="w-full min-w-[1050px] ...">`. The page is 2,536 lines and mixes manager and officer concerns.
- **Correction:** Add a mobile card view of "My equipment" with due dates and a "report problem" action.
- **Complexity:** M

### EQP-14: No equipment inspection recording (for example, the monthly TASER spark test or quarterly armor check)
- **Classification:** Potential gap requiring operational validation | **Priority:** Medium | **Module:** Equipment inspections
- **Evidence:** Types support `inspection_required` and intervals, but the only way to record an inspection is to hand-edit `last_inspection_date`/`next_inspection_date` in the asset modal. There is no inspection API under `/api/equipment` and no history of results.
- **Correction:** Add a "Record inspection" action with pass/fail, notes and photo that auto-advances the next date from the interval.
- **Complexity:** M

### EQP-15: Equipment readiness logic and custody behavior lack behavioral tests
- **Classification:** Optional improvement | **Priority:** Low | **Module:** Tests
- **Evidence:** No test imports `equipment-readiness.ts`. `mobile-custody-route.test.ts` and part of `officer-assignments.test.ts` use `readFile` plus regex on source code and migrations, so they pass even if behavior breaks.
- **Correction:** Add unit tests for `evaluateAsset` (expiry, inspection, scopes) and an integration test for custody against Postgres (the repo already has a postgres-rehearsal Dockerfile).
- **Complexity:** S/M

### GEN-01: The `/inspections` alias goes to firearm inspections; stale doc and backup files sit inside `src/app`
- **Classification:** Optional improvement | **Priority:** Low | **Module:** Navigation / hygiene
- **Evidence:**
  - `src/app/inspections/page.tsx`: `redirect("/firearms/inspections")`. It is not a generic or fleet page and does not duplicate fleet inspections. It is an alias for firearm inspections, which are gated by `manage_inspections`/`manage_firearms`, so a patrol officer typing `/inspections` hoping to inspect a car lands on an unauthorized page.
  - `docs/clean-inspections-workflow.md` describes copying a file and updating a link that no longer applies.
  - `src/app/firearms/inspections/*.backup-2026071*` and `src/app/page.tsx.backup-*` are committed in the app tree.
- **Correction:** Either remove `/inspections` or make it a chooser (Vehicle / Firearm / Equipment) based on permissions. Delete the stale doc and the backup files.
- **Complexity:** S

---

## 4. Cross-module integration gaps and terminology inconsistencies

**Integration gaps**
1. **Two models of "equipment in a vehicle".** Fleet has `fleet_vehicle_equipment.linked_equipment_asset_id`; Equipment has `equipment_assets.assigned_vehicle_id`. They are never synchronized (FLT-18). Equipment uses a uniqueness index for links, but custody checks only `assigned_vehicle_id`.
2. **People ↔ vehicles.** `fleet_vehicles.assigned_to` is free text, while equipment and firearms use `user_id`. No join is possible for "what does Officer X hold", whether at separation, on a readiness dashboard or in a property audit (EQP-05, FLT-12).
3. **Fleet inspection ↔ equipment readiness.** A vehicle inspection can mark linked equipment "Out of Service" on the Fleet row (`inspections/route.ts:218-235`), but it does not change `equipment_assets.lifecycle_status`. The quartermaster's inventory still shows the item as Active.
4. **Notifications.** Fleet alerts honor the configured role codes (`fleet-notifications.ts:22-29`), but Fleet API permissions ignore them (`fleet-server.ts:30-31`). Equipment alerts are self-only (EQP-02). Neither module pushes events on write (FLT-05).
5. **Permission model drift.** For each module, the UI page guard, the API checks and the RLS policies differ: Fleet API < RLS (FLT-14), Equipment RLS < API (EQP-11), and reports differ from their endpoints (FLT-22).
6. **QR identity.** Labels encode `tracepoint://` IDs that nothing in the stack resolves, and the custody lookup expects raw IDs or serials instead (FLT-04).
7. **Separation / deactivation.** Membership deactivation does not consult equipment, fleet or firearms holdings. After deactivation, the equipment UI hides the holder (EQP-01, EQP-04).

**Terminology inconsistencies**
- **Status vocabularies:** Fleet vehicles use `Available / Attention / Maintenance / Out of Service / Retired`. Fleet equipment uses `Current / Attention / Missing / Out of Service / Removed`. Equipment assets use `active / out_of_service / removed` (lower snake case; the DB CHECK in the repo says `active / maintenance / expired / removed`). Readiness uses `current / due_soon / expired / inspection_due_soon / inspection_overdue / missing / out_of_service`. "Out of Service" vs "out_of_service" vs "Removed" vs "removed" carry different meanings per table.
- **"Issue":** In Fleet it means a reported problem (`record_type: "Issue"`). In Equipment it means handing gear to an officer (`issue_date`, "Equipment issued"). A quartermaster reading "Issues" on a fleet tile could misread it.
- **"Inspection":** It refers to vehicle checklists (Fleet), firearm armorer inspections (`/firearms/inspections`, which is what `/inspections` resolves to), equipment `next_inspection_date` (date only, no workflow), and off-duty firearm inspections.
- **"Assigned":** Fleet `assignment_type` (Pool/Permanent/Specialized) plus free-text `assigned_to`; equipment `assigned_user_id`/`assigned_vehicle_id`/`assigned_location`; work-order `assigned_role_code`.
- **"Critical":** A work-order priority, a checklist item flag, an inspection condition, and an equipment `is_critical` flag. Each carries different automatic consequences.
- **Labels and URLs:** The nav and page header say "Assets & Fleet" and "Fleet Management", the URL is `/fleet-management`, and the settings path is `/settings/fleet`. The printed label says "Equipment custody" for a feature (custody) that has no UI.
