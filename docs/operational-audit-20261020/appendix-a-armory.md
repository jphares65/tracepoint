# TracePoint Armory Module: Operational Workflow Audit

**Method:** I read the source, migrations and tests in `/home/user/tracepoint` statically. **Nothing was executed at runtime.** I did not run the app, the tests or any SQL. A "Confirmed defect" means that the handler, schema or UI code I read shows the failure path directly. Step counts are estimates from the UI structure, not measured sessions. All paths are relative to `/home/user/tracepoint`.

---

## 1. Workflow inventory

| Workflow | Route(s) / API | Operational purpose | Primary roles |
|---|---|---|---|
| Firearm inventory (list, add, edit, archive, restore) | `/firearms` (standard and focus views); `GET/POST /api/armory/firearms`; `PATCH /api/armory/firearms/[id]` (RPC `update_firearm_with_audit`); `PATCH .../archive`, `.../restore` | Department-owned weapon register | Armorer (`manage_firearms`), Command (view) |
| Firearm record (single weapon) | `/firearms/[firearmId]` (reads the whole inventory through `GET /api/armory/firearms?includeArchived=true`) | Read-only summary of one weapon | Armorer, Inspector, assigned Officer |
| Issue / return (custody) | `POST/PATCH /api/armory/firearms/[id]/assignments`; "custody" tab of the `/firearms` side panel | Chain of custody, magazine accountability | Armorer |
| Condition status change | `PATCH /api/armory/firearms/[id]/status` (writes `firearm_status_history`) | Put a weapon in or out of service | Armorer, Inspector |
| Firearm inspection | `/firearms/inspections`, `/firearms/inspections/new`, `/inspections` (redirect only); `GET/POST /api/armory/inspections` | Armorer annual or periodic inspection and checklist | Armorer / Inspector (`manage_inspections`) |
| Firearm documents | `FirearmAttachments` component; `GET/POST /api/armory/firearms/[id]/attachments`; `/api/attachments/[id]/download`; `DELETE /api/attachments/[id]` | Acquisition and transfer paperwork, photos | Armorer |
| Ammunition ledger (UI) | `/firearms/ammunition`; `GET/PUT /api/pilot/ammunition` (one JSON blob in `pilot_ammunition_workspaces`) | Receive, record use and physical counts by ammo type and lot | Armorer / Range staff |
| Ammunition ledger (relational API, no UI) | `GET/POST /api/armory/ammunition` (`ammunition_lots`, `ammunition_transactions`) | Used by reports and import/export only | Reports / Import |
| Seasonal ammo reconciliation | `/firearms/ammunition/reconciliation`; `GET/POST /api/armory/ammunition/reconciliations` | Count, submit and certify against `ammunition_lots` | Armorer → "Command" certify |
| Personal (patrol) rifle program | `/firearms/personal-rifles`, `/personal-rifle-review/[rifleId]` (redirect); `/api/armory/personal-rifles`, `[rifleId]`, `inbox`, `rules` | Officer-owned rifle authorization: owner → armorer → chief | Officer, Armorer, Chief |
| Off-duty firearm authorization | `/off-duty-firearms`; `GET/POST /api/off-duty-firearms`; `PATCH /api/off-duty-firearms/[id]`; `GET/POST .../[id]/inspections` | Off-duty carry approval with qualification and inspection gates | Officer, Inspector, Command reviewer |
| Malfunctions | Range Day workspace JSON only (`/range-days`, `pilot_range_workspaces.workspace.malfunctions`) | Log malfunctions seen on the line | Range staff |
| QR labels | `TracePointQrLabel.tsx` (used only by `/equipment` and `/fleet-management`) | Printable asset labels | Equipment / Fleet managers |
| Armory notifications | `GET /api/notifications` (computes alerts from `/api/armory/firearms`, `/api/pilot/ammunition`, `/api/armory/personal-rifles/inbox`); off-duty `notification_events` rows | Inbox alerts | All |

---

## 2. Role-based end-to-end assessments

**A. Issuing a duty weapon to a new hire (Armorer)**
The steps are: /firearms → search → click row → Custody tab → choose officer → enter magazines and notes → Assign. That is about 6–7 interactions. If the weapon is not in inventory yet, the Add form comes first (about 10 fields).
- The server checks that the officer is an active member, that the weapon is "In Service" and that it has no open assignment. A partial unique index (`firearm_assignments_one_active_per_firearm`) also blocks concurrent double-issue. This part is solid.
- What is missing:
  - The officer never acknowledges or signs for the weapon.
  - The officer's qualification status and the configured failure lockout are not checked (ARM-09).
  - Nothing warns that the officer already holds a weapon of the same type.
  - The officer gets no notification.
- The firearm record page (`/firearms/[id]`) has no custody actions, even though the focus view tells users to go there for them (ARM-14).

**B. Officer separation / weapon return (Armorer, Personnel admin)**
The return itself is: select the weapon → Custody tab → magazines returned (plus a reason if there is a discrepancy) → Return. That is about 4 interactions.
- Separation is not linked to the armory. Deactivating a membership through `update_department_member` or the personnel import does not check open firearm assignments (ARM-08). After deactivation the weapon shows as held by "Unknown User", because the armory only resolves names of active members.
- The return does not record a condition observation. `condition_at_return` is just copied from the weapon's current status (ARM-12).
- Past assignments are never displayed anywhere, so the custody history cannot be reviewed in the UI (ARM-07).

**C. Weapon swap after malfunction (Armorer)**
This is 3 separate operations with about 12 interactions: return weapon A → Status tab, set "Out of Service" plus notes → select weapon B → Custody tab, assign.
- There is no swap action and no link to the malfunction.
- On a clean-bootstrapped database the status step returns HTTP 500 (ARM-02).
- A malfunction logged at the range never reaches the weapon record or its status (ARM-10).

**D. Armorer annual inspection with a failed part (Armorer)**
The steps are: /firearms/inspections/new → select weapon → about 20 checklist items → result and recommendation → Save. That is 5 interactions at minimum if the defaults are accepted.
- Every checklist item defaults to "Pass" and the result defaults to "Passed" (ARM-15).
- The "critical item failed ⇒ cannot pass" rule is enforced only in the browser (ARM-16).
- A "Failed" result moves the weapon to "Inspection Required" but writes no status-history row. A later "Passed" never returns the weapon to "In Service" (ARM-17).
- No inspection due date exists for duty weapons, so annual inspections cannot be tracked (ARM-18).
- Certification gating for inspectors exists only on the off-duty path (ARM-19).
- The assigned officer keeps custody of the failed weapon. The derived inbox alert is the only signal they get.

**E. Ammunition received, issued, used at range and reconciled (Armorer, Range staff, Command)**
On /firearms/ammunition: Receive Lot (about 8 fields) → Record Use (choose kind, quantity, reference) → Physical Count. Separately, /firearms/ammunition/reconciliation runs a seasonal count → Submit → Certify.
- These are two different data stores (ARM-03). The UI writes a JSON blob. Reconciliation and reports read relational tables that only import/export writes.
- On a clean bootstrap the relational tables do not exist at all (ARM-02).
- The JSON ledger:
  - is last-write-wins, so concurrent edits overwrite each other;
  - records no actor on each activity row;
  - lets a physical count silently overwrite on-hand stock (ARM-21, ARM-22).
- In reconciliation, the same person can count, submit and certify, and the "expected" quantities come from the browser (ARM-23).

**F. Off-duty carry request, approval or denial, revocation (Officer, Inspector, Command)**
- Officer: /off-duty-firearms → New request (about 12 fields plus acknowledgement) → Submit. Command reviewers get a notification.
- Inspector: record an inspection (date and Pass/Fail), about 3 interactions.
- Reviewer: open the request → choose a qualification mode → set dates → Approve / Deny / Return, about 5 interactions. The officer gets a notification. This is the most complete workflow in the module.
- Gaps:
  - No revoke or suspend action exists, even though the UI renders "Revoked" (ARM-24).
  - There is no renewal path after expiry, and the department-wide unique serial blocks a new request (ARM-25).
  - Reviewers can approve their own request (ARM-26).
  - A reviewer can bypass the qualification check even when policy requires it (ARM-27).
  - A failed inspection after approval leaves the officer "Authorized" (ARM-28).
  - There are no expiry alerts.

**G. Personal rifle submission and review (Officer → Armorer → Chief)**
- Owner: about 15 fields → Submit.
- Armorer: 6 checklist ticks, a qualification-verified checkbox, inspection date → Approve. The chief then approves. Suspend, reinstate and revoke are supported.
- Gaps:
  - Owners can review their own rifle (ARM-29).
  - "Qualification verified" is a checkbox, not a lookup against qualification records (ARM-30).
  - "Expired" is never set, and expiry alerts stop on the expiration date (ARM-31).
  - Denied or revoked rifles can never be resubmitted because of the serial-number duplicate check.
  - No notifications are written. Work items are computed by the inbox endpoint.

**H. Lost or stolen weapon (Armorer, Command)**
There is no workflow for this.
- Status choices are only In Service, Out of Service, Maintenance, Inspection Required and Retired. The schema enum has `missing`, but the app uses a separate `condition_status` text column without it (ARM-05).
- Archiving requires the weapon to be "returned" first. To archive a stolen weapon, the armorer must record a false return with a magazine count (ARM-06).
- There is no incident or report number, NCIC entry field, command notification or recovery workflow. Restoring a weapon wipes the archive reason (ARM-13).

**I. Transfer, disposal or destruction (Armorer)**
- The steps are: Status "Retired" (optional) → Archive with a free-text reason → confirm. About 4 interactions.
- A "transfer_disposition" attachment category exists, but nothing structured is recorded: no disposition type, receiving FFL or agency, destruction witness, or date.
- The two parallel lifecycle concepts ("Retired" status and archive) are not coordinated (ARM-05).

**J. Scanning a printed TracePoint QR label with a phone (any user)**
- No camera or QR scanning code exists in `src`. Searches for `BarcodeDetector`, `getUserMedia`, `jsqr`, `zxing` and `html5-qrcode` found nothing. The only `capture="environment"` inputs are photo uploads for qualification evidence.
- Labels encode `tracepoint://equipment/<id>` or `tracepoint://vehicle/<id>` (`src/lib/tracepoint/qr-identifiers.ts:6`). There is no registered protocol handler, app route or PWA manifest for this scheme.
- A phone camera will show the raw text or "no usable data". It does not open TracePoint, so the login redirect with `next=` in `src/lib/supabase/proxy.ts:174-182` never applies.
- Firearms have no QR label at all (ARM-01).

---

## 3. Findings

### ARM-01 — QR labels encode an unresolvable `tracepoint://` URI; firearms have no label at all
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** QR labels / Armory / Fleet / Equipment
- **Scenario:** An armorer prints a label for a rack or vehicle and a sergeant scans it with an iPhone. The camera shows `tracepoint://vehicle/abc…` with no action, or "No usable data". The vehicle dialog says the opposite.
- **Evidence:**
  - `src/lib/tracepoint/qr-identifiers.ts:1-6`: `export type TracePointQrKind = "vehicle" | "equipment";` … ``return `tracepoint://${kind}/${encodeURIComponent(normalizedId)}`;``
  - `src/app/components/TracePointQrLabel.tsx:166`: `"Scan with a mobile device to open this vehicle."`
  - "Copy Link" copies the same non-HTTP value (`:136-139`).
  - The only importers are `src/app/equipment/page.tsx:26` and `src/app/fleet-management/page.tsx:22`. Nothing in `src/app/firearms/**` uses it.
  - No scanner code exists anywhere in `src` (see scenario J).
  - The test `qr-identifiers.test.ts:7-9` locks in the custom scheme.
- **Correction:**
  - Encode an HTTPS deep link, for example `https://<host>/q/<kind>/<id>`.
  - Add a `/q/[kind]/[id]` route that resolves the record, enforces the department and permissions, and redirects to the record page. The existing proxy `next=` login redirect will then work after authentication.
  - Add a `firearm` kind and render the label on `/firearms/[id]`.
  - Optionally add an in-app scanner using `BarcodeDetector` with a file-capture fallback.
- **Benefit:** One scan opens the right record on patrol or at the armory counter.
- **Complexity:** M

### ARM-02 — Status change and the whole relational ammunition stack depend on tables that no tracked migration creates
- **Classification:** Confirmed defect
- **Priority:** Critical (for any new or clean install)
- **Module:** Firearm status, ammunition API, reconciliation, reports
- **Scenario:** A new agency is bootstrapped from `supabase/migrations`. Every status change returns 500, and the reconciliation page and ammunition reports fail.
- **Evidence:**
  - `supabase/migrations/20260721_permissions_rls_hardening_v1.sql:329-334`: "This table existed in an early production prototype but was never part of the tracked foundation migration… `if to_regclass('public.firearm_status_history') is not null`".
  - No `create table` for `firearm_status_history`, `ammunition_lots`, `ammunition_transactions`, `ammunition_reconciliations` or `ammunition_reconciliation_items` exists in any `.sql` in the repo. They appear only in the guarded loop at `20260826173000_expand_accountability_audit_coverage.sql:120-126`.
  - The status route inserts the history row and then reverts the status on failure, at `src/app/api/armory/firearms/[firearmId]/status/route.ts:117-143`: `.from("firearm_status_history")` … `throw new Error(historyError.message)`.
  - `scripts/validate-local-armory-workflows.sql` never exercises status changes or ammunition, so `db:validate-bootstrap` cannot catch this.
- **Correction:** Add an idempotent migration that creates these tables, with RLS and immutability policies matching what production has. Extend `validate-local-armory-workflows.sql` to cover a status change and an ammunition transaction.
- **Benefit:** Core armory operations work on every deployment.
- **Complexity:** M

### ARM-03 — Two disconnected ammunition ledgers; reconciliation and reports do not reflect what armorers enter
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Ammunition
- **Scenario:** An armorer receives 10,000 rounds on /firearms/ammunition. At the spring cycle the reconciliation page lists expected quantities from a different table: empty, or whatever import last wrote. The "Ammunition Inventory" report shows neither.
- **Evidence:**
  - The ammo UI reads and writes only `/api/pilot/ammunition` (`src/app/firearms/ammunition/page.tsx:295,328`), which upserts the JSON blob into `pilot_ammunition_workspaces` (`src/app/api/pilot/ammunition/route.ts:104`).
  - Reconciliation reads `ammunition_lots.quantity_on_hand` (`src/app/api/armory/ammunition/reconciliations/route.ts:211-244`).
  - Reports point to `/api/armory/ammunition` (`src/lib/reports/report-definitions.ts:19-20`).
  - The only UI caller of `/api/armory/ammunition` is import/export (`src/app/settings/import-export/page.tsx:3527`).
  - The ammo page also keeps its own `reconciliations` array inside the blob (`page.tsx:645-656`), which makes three count records.
- **Correction:** Pick one ledger, the relational one, which has per-row actor data. Migrate the JSON workspace into it and point the UI, reconciliation, notifications and reports at it.
- **Benefit:** A single authoritative round count that holds up in audit.
- **Complexity:** L

### ARM-04 — `update_firearm_with_audit` is SECURITY DEFINER, executable by PUBLIC, with no authorization check
- **Classification:** Confirmed defect (security / accountability)
- **Priority:** Critical
- **Module:** Firearm edit / audit log
- **Scenario:** Any authenticated user of any agency calls `POST /rest/v1/rpc/update_firearm_with_audit` directly with the public publishable key and their own JWT. They can change the serial number, make or model of another agency's firearm and write an `audit_log` row attributed to any `p_user_id`.
- **Evidence:**
  - `supabase/migrations/20260822184500_add_missing_make_attention.sql:1-17`: parameters `p_department_id uuid, p_user_id uuid …` with `security definer`.
  - The function body only checks for note and required fields. It contains no `auth.uid()` or `has_department_permission` call.
  - A repo-wide grep for `revoke … update_firearm_with_audit` or `grant execute … update_firearm_with_audit` found nothing, so the Postgres default EXECUTE-to-PUBLIC grant applies.
  - Compare the off-duty RPCs, which are `revoke all … from public; grant execute … to service_role` (`202608170006_apply_off_duty_decision_rpc.sql:105-128`).
  - The API caller passes `p_user_id: context.userId` (`src/app/api/armory/firearms/[firearmId]/route.ts:103-116`), so the actor comes from a parameter, not the session.
- **Correction:** Revoke from PUBLIC and authenticated. Either grant to `service_role` only, or derive the actor from `auth.uid()` and require `has_department_permission(p_department_id,'manage_firearms')` inside the function. Audit every other SECURITY DEFINER function the same way.
- **Benefit:** Prevents cross-tenant tampering with weapon identity and forged audit entries.
- **Complexity:** S

### ARM-05 — No lost / stolen / missing / transferred / destroyed lifecycle; two conflicting status columns
- **Classification:** Verified usability problem
- **Priority:** High
- **Module:** Firearm inventory
- **Scenario:** A patrol rifle is stolen from a vehicle. The armorer can only pick "Out of Service" or "Retired". Command dashboards, reports and notifications cannot tell a stolen weapon from one at the gunsmith.
- **Evidence:**
  - `src/app/api/armory/firearms/[firearmId]/status/route.ts:15-21`: `VALID_STATUSES = ["In Service","Out of Service","Maintenance","Inspection Required","Retired"]`.
  - The schema has a separate enum column `firearms.status` with `'missing'` (`202606220001_tracepoint_foundation.sql:19-27,363`) that the app never reads or writes.
  - The app uses `condition_status text` added in `202609050007_armory_runtime_columns.sql:9`, with no check constraint.
- **Correction:**
  - Add Lost/Stolen, Transferred, Destroyed and Pending Disposition dispositions, with required fields: report or incident number, date, NCIC entry flag, receiving agency/FFL, witness.
  - Notify command when a weapon is marked Lost or Stolen.
  - Drop or sync the legacy `status` enum and add a CHECK constraint to `condition_status`.
- **Benefit:** Accurate accountability and legally required reporting.
- **Complexity:** M

### ARM-06 — A lost or stolen weapon cannot be archived without recording a fictitious "return"
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Archive / custody
- **Scenario:** An officer's duty pistol is stolen from their home. To take it out of inventory the armorer must "return" it, which stamps `returned_at` and `returned_by` and asks for magazines returned, and then archive it. The custody record now says the weapon came back.
- **Evidence:**
  - `src/app/api/armory/firearms/[firearmId]/archive/route.ts:100-120`: `if (activeAssignment) { … "This firearm is currently assigned. Return it before archiving it." }`.
  - The UI mirrors this (`src/app/firearms/page.tsx` `handleArchiveFirearm`: "Record its return before archiving it.").
  - The PATCH return handler has no "closed — not recovered" mode (`assignments/route.ts:254-335`).
- **Correction:** Add an assignment close reason (Returned, Lost, Stolen, Separated, Transferred) so the assignment can be closed without asserting physical return.
- **Benefit:** The custody chain stays truthful.
- **Complexity:** S–M

### ARM-07 — Chain of custody (past assignments) is never shown anywhere
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Custody / firearm record
- **Scenario:** Internal Affairs asks who carried serial X between March and June. The data exists in `firearm_assignments` but no screen or report shows returned assignments.
- **Evidence:**
  - The only armory read of assignments filters `.is("returned_at", null)` (`src/lib/armory/read-repository-supabase.ts:28`).
  - The firearm record page shows only `active_assignment`, Created and Last Updated (`src/app/firearms/[firearmId]/page.tsx:399-497`).
  - It has no inspection, status-history or attachment history section.
  - The "Firearms and Assignments" report uses the same endpoint (`report-definitions.ts:16`).
- **Correction:** Add a history timeline on `/firearms/[id]` covering assignments, status history, inspections, edits from `audit_log`, attachments and malfunctions. Add an "assignment history" report.
- **Benefit:** Investigations and audits are answered in seconds.
- **Complexity:** M

### ARM-08 — Deactivating an officer does not check or clear issued firearms
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Personnel ↔ Armory integration
- **Scenario:** An officer resigns and HR deactivates the account. Their duty pistol and rifle stay "assigned". The armory list then shows the holder as "Unknown User" and nobody is prompted to recover the weapons.
- **Evidence:**
  - `supabase/migrations/202606260003_settings_administration.sql:645-655`: `update public.department_memberships set … is_active = p_is_active, deactivated_at = …`. There is no lookup of `firearm_assignments`.
  - The personnel import path sets `is_active: active` the same way (`src/app/api/settings/onboarding/personnel/route.ts:179-180`).
  - The armory resolves names only for active members (`read-repository-supabase.ts:30` `.eq("is_active", true)`). The fallback is `assigned_to_name: member?.full_name ?? "Unknown User"` (`read-repository-core.ts:62-66`).
- **Correction:**
  - Block deactivation, or require an acknowledgement, while weapons, off-duty authorizations or personal rifles are active.
  - Create a "separation recovery" task or notification for armorers.
  - Resolve names for inactive members too.
- **Benefit:** No weapon leaves the department untracked.
- **Complexity:** M

### ARM-09 — Qualification failure lockout is configurable and enabled by default but never enforced
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Range qualifications ↔ Armory
- **Scenario:** Policy (default threshold 2) says an officer who fails twice with a weapon is restricted from it. The armorer re-issues the weapon and nothing stops it or warns.
- **Evidence:**
  - `supabase/migrations/202608230002_firearm_failure_lockout_rules.sql:16-24` seeds `"firearm_failure_lockout_enabled": true, "firearm_failure_lockout_threshold": 2`.
  - The evaluator `evaluateFirearmQualificationAuthorization` in `src/lib/tracepoint/firearm-qualification-lockout.ts:41` is never imported (grep finds only its definition).
  - The issue handler checks only membership, status and open assignment (`assignments/route.ts:101-175`).
- **Correction:** Call the evaluator in the issue handler and in the inventory payload. Block or warn on issue, show a "Qualification Restricted" badge, and add a supervisor-release action.
- **Benefit:** Enforces the agency's use-of-force readiness policy.
- **Complexity:** M

### ARM-10 — Range malfunctions never reach the firearm record or status; malfunction-threshold logic is dead code
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** Malfunctions / Range ↔ Armory
- **Scenario:** A pistol has three failures to feed at quals. The range officer logs them on the Range Day. The armory still shows the pistol "In Service" with no malfunction history, and it is re-issued.
- **Evidence:**
  - Malfunctions live only in `pilot_range_workspaces.workspace.malfunctions` (`src/app/api/pilot/range-workspace/route.ts:21,46`).
  - The `firearm_malfunctions` table (`foundation.sql:616`) is never written by app code.
  - `src/app/lib/tracepoint/firearm-utils.ts` contains `inspectionRequired: malfunctionSummary.inspectionRequired` (`:78`), but no file imports `firearm-utils`.
  - `permissions.ts:37` advertises malfunctions under `manage_inspections`.
- **Correction:** Write range malfunctions to `firearm_malfunctions` with `firearm_id`. Show them on the firearm record. Apply the threshold to set "Inspection Required" and notify armorers.
- **Benefit:** Unreliable weapons are pulled before they fail on duty.
- **Complexity:** M

### ARM-11 — Status can be changed to Out of Service / Retired while the weapon is still issued
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** Status / custody
- **Scenario:** An armorer marks a weapon "Retired" while an officer still carries it. The weapon stays assigned, and the officer gets only a computed inbox alert.
- **Evidence:**
  - `status/route.ts:78-114` checks only that the weapon exists and the status changed. It never queries `firearm_assignments`.
  - The inspection route likewise flips status without considering custody (`inspections/route.ts:231-241`).
- **Correction:** For Retired, require return first. For Out of Service or Maintenance, show "weapon currently issued to X — recall?" and create a recall task or notification. Block Retired while an assignment is open.
- **Benefit:** Weapons out of service are actually recalled.
- **Complexity:** S

### ARM-12 — The return records no observed condition, no notes and no "received by" distinct from the clerk
- **Classification:** Verified usability problem
- **Priority:** Medium
- **Module:** Custody
- **Scenario:** An officer turns in a weapon with a cracked frame. The return captures only a magazine count, and `condition_at_return` copies the database status ("In Service").
- **Evidence:**
  - `assignments/route.ts:316-328`: `condition_at_return: firearm.condition_status ?? null`.
  - The PATCH body accepts only `magazinesReturned` and `discrepancyReason` (`:254-257`).
  - The UI sends only those two fields (`src/app/firearms/page.tsx` `handleReturnFirearm`).
- **Correction:** Add a return condition picker, return notes and photos. If the condition is not serviceable, offer "set status / create inspection" in the same step.
- **Benefit:** Damage is documented at the point of custody transfer.
- **Complexity:** S

### ARM-13 — Restore requires no reason and wipes the archive disposition from the record
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** Archive / restore
- **Scenario:** A stolen weapon is recovered and restored. The record no longer shows when or why it was archived. That information survives only in raw `audit_events` JSON, which no screen shows.
- **Evidence:** `restore/route.ts:84-90` sets `is_active: true, archived_at: null, archived_by_user_id: null, archive_reason: null`. The handler reads no reason from the body.
- **Correction:** Require a restore reason. Keep the archive and restore events in a lifecycle table instead of nulling the columns.
- **Benefit:** Dispositions remain traceable.
- **Complexity:** S

### ARM-14 — The "full firearm workspace" link leads to a read-only page; the record page loads the whole inventory
- **Classification:** Verified usability problem
- **Priority:** Medium
- **Module:** Firearm inventory UI
- **Scenario:** In focus view, an armorer taps "Open full firearm record" to issue a weapon and lands on a page with no actions. They have to go back to the standard view.
- **Evidence:**
  - `src/app/firearms/page.tsx:1522`: "Use the full firearm workspace for custody actions, documents, status changes, and audit-preserving edits."
  - `src/app/firearms/[firearmId]/page.tsx` has a single `fetch` (`:169`) of `/api/armory/firearms?includeArchived=true` and no mutation calls. It filters client-side with `records.find((record) => record.id === firearmId)`.
- **Correction:** Move the custody, status, edit and documents tabs onto `/firearms/[id]`. Add `GET /api/armory/firearms/[id]`. Fix the copy.
- **Benefit:** One record page works on mobile and from QR deep links, without loading the entire inventory.
- **Complexity:** M

### ARM-15 — The inspection form defaults every checklist item to "Pass" and the result to "Passed"
- **Classification:** Verified usability problem (integrity risk)
- **Priority:** High
- **Module:** Firearm inspections
- **Scenario:** A busy armorer selects a weapon and taps Save. A complete "Passed" inspection with about 20 passed items is recorded without anything being examined.
- **Evidence:**
  - `src/app/firearms/inspections/new/page.tsx:105-238`: every `DEFAULT_CHECKLIST` item has `status: "Pass"`.
  - `:337`: `useState<…>("Passed")`.
  - `:340`: service recommendation defaults to `"Remain In Service"`.
- **Correction:** Start items as unanswered. Require an explicit answer for each critical item and for the result. Optionally require a note on each Fail.
- **Benefit:** Inspection records are credible evidence.
- **Complexity:** S

### ARM-16 — The rule "a failed critical item cannot pass" and the result values are enforced only in the browser
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** Inspections API
- **Scenario:** An API client, a stale tab or an import posts `result:"Passed"` with a failed critical item, or `result:"Pass"`. The server stores it.
- **Evidence:**
  - The client check is at `new/page.tsx:419-423`.
  - The server inserts `result: body.result` (`src/app/api/armory/inspections/route.ts:186`) with only `if (!body.result)` validation (`:136`).
  - The staging acceptance test posts `result:'Pass'`, which is not one of the UI's four values, and expects 200 (`scripts/staging-extended-workflows.mjs:50`).
  - `firearm_inspections.result` is free text (`20260708_firearm_inspections.sql:31`).
- **Correction:** Validate `result` against an enum on the server and in a DB CHECK. Reject Passed when any `critical && status==="Fail"` item is present.
- **Benefit:** Consistent inspection outcomes and reporting.
- **Complexity:** S

### ARM-17 — Inspections change status outside the status-history path and are not atomic; "Passed" never restores service
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** Inspections ↔ status
- **Scenario 1:** A weapon flagged "Inspection Required" is re-inspected and passes. It stays "Inspection Required", and the armorer must also change status by hand, which fails on a clean install per ARM-02.
- **Scenario 2:** The checklist insert fails. The response says "Inspection was created, but checklist items could not be saved". A retry creates a duplicate inspection.
- **Evidence:**
  - `inspections/route.ts:44-50`: a "Passed" result returns `null`, so there is no status change.
  - `:231-241` updates `firearms.condition_status` directly without inserting `firearm_status_history`. Compare `status/route.ts:130-131`: "A status change without its audit record is not acceptable."
  - `:205-228` shows the partial-failure response after the inspection row is already inserted.
  - The status update at `:240` filters by `.eq("id", body.firearmId)` only, with no department filter (RLS still applies).
- **Correction:** Use one RPC transaction that inserts the inspection, its items and the status-history row together. On "Passed" with recommendation "Return to Service", offer to restore In Service.
- **Benefit:** Consistent status history and no orphaned or duplicate inspections.
- **Complexity:** M

### ARM-18 — No inspection due dates or overdue tracking for duty firearms
- **Classification:** Confirmed defect (missing core control)
- **Priority:** High
- **Module:** Inspections / notifications / command dashboard
- **Scenario:** Policy requires an annual armorer inspection. Nothing tells the armorer which weapons are overdue.
- **Evidence:**
  - `firearms.last_inspection_date` and `firearms.next_inspection_due` (`foundation.sql:368-369`) are never read or written in `src`.
  - `follow_up_date` is written (`inspections/route.ts:188`) and never read anywhere.
  - Notifications only react to the current `condition_status` (`src/app/api/notifications/route.ts:268-271`).
  - Off-duty inspections do have interval and due-soon logic (`src/app/api/off-duty-firearms/route.ts:90-140`), which shows the capability exists.
- **Correction:** Add an inspection interval to department rules. Compute last and next due dates per firearm and show them in inventory columns. Add due-soon and overdue notifications and a command-dashboard tile.
- **Benefit:** Inspections happen on schedule without a manual spreadsheet.
- **Complexity:** M

### ARM-19 — Armorer certification gating applies to off-duty inspections but not to duty-weapon inspections
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** Inspections / certifications
- **Scenario:** The agency requires a current armorer certification to inspect firearms. An uncertified sergeant with `manage_inspections` records a duty-rifle inspection, which the API accepts. The same user is blocked on an off-duty inspection.
- **Evidence:**
  - `src/app/api/off-duty-firearms/[requestId]/inspections/route.ts:146-157` calls `evaluateCertificationCapability({ … capabilityCode: "perform_firearm_inspections" })`.
  - grep shows this is the only caller. `src/app/api/armory/inspections/route.ts:103-115` checks permissions only.
  - Personal-rifle armorer approval has no certification check either.
- **Correction:** Apply the same capability check to `/api/armory/inspections` POST and to personal-rifle `armorer_approve`.
- **Benefit:** Consistent qualified-inspector policy.
- **Complexity:** S

### ARM-20 — Inspection history and the inspection report are capped at 100 rows
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** Inspections / reports
- **Scenario:** An agency with 150 firearms has its 101st oldest inspection drop out of the list and out of the "Firearm Inspection History" report, with no indication.
- **Evidence:**
  - `src/lib/armory/read-repository-supabase.ts:33`: `…order("inspection_date", { ascending: false }).limit(100)`.
  - The report endpoint is the same route (`report-definitions.ts:17`).
  - Ammo transactions have the same `.limit(100)` (`api/armory/ammunition/route.ts:38`).
- **Correction:** Add pagination and date filters to the API. Reports should stream all rows for the requested range.
- **Benefit:** Complete records for audits.
- **Complexity:** S

### ARM-21 — The ammo JSON ledger is last-write-wins, has no per-activity actor, and has no feature gate
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Ammunition
- **Scenario 1:** Two range staff record range issues from two laptops. The second save overwrites the first, and the first activity rows and decrements vanish.
- **Scenario 2:** An auditor cannot tell who recorded any transaction.
- **Evidence:**
  - The browser sends the entire workspace. The server upserts it whole (`src/app/api/pilot/ammunition/route.ts:71-118`, `upsert({ department_id, workspace, … }, { onConflict: "department_id" })`) with no version or `updated_at` precondition.
  - The audit event stores only counts (`:119-139`).
  - `AmmoActivity` has no user field (`src/lib/tracepoint/ammunition-workspace.ts:60-73`).
  - Neither GET nor PUT calls `requireServerFeature(…"ammunition")`, unlike `/api/armory/ammunition`.
  - A user with `manage_firearms` can rewrite any historical activity, because the server trusts the whole blob.
- **Correction:** Use relational transactions (see ARM-03). Until then, add optimistic concurrency (an `updated_at` match), server-stamp the actor on each activity, validate that history is append-only, and apply the feature gate.
- **Benefit:** No lost transactions, and the ammo ledger holds up as evidence.
- **Complexity:** M (interim) / L (proper)

### ARM-22 — A physical count silently overwrites on-hand quantity with no required explanation or review; "Adjust" can only decrease
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** Ammunition
- **Scenario 1:** A count is 1,200 rounds short. The armorer enters the count and on-hand drops to match. No reason is required and no supervisor sees it.
- **Scenario 2:** On the relational API, a found overage cannot be booked as an adjustment.
- **Evidence:**
  - `src/app/firearms/ammunition/page.tsx:626-668`: `currentOnHand: physical`, `variance`, with optional `notes: countDraft.notes.trim()`.
  - Lot quantities are not adjusted, so type-level and lot-level totals diverge.
  - `src/app/api/armory/ammunition/route.ts:246-247`: `type === "Issue" || type === "Adjust" ? -quantity : quantity`, and `quantity <= 0` is rejected (`:223`).
- **Correction:** Require an explanation when variance is non-zero. Route variances above a threshold for supervisor approval. Allow signed adjustments. Post adjustments at lot level.
- **Benefit:** Shrinkage is detected and explained.
- **Complexity:** S–M

### ARM-23 — Reconciliation: one person counts, submits and certifies; expected quantities come from the client; certify rewrites counts
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Ammo reconciliation
- **Scenario:** The armorer who handles ammo also certifies their own count. They can post lower "expected" numbers so the variance comes out zero. On certify, the counts are replaced by whatever the certifying browser sends.
- **Evidence:**
  - `src/app/api/armory/ammunition/reconciliations/route.ts:355`: `const access = { canManage, canCertify: canManage };`. The same appears in GET at `:285`.
  - `:442-445`: `expected_quantity` is parsed from `item.expectedQuantity` in the request body. `lot_id: item.lotId` (`:451`) is not checked against department lots, and `admin` bypasses RLS.
  - `:472-485` deletes and re-inserts the item rows before the certify status check at `:507-516`. A rejected certify on a Draft still rewrites the items.
  - No check requires an explanation when variance is non-zero.
  - Certification does not post adjustments to `ammunition_lots`.
- **Correction:**
  - Compute the expected quantity on the server from the lot ledger at cycle snapshot time.
  - Make the certify action read-only over submitted items.
  - Require `certified_by ≠ submitted_by` and a distinct command permission.
  - Require explanations for variances.
  - Validate `lot_id` ownership.
  - Post certified variances as adjustments.
- **Benefit:** A genuine two-person control on ammunition accountability.
- **Complexity:** M

### ARM-24 — Off-duty authorizations cannot be revoked or suspended
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Off-duty firearms
- **Scenario:** An officer is placed on administrative leave or their off-duty weapon fails inspection. Command cannot revoke the authorization. The UI can display "Revoked", but no action sets it.
- **Evidence:**
  - `src/app/api/off-duty-firearms/[requestId]/route.ts`: allowed actions are `["Resubmit","Approve","Deny","Return"]`.
  - The decision path requires `request_status === "Pending Command Review"` (`:508-516`).
  - The RPC accepts only `'Approve','Deny','Return'` (`202608170006_apply_off_duty_decision_rpc.sql:20-22`).
  - The display code checks `row.authorization_status === "Revoked"` (`src/app/api/off-duty-firearms/route.ts:225`). grep shows no writer outside legacy migrations.
- **Correction:** Add Suspend, Reinstate and Revoke actions with required reason, history row and officer notification, mirroring the personal-rifle workflow.
- **Benefit:** Command can withdraw carry authority immediately.
- **Complexity:** S–M

### ARM-25 — No renewal path for expired off-duty authorizations; the unique serial blocks re-requests permanently
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Off-duty firearms
- **Scenario:** An officer's approval expires after a year, or a prior request was denied. They cannot resubmit, because resubmit is allowed only for "Returned for Correction". A new request for the same gun fails with "already exists for the department". A gun sold to another officer also cannot be registered.
- **Evidence:**
  - `[requestId]/route.ts:420-428`: "Only requests returned for correction may be resubmitted."
  - `202608180004_off_duty_serial_unique.sql:1-5`: `unique index … (department_id, serial_number)` with no status predicate.
  - `route.ts` POST maps the duplicate to 409 (`:585-600`).
  - Expiry only changes the computed `authorizationStatus` to "Expired" (`route.ts:227-233`). Nothing notifies the officer or reviewers before or at expiry; the notifications route has no off-duty expiry collector.
- **Correction:** Add a "Renew" action on Approved or Expired requests that re-enters review with re-inspection and qualification checks. Make the unique index partial (active statuses only), or key it by officer and serial. Add 60/30/0-day expiry notifications.
- **Benefit:** Annual renewal works without admin database edits.
- **Complexity:** M

### ARM-26 — Reviewers can approve their own off-duty request
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** Off-duty firearms
- **Scenario:** A lieutenant who has both `submit_off_duty_requests` and `review_off_duty_requests` (chief and administrator have both by default, per `foundation.sql:330-346`) approves their own off-duty carry.
- **Evidence:** `[requestId]/route.ts:502-516` checks the `isCommandReviewer(context)` permission and the status. Nothing compares `existing.officer_user_id` to `context.userId`.
- **Correction:** Reject decisions where the actor is the requester, or require a second reviewer.
- **Benefit:** Separation of duties.
- **Complexity:** S

### ARM-27 — The qualification "override" bypasses the department's required-qualification policy, and the check is not firearm-specific
- **Classification:** Potential gap requiring operational validation
- **Priority:** Medium
- **Module:** Off-duty firearms / qualifications
- **Scenario 1:** A department sets `require_off_duty_qualification = true`. A reviewer chooses "Independent qualification not required per department policy", types any sentence, and approves an officer with no current qualification.
- **Scenario 2:** Even without the override, a qualification with the duty Glock satisfies the requirement for a .38 revolver.
- **Evidence:**
  - `[requestId]/route.ts:548-574`: when `qualificationOverride` is true, `requiresOffDutyQualification` is never evaluated.
  - The UI offers the override unconditionally (`src/app/off-duty-firearms/page.tsx:1065-1085`).
  - `src/lib/tracepoint/off-duty-qualification-readiness.ts` never references a serial or firearm. It evaluates officer-level handgun components only.
  - The staging test approves through the override (`scripts/staging-extended-workflows.mjs:20`).
- **Correction:** Offer the override only when the policy permits exceptions, or require a higher permission. Confirm with the agency whether qualification must be with the specific off-duty weapon, and if so match on serial or firearm.
- **Benefit:** Approval reflects actual policy.
- **Complexity:** S–M

### ARM-28 — A failed off-duty inspection leaves the authorization "Authorized" and is mislabeled "Not Inspected"
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** Off-duty firearms
- **Scenario:** A re-inspection finds a cracked slide. The list shows "Not Inspected" with compliance "At Risk", and the officer remains authorized to carry it.
- **Evidence:**
  - `202608170005_record_off_duty_inspection_rpc.sql:50-55`: `case when p_result = 'Pass' then 'Current' else 'Not Inspected' end`. Authorization is untouched.
  - The list's `inspectionStatusForRequest` returns "Not Inspected" for a Fail (`src/app/api/off-duty-firearms/route.ts:122-126`).
  - The detail route's readiness returns "Failed" (`[requestId]/route.ts:96-101`), which conflicts.
  - Compliance becomes "Non-Compliant" only for Expired, Revoked or Overdue (`route.ts:254-261`).
- **Correction:** On Fail, set the inspection status to "Failed", automatically suspend authorization (or prompt command), and notify the officer and reviewers.
- **Benefit:** Unsafe personal weapons are not carried on department authority.
- **Complexity:** S

### ARM-29 — Personal rifle: owners can review their own rifle, and a failed history write leaves the record changed
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** Personal rifles
- **Scenario 1:** An officer who is also an armorer approves their own rifle; a chief approves their own.
- **Scenario 2:** The history insert fails after the status update. The API returns 500 even though the status already changed, and a retry gets 409 "not pending".
- **Evidence:**
  - `src/app/api/armory/personal-rifles/[rifleId]/route.ts:225-352`: the armorer and chief branches check permission and status but never `rifle.owner_user_id !== user.id`.
  - `:471-490` runs `update(updates)` and then `await recordPersonalRifleHistory(...)`, which throws if the insert fails (`src/lib/tracepoint/personal-rifle-server.ts:252`).
  - The update is also not conditional on the prior status (race).
- **Correction:** Block self-review. Wrap the update and history insert in one RPC with a `where status = <expected>` guard.
- **Benefit:** Credible approvals and a consistent history.
- **Complexity:** S–M

### ARM-30 — Personal rifle "qualification verified" is a self-attested checkbox
- **Classification:** Potential gap requiring operational validation
- **Priority:** Medium
- **Module:** Personal rifles ↔ Qualifications
- **Scenario:** An armorer ticks "qualification verified" for an officer who has never qualified with a rifle. The system records it as verified.
- **Evidence:** `[rifleId]/route.ts:256-266` requires only `body.qualificationVerified !== true`, and stores `qualification_verified_by: user.id`. No call is made to the qualification readiness code that the off-duty module uses.
- **Correction:** Look up the officer's current rifle qualification, which may need to be specific to this rifle's serial, and show it. Allow a manual override only with a reason.
- **Benefit:** Ties rifle authorization to real range data.
- **Complexity:** M

### ARM-31 — Personal rifle approvals never become "Expired"; alerts stop on the expiration date; denied or revoked rifles cannot be resubmitted
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** Personal rifles
- **Scenario:** A rifle approval lapses. The next day it still shows "Approved" and the 60-day reminder disappears. A denied officer who fixes the rifle cannot submit again.
- **Evidence:**
  - "Expired" exists only as a UI label (`src/app/firearms/personal-rifles/page.tsx:35,188`). No API writes it.
  - The inbox alert condition is `expiration >= today && expiration <= sixtyDays` (`src/app/api/armory/personal-rifles/inbox/route.ts:123-131`).
  - The create route rejects any existing serial regardless of status (`src/app/api/armory/personal-rifles/route.ts:151-166`, `.ilike("serial_number", serialNumber)`).
  - Owner editing is limited to `Draft` and `Correction Requested` (`[rifleId]/route.ts:79`).
- **Correction:** Derive or set Expired when the expiration date has passed. Alert on overdue items. Add "Renew / Reinspect" and "Resubmit after denial" actions.
- **Benefit:** The rifle program stays current without manual tracking.
- **Complexity:** S–M

### ARM-32 — Firearm attachment metadata is listable by any department member; another module's permission can archive armory documents
- **Classification:** Confirmed defect
- **Priority:** Low
- **Module:** Attachments
- **Scenarios:**
  - An officer lists acquisition and transfer document names and descriptions for any department firearm. The download itself is authorized correctly.
  - A user with only `manage_range_days` archives a firearm's transfer document.
- **Evidence:**
  - `src/app/api/armory/firearms/[firearmId]/attachments/route.ts:18-27`: GET has no feature or permission check and uses `admin`.
  - Compare `src/app/api/attachments/[attachmentId]/download/route.ts`, which checks `manage_firearms`, `manage_inspections` or an active assignment.
  - `src/app/api/attachments/[attachmentId]/route.ts`: DELETE allows any of `["manage_firearms","manage_qualifications","manage_inspections","manage_range_days"]` regardless of `entity_type`.
  - Uploads accept only PDF, JPEG, PNG and WebP. iPhone camera HEIC photos are rejected, which is a mobile friction point.
- **Correction:** Apply the same rule as download to the listing. Scope the archive permission by `entity_type`. Accept HEIC or convert it on the client.
- **Benefit:** Least privilege for disposition paperwork, and smoother photo capture on phones.
- **Complexity:** S

### ARM-33 — Editing a firearm with an empty caliber returns a raw database error
- **Classification:** Confirmed defect
- **Priority:** Low
- **Module:** Firearm edit
- **Scenario:** An armorer clears the caliber field to fix a bad import and gets 500 "null value in column caliber…".
- **Evidence:**
  - `src/app/api/armory/firearms/[firearmId]/route.ts:113`: `p_caliber: cleanOptionalText(body.caliber) ?? "TBD / Unknown"`. `cleanOptionalText` returns `""`, never null (`:28-32`), so the default never applies.
  - The RPC writes `caliber = nullif(trim(p_caliber), '')` into a `not null` column (`foundation.sql:359`).
- **Correction:** Use `cleanOptionalText(body.caliber) || "TBD / Unknown"`, or validate on the client.
- **Benefit:** No dead-end error.
- **Complexity:** S

### ARM-34 — Command staff cannot use the ammunition reports or alerts they are listed for
- **Classification:** Confirmed defect
- **Priority:** Low
- **Module:** Reports / notifications / command dashboard
- **Scenario:** A captain with `view_command_dashboard` opens "Ammunition Inventory" and gets 403. Their inbox shows an "Ammunition" source error.
- **Evidence:**
  - `report-definitions.ts:19-20` lists `permissions:["manage_firearms","view_command_dashboard"]`.
  - `src/app/api/armory/ammunition/route.ts` GET requires `manage_firearms`, as does `/api/pilot/ammunition` GET, which notifications call (`notifications/route.ts:935`).
  - grep found no armory, ammunition, off-duty or rifle reads in `src/app/api/command-dashboard`.
- **Correction:** Allow read-only GET for `view_command_dashboard`. Add armory tiles to the command dashboard: weapons out of service, overdue inspections, unreconciled variances, expiring authorizations.
- **Benefit:** Command visibility without granting write rights.
- **Complexity:** S

### ARM-35 — Inventory load enumerates every platform auth user (first 1,000) on each request; the off-duty list does per-row reloads
- **Classification:** Potential gap requiring operational validation (performance and correctness at scale)
- **Priority:** Low
- **Module:** Armory read path / off-duty
- **Scenario:** As the platform grows past 1,000 auth users, name fallbacks become "Unknown User" and the armory page slows down. An agency with 200 off-duty requests reloads the entire range workspace 200 times per list view.
- **Evidence:**
  - `src/lib/armory/read-repository-supabase.ts:32`: `listAuthUsers() { return this.admin.auth.admin.listUsers({ page: 1, perPage: 1000 }); }`. This is called on every `getFirearmInventory`, including for officers. The same pattern is in `api/armory/ammunition/route.ts:43` and `reconciliations/route.ts:114`.
  - `src/app/api/off-duty-firearms/route.ts:196-201` calls `getOfficerQualificationReadiness` per row, and that function selects the whole `pilot_range_workspaces.workspace` (`off-duty-qualification-readiness.ts:30-38`).
- **Correction:** Resolve names from `profiles` for the specific user IDs. Compute qualification readiness once per officer, or once per request batch.
- **Benefit:** Stable latency and correct names.
- **Complexity:** S

### ARM-36 — The armory API handlers have almost no automated tests
- **Classification:** Optional improvement
- **Priority:** Medium
- **Module:** Test coverage
- **Evidence:**
  - Unit tests exist only for read repositories and view helpers (`src/lib/armory/*.test.ts`, `src/lib/off-duty-firearms/read-repository.test.ts`, `src/lib/personal-rifles/read-repository.test.ts`).
  - The staging smoke test covers create → assign → inspect → return and the off-duty happy path (`scripts/staging-extended-workflows.mjs:12-21,43-51`).
  - Nothing tests status changes, archive and restore, ammunition, reconciliation, personal-rifle transitions, revocation, double-issue or inactive-member issue.
  - `scripts/validate-local-armory-workflows.sql` inserts rows directly and skips the handlers.
- **Correction:** Add handler-level tests with a fake data source for each transition and the negative cases above, plus a bootstrap test that exercises a status change and an ammo transaction (this would have caught ARM-02).
- **Complexity:** M

---

## 4. Cross-module integration gaps and terminology inconsistencies

### Integration gaps
1. **Personnel → Armory:** Separation and deactivation ignores issued weapons, off-duty authorizations and personal rifles (ARM-08). The armory shows former members as "Unknown User".
2. **Range / Qualifications → Armory:**
   - The lockout policy is not enforced (ARM-09).
   - Range malfunctions are not linked to firearms (ARM-10).
   - Personal-rifle qualification is attested by checkbox (ARM-30).
   - The off-duty qualification check is officer-level, not weapon-level (ARM-27).
   - Range-day firearm pickers do respect `condition_status === "In Service"` (`src/lib/range/open-attendance-firearms.ts:45-47`), which is good. But that is the only consumer of armory status outside the armory itself.
3. **Ammunition ↔ Range Days:** Range use is entered as a free-text "Record Use" with a reference. It is not linked to a range day, roster or officer, so per-officer or per-event round consumption cannot be reconciled.
4. **Notifications:**
   - Firearm alerts are computed only from current status. There are no due-date alerts (ARM-18) and no off-duty expiry alerts (ARM-25).
   - Personal-rifle expiry alerts stop at the expiry date (ARM-31).
   - No event is written when a weapon is issued to or recalled from an officer.
5. **Command dashboard:** No armory, ammunition, off-duty or rifle data reaches `src/app/api/command-dashboard`, and ammo reports are 403 for command staff (ARM-34).
6. **Certifications:** The armorer certification is enforced only on off-duty inspections (ARM-19).
7. **Equipment / Fleet ↔ Armory:** QR labels exist for equipment and vehicles but not for firearms, and they do not resolve on phones (ARM-01).
8. **Audit trail fragmentation:** Armory changes are recorded in five places:
   - `audit_events`, written by the trigger. Actor is `auth.uid()`, which is null for the service-role writes used by ammo, off-duty and personal rifles. Those rely on stamped fields.
   - `audit_log`, written by the firearm edit RPC.
   - `firearm_status_history`.
   - `personal_rifle_status_history`.
   - `off_duty_firearm_history`.
   No screen unifies them per weapon (ARM-07).
9. **Support mode:** `resolveServerAccess` sets `db: admin` in platform-support mode (`src/lib/tracepoint/server-access.ts:244`). Armory writes made in support mode therefore bypass RLS and record `auth.uid()` as null in trigger audits. This needs operational validation that support actions are attributed elsewhere.

### Terminology inconsistencies
- **Firearm status:**
  - Enum `firearms.status` (`in_service`, `assigned`, `missing`, …) versus text `condition_status` ("In Service", "Out of Service", …).
  - "Retired" status versus "Archived" (`is_active=false`).
  - Inspection results ("Passed" / "Failed" / "Needs Maintenance" / "Removed from Service") versus off-duty results ("Pass" / "Fail") versus checklist items ("Pass" / "Fail" / "N/A"). The staging test sends "Pass" to the duty-inspection API.
  - The "Removed from Service" result maps to "Out of Service", and the service recommendation "Remove from Service" changes nothing.
- **Off-duty inspection status:** The RPC uses "Current" / "Not Inspected". The list uses "Current" / "Due Soon" / "Overdue" / "Not Inspected". The detail route adds "Failed" and "Not Required". A failed inspection reads "Not Inspected" in one place and "Failed" in another.
- **Off-duty status fields:** `request_status`, `authorization_status` and `compliance_status` are all stored, but the list recomputes authorization and compliance on read. Stored and displayed values can differ, for example after expiry.
- **Actions:** "Issue / Assign / Assignment" and "Return" in the custody UI, versus "custody" in the tab name and labels. "Inspection Required" is both a status and an alert kind.
- **Ammunition:** "Receive / Issue / Return / Adjust" (relational API) versus "Purchase Received / Range Issue / Physical Count / …" (JSON UI). "Reconciliation" means both a per-type physical count (JSON) and the seasonal certified cycle (relational).
- **Personal rifles:** "Armorer Denied" versus "Denied" (chief). "Suspended" and "Revoked" exist here but not for off-duty firearms.
- **Firearm type:** Lowercase enum values (`handgun`) for duty weapons versus free text ("Handgun") for off-duty requests and personal rifles.
- **Manufacturer:** "Make" (firearms, off-duty) versus "Manufacturer" (personal rifles, ammunition).
- **QR labels:** Printed labels say "Equipment custody" for every non-vehicle kind (`TracePointQrLabel.tsx:105`). "Copy Link" error text says "vehicle link" even on equipment labels.

---

*Every reference above came from reading files in `/home/user/tracepoint`. No application code, tests or SQL were executed, and nothing in the repo was modified.*
