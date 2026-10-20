# TracePoint Operational Workflow, Usability & Product Quality Audit

**Audit date:** 2026-10-20  
**Code baseline:** `jphares65/tracepoint` `main` @ `a3677a6` (2026-10-07); `jphares65/tracepoint-landing` @ `32ad5d6`  
**Type:** Read-only inspection and recommendation exercise. No source code, migrations, infrastructure, deployments or data were changed.

| Document | Contents |
|---|---|
| **This file** | Executive summary, method, workflow inventory, role assessments, systemic themes, cross-module issues, prioritized backlog, commercialization gating |
| [Appendix A – Armory](appendix-a-armory.md) | Firearms, custody, inspections, ammunition, off-duty, personal rifles, QR (ARM-01 – ARM-36) |
| [Appendix B – Range & Qualifications](appendix-b-range-qualifications.md) | Range days, scoring, drills, evidence, qualifications, remediation (RNG-01 – RNG-36) |
| [Appendix C – Training, Certifications & Notifications](appendix-c-training-notifications.md) | Agency training, certifications, training alerts, inbox, email (TRN-01 – TRN-38) |
| [Appendix D – Fleet & Equipment](appendix-d-fleet-equipment.md) | Vehicles, inspections, work orders, equipment custody and readiness (FLT-01 – FLT-24, EQP-01 – EQP-15, GEN-01) |
| [Appendix E – Administration, Onboarding & Oversight](appendix-e-admin-onboarding.md) | Provisioning, users, permissions, settings, import, help, dashboards, landing-site claims (ADM-01 – ADM-36) |
| [Appendix F – Architecture reconciliation](appendix-f-architecture-reconciliation.md) | Status of 83 earlier recommendations (ARC-01 – ARC-83) plus 5 new blockers |
| [Appendix G – Runtime validation](appendix-g-runtime-validation.md) | What was actually executed, and with what result |
| [Finding index](finding-index.md) | All 186 workflow findings with classification, priority and complexity |

Each finding in Appendices A–E records the affected module, the real-world scenario, file:line evidence, the proposed correction, the user benefit and the implementation complexity (S/M/L).

---

## 1. Executive summary

**Verdict.** TracePoint covers an impressive breadth of public-safety accountability: firearms, ammunition, range and qualifications, agency training, certifications, off-duty carry, personal rifles, equipment, fleet, a command dashboard, a multi-tenant platform console and AI-assisted import. Most individual screens are thoughtfully designed. **As an operational system, though, it is not yet ready for commercial rollout.** The gaps are not cosmetic. They sit in the three properties an accountability platform is bought for:

1. **Records must be durable and correctable with an audit trail.** Range scoring, the system's highest-stakes field workflow, silently stops saving after an ordinary score correction (RNG-01). Setting a planning field locks a range day before anyone shoots (RNG-03). Training-alert acknowledgement and escalation history lives only in one browser's localStorage (TRN-20). Ammunition has three ledgers that do not agree (ARM-03).
2. **The system must tell the right person when something is due or wrong.** Every alert (certification expiry, equipment expiry, critical vehicle defect, qualification failure) is computed only when the affected user opens their inbox, and only for that user (TRN-01, TRN-06, FLT-05, EQP-02). Nothing in the repository schedules email delivery (TRN-08). Supervisors and armorers are never told about their people's problems.
3. **Modules must act on each other.** A catastrophic malfunction on the range does not take the weapon out of service (RNG-05). Range results never become official qualification records (RNG-06). The qualification-failure lockout is configurable and on by default but is never evaluated (ARM-09, RNG-17). Closing a training class does not issue certifications (TRN-03). Deactivating an officer does not check the firearms, equipment or vehicles they hold (ADM-05, ARM-08, EQP-01).

Beyond those three, the audit found:

- **A new agency cannot self-onboard.** Bulk-imported users can never activate their accounts (ADM-01). The platform owner has no supported way to create a new agency's first administrator (ADM-02). Help documents a "Forgot password" link that does not exist (ADM-07).
- **The mobile and field experience is not built for the field.** Printed QR labels encode a `tracepoint://` URI that no phone or page can open, and the app has no scanner (ARM-01, FLT-04). The app has no offline support, PWA manifest or service worker. Core field screens are wide desktop tables with 9–10 px controls (FLT-16, RNG-30). Officers cannot attach a photo to a vehicle damage report (FLT-03).
- **Many settings appear to work but do nothing.** Examples include MFA required, session timeout, department timezone, per-credential reminder schedules, fleet return-to-service approval, service intervals and escalation hours (ADM-13, ADM-14, TRN-07, FLT-06). Agencies will believe they have configured controls that are not enforced.
- **Two database-level issues need attention before any further production use:**
  - `update_firearm_with_audit` is a `SECURITY DEFINER` function that any user can execute, has no authorization check, and takes the department and actor IDs as parameters (ARM-04).
  - A deactivated user can create a new tenant with themselves as Administrator (ADM-03).

**There is a clear, tractable path.** Most Critical items are small (S) or medium (M) fixes in well-located code. A large share of the High items reduce to four architectural moves already anticipated in the project's own docs:

- **(a) Range data into relational tables.** Move range results out of the single per-department JSON document and into the relational tables that already exist.
- **(b) A scheduled notification engine.** Add a server-side scheduled evaluator with supervisor routing.
- **(c) A personnel holdings and offboarding service** shared by armory, equipment and fleet.
- **(d) A PR quality gate with route-level tests.**

Section 8 gives the prioritized backlog. Section 9 says what must be done before commercialization and what can follow.

### Headline numbers

| | Count |
|---|---|
| Workflow findings (A–E) | 186 |
| — Confirmed defects (code read shows the failure path) | 111 |
| — Verified usability problems | 37 |
| — Potential gaps requiring operational validation | 24 |
| — Optional improvements | 14 |
| Priority: Critical / High / Medium / Low (as assessed per module) | 9 / 57 / 88 / 32 |
| Earlier architecture recommendations reconciled (Appendix F) | 83 (23 implemented and verified · 6 implemented, not verified · 30 partial · 16 not implemented · 3 superseded · 5 undeterminable) |

---

## 2. Method and evidence standard

- **Scope.** All 39 page routes, 98 API route handlers, `src/lib` domain code, 75 Supabase migrations (schema, RLS, RPCs), tests, the help content, the navigation shell, and the public landing site.
- **Approach.** For each module, realistic scenarios were traced end to end through UI component → API handler → database write / RPC / RLS policy. Interactions were counted from the UI structure. Every finding cites file:line evidence.
- **Classification standard** (as the brief requested):
  - **Confirmed defect:** code that was actually read shows the failure path.
  - **Verified usability problem:** the code works as written, but the workflow imposes unnecessary steps, confusion or risk.
  - **Potential gap requiring operational validation:** depends on runtime configuration, live data or agency practice not visible in the repo.
  - **Optional improvement.**
- **Independent re-verification.** The most consequential Critical findings were re-read line by line by the lead auditor, separately from the module reviews:
  - RNG-01: `src/lib/range/workspace-mutation.ts:99-137` with `src/app/range-days/page.tsx:3355,3464-3476`
  - RNG-03: `workspace-mutation.ts:50-53`
  - TRN-01/06: `src/app/api/notifications/route.ts:452`, and no scheduler references `email-dispatch`
  - FLT-01: `api/fleet/vehicles/[vehicleId]/route.ts:120-121`; no UI sends `clearStatusOverride`
  - ARM-04: `supabase/migrations/20260822184500_add_missing_make_attention.sql:1-60`; no revoke and no `auth.uid()` check
  - ADM-01: `api/settings/onboarding/personnel/route.ts:141`, `src/lib/ai-importer/server/execution.ts:45`, `src/lib/tracepoint/activation.ts:326-333`
  - EQP-09: `supabase/migrations/202608190001_equipment_assignment_history.sql:39-40`
- **Runtime validation.** See [Appendix G](appendix-g-runtime-validation.md) for exactly what was executed. **No authenticated staging or production environment was available to this audit.** No end-to-end workflow was exercised through the authenticated UI with synthetic records. **No finding in this report claims that a workflow was tested in a running application unless Appendix G says so.** The authenticated UI walk-throughs the brief envisaged remain to be done (recommendation Q-3).
- **Limits.**
  - Live database grants, constraints and Supabase project settings (email templates, auth settings) may differ from the tracked migrations. The affected findings say so: ARM-02, ARM-04, EQP-09, TRN-08, ADM-28.
  - **No standalone "previous architecture assessment" exists in either repository or in the GitHub history.** Appendix F reconciles against the 17 architecture, readiness, permission and pilot documents in `docs/` and `infra/README.md`, which together form the prior assessment corpus. If a different document was intended, Appendix F should be re-run against it.

---

## 3. Workflow inventory

The detailed per-module inventories (route, API, purpose, roles) are in each appendix, section 1. Consolidated view:

| Module | Workflows | Primary roles | Operational purpose |
|---|---|---|---|
| **Firearms / Armory** | Inventory add/edit/archive/restore; issue and return (custody, magazines); condition status; armorer inspections; documents | Armorer, Inspector, Command | Weapon register and chain of custody |
| **Ammunition** | Receive lot, record use, physical count (JSON ledger UI); seasonal reconciliation count → submit → certify (relational) | Armorer, Range staff, Command | Ammunition accountability |
| **Off-duty firearms** | Officer request → inspection → reviewer approve/deny/return | Officer, Inspector, Command | Off-duty carry authorization |
| **Personal rifles** | Owner submit → armorer review → chief approval; suspend/reinstate/revoke | Officer, Armorer, Chief | Patrol-rifle program |
| **Range days** | Plan day, drills, roster/attendance, equipment, readiness, packet, scoring (scheduled or open/rolling), malfunctions, target-photo evidence, AAR, close-out | Range Master, Instructor | Firearms training and qualification |
| **Drill library & documents** | Templates, qualification components, course documents | Range Master | Standardized courses of fire |
| **Qualifications** | Status by officer and weapon type; history import; evidence; quick qualification camera | Range staff, Supervisor, Command | Qualification currency |
| **Training Alerts / Remediation** | Alert inbox, remediation assignment, escalation | Training coordinator | Corrective training |
| **Agency training** | Courses, events, roster/attendance/outcomes, close-out, certificates PDF, requirements | Training coordinator | In-service training |
| **Certifications** | Credential records, types, requirements, readiness | Training/cert manager | Licenses and certifications |
| **Notifications** | My Home actions, `/notifications` inbox, preferences, email queue/dispatch | All | Due and overdue awareness |
| **Equipment** | Asset types, issue/assign (officer, vehicle, location), lifecycle, expiry/inspection dates, QR labels, readiness | Quartermaster, Command | Vest, TASER, radio and BWC accountability |
| **Fleet** | Vehicle register, status, quick inspection checklist, issue reports, work orders, PM, documents, vehicle equipment, fleet rules, QR | Fleet manager, Mechanic, Officer | Vehicle readiness |
| **Command & Analytics** | Command dashboard (cards, operations panel, customization), analytics, branded reports | Command staff | Oversight |
| **Administration** | Agency profile, organization lists, users and roles, role-permission matrix, rules engine, branding, audit log, security policy | Agency administrator | Configuration |
| **Import / Export** | Classic import (6 entity types), AI-assisted importer, multi-file migration, data exports, report builder | Agency administrator | Onboarding and data portability |
| **Platform** | Create agency, module entitlements (Super Admin), support mode, agency detail | TracePoint staff | Tenant provisioning and support |
| **Identity** | Login (password or magic link), activation, admin reset or assigned password, idle-session guard | All | Access |

**Navigation map and hidden routes:** Appendix E §1a–1b. Notable points:

- `/platform` is not linked from the nav.
- `/settings/command-dashboard-analytics` is orphaned.
- `/notifications` and the personal-rifle submission page are not discoverable by officers.
- `/import` and `/inspections` are legacy redirects.

---

## 4. End-to-end assessments by role

Interaction counts are estimated from the UI structure. They are not timed sessions.

### 4.1 Patrol officer
| Task | Experience | Key findings |
|---|---|---|
| See what I owe (expiring certs, quals, gear) | My Home shows self-only alerts, but they are generated only when the officer opens the page. Some alerts show an "Acknowledge" button that the API rejects (409). | TRN-01, TRN-13 |
| Get an email reminder before expiry | By default, no advance email is ever sent; the first email arrives after expiry, and only if something external runs the dispatcher. | TRN-05, TRN-08 |
| Change my notification settings | Not reachable: Help sends officers to `/settings`, which is admin-only. | ADM-06 |
| Start-of-shift vehicle inspection on a phone | About 9–11 taps, and only if a fleet permission was granted (the default `officer` role has none). The table is 1,260 px wide, controls use 9 px text, and every item defaults to Pass. No photo can be attached, and a blank odometer saves as 0. | FLT-15, FLT-16, FLT-10, FLT-03, FLT-09 |
| Scan a QR label on a car or vest | Does not work: the label encodes `tracepoint://…`, which the phone cannot open, and the app has no scanner. | FLT-04, ARM-01 |
| Request off-duty carry | Works (about 12 fields). No renewal path after expiry: the serial number is permanently blocked. | ARM-25 |
| Submit outside training for credit | Not possible: officers have no self-submission. They must email the coordinator. | TRN-09 |
| Forgot password | No link on the login page; Help says there is one. Call an admin. | ADM-07 |

**Verdict:** the officer experience is mostly read-only and pull-based. The main field tasks (vehicle inspection, QR lookup, evidence photos) are not mobile-ready.

### 4.2 Supervisor / Sergeant
- **No concept of a team, squad, shift or subordinate exists anywhere** (TRN-14, ADM-15). A sergeant either gets department-wide permissions (over-exposure) or sees only themselves (no oversight). Units and groups exist in Settings but nothing uses them.
- Supervisors receive no alerts about their people's expiring credentials, failed qualifications or equipment (TRN-06, EQP-02).
- Reviewing off-duty requests works. However, reviewers can approve their own requests (ARM-26), and no revoke or suspend action exists (ARM-24).
- **Verdict:** the role name "Supervisor" promises oversight the product does not provide. This is the largest gap for day-to-day adoption.

### 4.3 Range Master / Range Instructor
- **Planning a 30-officer qualification day takes about 100 or more interactions.** Officers are added to the roster one at a time from a single select (RNG-29). Times are free text. The readiness checklist pushes users to set Packet Status = Ready, which **permanently locks the day before shooting** (RNG-03).
- **The default Instructor role cannot run a line.** It cannot mark attendance, so the scoring board is empty, and it cannot add walk-ups or upload target photos (RNG-07, RNG-12).
- **Scoring:**
  - About 13 taps plus digits per 10-shooter line, as one total per component. There is no per-string entry.
  - Typed but unsaved scores are silently discarded when a walk-up is added (RNG-08).
  - **Correcting a saved score makes every later save for the department fail silently** (RNG-01). The page shows "Saved" based on local state only.
  - Two instructors on separate tablets overwrite or lock each other out (RNG-13).
  - With no connectivity, a reload shows an empty page. Reconnecting overwrites unsynced local scores (RNG-02).
- **Remediation:** a same-day re-shoot cannot clear "Failed" (RNG-10). Remediation must be created in a different module under a different permission (RNG-16).
- **Close-out:** one unconfirmed tap, irreversible, with no amendment path (RNG-04). The after-action report (AAR) becomes read-only at close-out (RNG-21). Nothing flows to official qualification records, ammunition or the armory (RNG-06, RNG-20, RNG-05).
- **Verdict:** the range module is the most feature-rich part of TracePoint, and the most fragile. Its persistence model must change before a range staff relies on it as the record of qualification.

### 4.4 Armorer
- **Issue and return** is solid: about 6–7 interactions, server-checked, and a unique index prevents double issue.
- **Returns and custody history:**
  - A return records no observed condition and no separate "received by" (ARM-12).
  - **Past assignments are never shown anywhere** (ARM-07). Chain of custody cannot be reviewed in the UI.
- **Lost or stolen weapons:**
  - There is no lost or stolen workflow (ARM-05).
  - Archiving a stolen gun requires recording a fictitious return (ARM-06).
  - Restore wipes the archive reason (ARM-13).
- **Inspections:**
  - Every checklist item defaults to Pass (ARM-15).
  - The "critical item failed means the inspection fails" rule is enforced only in the browser (ARM-16).
  - A "Passed" result never restores the weapon to service (ARM-17).
  - Duty weapons have no inspection due dates (ARM-18).
- **Ammunition:**
  - The page writes a JSON ledger, while reconciliation and reports read different tables (ARM-03).
  - One person can count, submit and certify a reconciliation (ARM-23).
  - On a clean install, the status-history and relational ammunition tables do not exist (ARM-02).
- **Verdict:** the custody core is sound. Lifecycle, inspection and ammunition controls need tightening before an auditor or prosecutor relies on them.

### 4.5 Fleet manager / Mechanic
- Inspections create work orders automatically. However, **any manual status change permanently disables automatic out-of-service** for that vehicle (FLT-01). A later critical brake defect therefore leaves it "Available".
- Each inspection opens a new work order for a defect that is already known (FLT-07). The inspection write is not atomic (FLT-08).
- The odometer can roll back when an old work order is edited or an issue is reported (FLT-02).
- Configured service intervals, return-to-service approval, warning days, escalation hours and email settings are not enforced (FLT-06).
- There is no vehicle checkout or return, and "assigned to" is free text (FLT-12). Accidents are only an "Issue" category (FLT-13).
- **Verdict:** this is a useful vehicle register with inspections. The automation that justifies a fleet module is unreliable.

### 4.6 Quartermaster (Equipment)
- Issuing one item takes about 8 actions through a 15-field modal. **Issuing to an academy class of 25 recruits, 5 items each, takes about 1,000 interactions**, because there is no bulk or kit issue (EQP-07).
- Expiry tracking covers only "required" equipment types held by officers. AED pads in cars and spare TASERs are never checked (EQP-03). Only the holder sees the alert (EQP-02).
- Gear held by a separated officer shows as "Unassigned" and cannot be marked lost or out of service without first being unassigned (EQP-01, EQP-04).
- There are no inventory counts, no equipment inspections (such as TASER spark tests) and no lost or stolen state (EQP-10, EQP-14, EQP-08).

### 4.7 Training coordinator
- **A 30-person in-service class takes about 150 or more interactions:**
  - The roster is built one officer at a time (TRN-17).
  - Attendance, outcome and hours are set per row.
  - Choosing an outcome forces "Present", including for no-shows (TRN-04).
  - Event times drift by the UTC offset on every edit (TRN-02).
  - **Close-out issues no certification records**, so each credential must be re-keyed (TRN-03).
- There is no per-officer training-hours total or transcript (TRN-21), the core artifact for state POST/POST-equivalent compliance.
- Configuring training requirements requires Settings access that coordinators usually lack, and the training hub still says "Coming next" (TRN-31).

### 4.8 Command staff
- **Command Dashboard:**
  - Data-load failures are shown as "No requirements configured" or as empty lists (ADM-10).
  - Drill-downs land on module front pages, not on the record (ADM-11).
  - Range trend cards read tables that nothing populates (RNG-06).
- **Reports:**
  - The report builder is inside the admin-only Import/Export page, so command staff cannot open it (ADM-09).
  - Ammunition reports return 403 for command staff (ARM-34).
  - Dashboard and Analytics have no export or print.
- **Department readiness views** silently return only the viewer's own equipment row (EQP-11).
- **Verdict:** command staff cannot currently trust an empty or green dashboard to mean "all clear", which is the dashboard's whole purpose.

### 4.9 Agency administrator
- Settings is broad and mostly understandable. The permission descriptions are good.
- **Problems:**
  - The Configuration Status panel always shows green (ADM-17).
  - Re-importing the roster resets everyone to "Officer" and can reactivate separated officers (ADM-04).
  - The three importers give contradictory guidance (ADM-24).
  - Security controls are saved but not enforced (ADM-13).
  - Roles are a fixed global list (ADM-16).
  - The audit log viewer shows the last 100 events with no filters (ADM-12).
- **Separation has no offboarding workflow** (ADM-05). Deactivation flips a flag. It does not:
  - check firearms, equipment or vehicles still held;
  - cancel open requests;
  - disable the login. The separated user can then create their own tenant (ADM-03).

### 4.10 Platform owner (TracePoint staff)
Provisioning takes more than 20 steps. It needs a URL that is not in the nav, then support mode to enable modules. **The first-admin step is broken**: import, then activation fails (ADM-01, ADM-02). The workaround is an undocumented support-mode "Assign Password". The agency's onboarding status never moves past `agency_created`.

### 4.11 Can an unfamiliar department configure and use TracePoint without the developer?
**No, not today.** Provisioning, module entitlement and first-admin activation require TracePoint staff and an undocumented workaround. After that, an administrator could configure Settings. Without help, they would be misled by:

- the always-green configuration checklist;
- the unenforced security settings;
- Help content that marks live modules "Coming soon" and points to a non-existent Forgot Password link;
- the role-stripping re-import.

**Fixing ADM-01/02/04/06/07/08/13/17 (mostly S/M) would make guided self-service realistic.** Making it fully unaided would also need:

- a first-run setup checklist driven by real configuration state;
- sample or seed configuration (qualification standards, certification types, fleet checklist);
- an in-product getting-started guide for each role.

---

## 5. Mobile and field workflows (assessed independently)

TracePoint has **no native mobile app**. "Mobile" means the responsive Next.js web pages. Findings:

| Field task | Status | Evidence |
|---|---|---|
| **QR scanning** | **Non-functional end to end.** Labels encode `tracepoint://{kind}/{id}` (`src/lib/tracepoint/qr-identifiers.ts:6`). No route, protocol handler or PWA manifest resolves it, and the custody lookup cannot parse it. No camera scanning code exists in `src` (no `BarcodeDetector`, `getUserMedia`, zxing, jsQR or html5-qrcode). Firearms have no labels. The vehicle dialog nonetheless tells users to "Scan with a mobile device". | ARM-01, FLT-04 |
| **Range scoring** | Usable on a tablet with connectivity. Not designed for gloves or outdoors: 32 px camera buttons, stacked tabs and small text. **No offline mode**, and save state is misleading. | RNG-02, RNG-08, RNG-30 |
| **Fleet inspection** | Desktop table layout (`min-w-[1260px]`), 9 px buttons and no photo capture. No saved draft, so an interruption loses the checklist. `?tab=` deep links are ignored. | FLT-03, FLT-11, FLT-16, FLT-17 |
| **Equipment accountability** | No "My gear" mobile view. The self-service custody API (check-out and check-in with condition) has no UI. | EQP-06, EQP-13 |
| **Evidence photos** | `capture="environment"` exists only for qualification evidence. It fails for instructors and for imported results (RNG-12). | RNG-12 |
| **Offline/PWA** | No service worker, web app manifest, IndexedDB or `navigator.onLine` handling anywhere in `src`. | (lead-auditor check) |

**Recommended minimum mobile package** (High priority, about M overall):

1. Change QR payloads to HTTPS deep links (`https://<host>/q/{kind}/{id}`) that resolve through login, and print labels for firearms too.
2. Add a `/scan` page using the browser `BarcodeDetector` API, with a manual serial or unit-number fallback.
3. Build mobile card layouts for the fleet inspection, "My gear" and the scoring line.
4. Wire photo capture into fleet inspections and issue reports.
5. Add a persistent "saved to server / not saved – retry" indicator and draft persistence for inspections and scoring.

Full offline range scoring (a queued-mutation sync) is a later, larger investment (L).

---

## 6. Systemic themes (root causes behind many findings)

1. **Pull-only, self-only notification engine.**
   - Alerts are computed inside `GET /api/notifications` for the requesting user (`route.ts:452`, `:682`). No scheduler exists, and no supervisor, armorer, fleet-manager or quartermaster routing exists.
   - Email dispatch (`/api/notifications/email-dispatch`) has no invoker in the repo.
   - Alert fingerprints include day counts, so snoozes reset daily.
   - *Drives:* TRN-01/05/06/08/10, FLT-05, EQP-02, ARM-18/25/31, RNG-16.
2. **Department-wide JSON documents instead of records.**
   - Range days, the ammunition ledger and remediations each store a whole department's data in one JSON column, which the browser rewrites on every change. Training-alert state is in localStorage.
   - This produces last-write-wins conflicts, whole-document "audit" snapshots every ~650 ms, ID churn that trips server integrity checks, and data invisible to the relational dashboards.
   - *Drives:* RNG-01/02/06/11/13/27, ARM-03/21, TRN-20, ARC-01/05/77/83.
3. **Configured but unenforced policy.**
   - Settings exist for: qualification-failure lockout, MFA, session timeout, timezone, retention, reminder schedules, fleet service defaults, return-to-service approval, escalation and fleet-manager roles.
   - No code consumes them.
   - *Drives:* ARM-09, RNG-17, ADM-13/14/17, TRN-07, FLT-06.
4. **No personnel-holdings model.**
   - Firearms reference a `user_id`, equipment references a `user_id`, a vehicle or a location, and fleet uses free-text `assigned_to`.
   - Nothing answers "what does Officer X hold?", so separation, transfer and audits cannot be supported.
   - *Drives:* ADM-05, ARM-08, EQP-01/04/05, FLT-12/18.
5. **No organizational hierarchy in authorization.**
   - Units, groups and titles exist only as pick-lists. Permissions are department-wide or self-only.
   - *Drives:* TRN-14, ADM-15, EQP-11, TRN-26, RNG-28.
6. **Three permission layers that disagree.**
   - The UI gate, the API check (often followed by service-role queries that bypass RLS) and the RLS policies are separate copies of the rules, and no test compares them.
   - *Drives:* FLT-14, EQP-11, ADM-09, ARM-34, RNG-07, ARC-K3.
7. **Business rules enforced only in the browser.** Examples: inspection pass/fail logic, reconciliation expected quantities, and off-duty qualification override.
   - *Drives:* ARM-16/23/27.
8. **No quality gate on application code.**
   - No PR or `main` workflow runs the app tests, `tsc`, lint or build.
   - 0 of 98 API handlers have tests. 17 of 79 test files are regex scans of source text, including every permission test. No Playwright specs exist, although Playwright is a dependency.
   - *Drives:* ARC-K2, ARC-64, RNG-36, ARM-36, FLT-24, ADM-36.

---

## 7. Cross-module consistency issues

Detailed tables are in each appendix, section 4. The most consequential:

| Area | Inconsistency | Consequence |
|---|---|---|
| **Status vocabularies** | Firearms: enum `status` versus text `condition_status`; "Retired" versus "Archived". Equipment: `active/out_of_service/removed` (and a schema CHECK with `maintenance/expired`). Fleet: `Available/Attention/Maintenance/Out of Service/Retired`. Qualifications: "Overdue", which the dashboard calls "Expired". | Users cannot learn one mental model; reports disagree |
| **"Inspection"** | Means four different things (fleet checklist, armorer inspection, off-duty inspection, equipment date field). `/inspections` redirects to firearms. | Navigation confusion |
| **"Issue"** | Fleet: a reported problem. Equipment: handing gear to an officer. | Misread fleet tiles |
| **"Training"** | Four separate record systems: agency training, certifications, qualifications and remediation. "Training History" links to range qualifications. | Duplicate entry; officers and coordinators look in the wrong place |
| **Alerts** | Three inboxes: My Home, `/notifications` and Training Alerts. Off-duty events are never emailed. There is no global unread badge. | Missed actions |
| **Agency / Department / Tenant** | Used interchangeably. Five names exist for platform staff. | Onboarding confusion |
| **"Pilot" in production** | `/api/pilot/*` endpoints drive production features. Agencies default to `pilot/pilot`. A real agency name appears as placeholder text. | Credibility with buyers |
| **Dates/time** | 19 separate date formatters, all in browser time. The department timezone is ignored. Training event times shift by the UTC offset. | Wrong times on legal records |
| **Save patterns** | Global Save plus per-panel Save in Settings. `window.prompt` for renames and status reasons. No unsaved-changes guard. Range shows a "Saved" pill based on local state only. | Lost edits; false confidence |
| **CSV** | Three CSV writers (only one guards against formula injection) and two parsers (one breaks on multi-line cells). | Data corruption and a spreadsheet-injection risk (ADM-25) |
| **Audit trail** | `audit_events` (trigger; actor null for service-role writes), `audit_log` (RPC), plus per-module history tables. No per-record unified history view. | Weak chain of custody presentation |

---

## 8. Prioritized improvement backlog

The items below consolidate the 186 findings into actionable work packages. Priority reflects operational and accountability risk to an agency. Complexity: **S** is up to about 2 days, **M** about 1–2 weeks, and **L** more than 2 weeks for one engineer familiar with the code. "Gate" marks whether an item must be done **before commercial rollout (P0)** or **may follow in an early release (P1)** or **a later release (P2)**.

### Critical
| # | Work item | Findings | Operational justification | Cx | Gate |
|---|---|---|---|---|---|
| C-1 | **Lock down unsafe database functions.** Revoke `EXECUTE` on `update_firearm_with_audit` from `public`/`authenticated` and derive the actor and department from `auth.uid()`/membership. Audit *every* `SECURITY DEFINER` function for grants. Restrict `create_department_with_owner` to platform admins. Verify the live grants. | ARM-04, ADM-03 | Cross-agency record tampering and forged audit authors undermine the product's core claim. A separated officer can create a tenant. | S | P0 |
| C-2 | **Make range scoring durable and correctable.** Use stable result IDs, update in place with a revision record, and surface save failures persistently ("Not saved – retry"). Decouple Packet "Ready" from the lock, confirm before finalize, and add an admin amendment path with a reason. Stop discarding unsaved scores. | RNG-01, RNG-03, RNG-04, RNG-08, RNG-11, RNG-23 | Today an ordinary score correction silently stops all saving. Instructors believe results are saved when they are not. A qualification record that cannot be trusted is a liability. | M | P0 |
| C-3 | **Scheduled notification engine with role routing.** Add a server-side scheduled job (EventBridge or ECS scheduled task) that evaluates readiness for all members. Route to the officer **and** to the responsible role (supervisor, armorer, quartermaster, fleet manager, range master). Invoke `email-dispatch` on a schedule. Make "due soon" emails on by default. Use stable alert fingerprints. | TRN-01, TRN-05, TRN-06, TRN-08, TRN-10, FLT-05, EQP-02 | An accountability platform that warns nobody until the officer happens to log in, and never warns the supervisor, cannot prevent lapses. | L | P0 |
| C-4 | **Fleet status automation override.** Make the override expire on the next automated event (or offer "Return to automatic"). Never leave a vehicle "Available" when a critical defect is open. | FLT-01 | A patrol car with a reported critical brake defect can stay available for assignment. | S | P0 |
| C-5 | **Fix the onboarding and activation chain.** Imported users must be able to activate. Add "Invite first administrator" on the platform agency page. Add a self-service Forgot Password. | ADM-01, ADM-02, ADM-07 | Without this, every new agency needs developer intervention, and officers who forget a password are locked out until an admin intervenes. | S–M | P0 |
| C-6 | **Schema reproducibility.** Add tracked migrations for `firearm_status_history` and the relational ammunition tables. Reconcile the equipment `lifecycle_status` CHECK. Add a CI check that a clean bootstrap supports every API write path. Diff staging and production schemas against migrations. | ARM-02, EQP-09, ARC-K-series | A new agency's environment (or a disaster-recovery rebuild) would fail on status changes, ammunition and equipment out-of-service. | M | P0 |
| C-7 | **Separation / offboarding clearance.** Before deactivation, list everything the officer holds (firearms, equipment, vehicles, open off-duty, personal-rifle and remediation items). Require disposition, or record an "outstanding property" exception. Disable the login. Keep former holders visible on assets. | ADM-05, ARM-08, EQP-01, EQP-04, EQP-05 | Recovering agency property at separation is the single most common accountability failure TracePoint is meant to prevent. | M | P0 |
| C-8 | **Application quality gate.** Run `tsc`, lint, the app tests, `next build` and the clean-bootstrap validation on every PR and on `main`. Add route-level tests for the critical write paths in C-1 to C-7 (auth, tenant-negative, happy path, failure). Add a Playwright smoke test for the officer, range and armorer flows. | ARC-K2, ARC-64, ARC-28, RNG-36, ARM-36, FLT-24, ADM-36 | Every defect class above would have been caught by a basic route test. Without a gate, regressions will reach agencies. | M | P0 |

### High
| # | Work item | Findings | Operational justification | Cx | Gate |
|---|---|---|---|---|---|
| H-1 | **Range → official qualification record.** Close-out writes `qualification_results`, with firearm, range day and expiry. Count only closed days. Treat drill type "Any" correctly. Use attempt order, not the date only, for same-day re-shoots. | RNG-06, RNG-09, RNG-10, RNG-24, RNG-25 | Qualification status is the legal artifact. Today it is recomputed in the browser from a JSON document and is wrong in common cases. | L | P0 |
| H-2 | **Range ↔ Armory linkage.** A catastrophic malfunction sets the firearm out of service with history and notifies the armorer. Enforce the configured failure lockout at issue and at the range. | RNG-05, RNG-17, ARM-09, ARM-10 | A failed weapon can be handed to the next shooter. A default-on policy the agency believes is active does nothing. | M | P0 |
| H-3 | **Instructor role can run a line.** Allow attendance, walk-ups and evidence upload under `score_range_days`. Key evidence to durable result IDs. | RNG-07, RNG-12 | The default role cannot perform its job. | M | P0 |
| H-4 | **Training records integrity.** Store server-side, timezone-aware event times. Close-out issues certifications. No forced "Present". Preserve recorded-by attribution. Handle deactivated attendees. | TRN-02, TRN-03, TRN-04, TRN-11, TRN-12, ADM-14 | Wrong times and attendance on training records are a liability in litigation and in state compliance audits. | M | P0 |
| H-5 | **Remediation and Training Alerts on the server.** Use row-level records linked to the triggering range result. Acknowledgement, escalation (with real notification) and resolution are audited. | TRN-20, RNG-16 | An accountability action history that lives in one browser's storage does not exist for audit purposes. | M–L | P0 |
| H-6 | **Need-to-know on training and range data.** Restrict reading other officers' scores, remedial notes and certifications to roles with a reason to see them. | TRN-26, RNG-28 | Personnel-record privacy expectations, and agency and union acceptance. | S–M | P0 |
| H-7 | **Supervisor/team scoping.** Add a supervisor (or unit) relationship on membership. Scope readiness views and alert routing to the team. Fix department-scope readiness. | TRN-14, ADM-15, EQP-11 | The Supervisor role is currently meaningless. This is the key driver of daily adoption. | M–L | P0 |
| H-8 | **Hide or implement every inert setting.** Either enforce MFA, session timeout, retention, reminder schedules and fleet service defaults, or remove them from the UI. Make the configuration checklist reflect reality. | ADM-13, ADM-17, TRN-07, FLT-06 | Agencies will attest to controls (MFA, for CJIS-aligned policy) that are not active. | S (hide) / M (implement) | P0 (hide at minimum) |
| H-9 | **QR deep links and scanner** (see §5). | ARM-01, FLT-04 | A printed label that goes nowhere damages credibility on day one. | S–M | P0 (deep link) / P1 (scanner) |
| H-10 | **Firearm lifecycle and inspections.** Add Lost/Stolen/Destroyed/Transferred with a disposition record. Archive without a fake return. Show the custody history timeline. Inspection items start unset. Enforce the critical-fail rule server-side. A Pass restores service. Add duty-weapon inspection due dates. | ARM-05, ARM-06, ARM-07, ARM-13, ARM-15, ARM-16, ARM-17, ARM-18 | Chain of custody and inspection integrity are what an armory audit or court subpoena examines. | M | P0 for ARM-06/07/15/16; P1 rest |
| H-11 | **Single ammunition ledger.** One relational ledger written by the UI, with actor per transaction. Separation of duties in reconciliation (counter ≠ certifier). Server-computed expected quantities. Range day consumption posts transactions. | ARM-03, ARM-21, ARM-22, ARM-23, RNG-20, ARM-34 | Ammunition reconciliation is a recurring audit finding in agencies. Three disagreeing numbers defeat the purpose. | L | P1 (P0 if marketed) |
| H-12 | **Off-duty lifecycle.** Revoke or suspend. Renewal from an expired authorization. Block self-approval. Make policy-required qualification non-overridable and weapon-specific. A failed inspection suspends authorization. | ARM-24 to ARM-28 | Carrying under an authorization that should have been revoked is a direct liability exposure. | M | P0 for ARM-24/26; P1 rest |
| H-13 | **Fleet field integrity.** Monotonic odometer. Blank is not zero. Photo evidence UI. De-duplicate work orders for known defects. Atomic inspection write. Officer access to inspections by default. | FLT-02, FLT-03, FLT-07, FLT-08, FLT-09, FLT-15 | Inspection records and mileage drive maintenance cost and liability for vehicle defects. | M | P1 |
| H-14 | **Equipment readiness scope and bulk issue.** Check expiry for all tracked items (vehicle, pool and location). Department-level alerts to the quartermaster. Bulk and kit issue. | EQP-03, EQP-02, EQP-07 | Expired AED pads and armor are safety failures. Academy issue currently takes about 1,000 clicks. | M | P1 |
| H-15 | **Command reporting that can be trusted.** Show errors as errors. Drill down to the record. Give command staff access to the report builder and ammunition reports. Add CSV/PDF export for the dashboard and analytics. | ADM-09, ADM-10, ADM-11, ARM-34 | Command staff must be able to tell "no problems" from "failed to load", and must be able to produce council and accreditation reports. | M | P0 for ADM-10; P1 rest |
| H-16 | **Self-service and help accuracy.** Personal notification preferences reachable by every role. Officer self-service pages in the nav. Help content matches the product. Remove "Coming soon" from live modules. | ADM-06, ADM-08, ADM-34, TRN-31 | Reduces support calls and is necessary for unassisted adoption. | S | P0 |
| H-17 | **Safe personnel re-import.** Re-import must never strip roles or reactivate separated officers without explicit confirmation. Use one importer behavior across all three tools. | ADM-04, ADM-24 | An administrator refreshing the roster can silently remove every supervisor's access. | S–M | P0 |
| H-18 | **Per-officer training transcript and outside-training submission.** Hours totals by period. Officer submits a certificate, and the coordinator verifies it. | TRN-21, TRN-09 | Core artifact for state training-hour mandates. Removes email back-and-forth. | M–L | P1 |
| H-19 | **Range mobile and offline resilience.** Scoped local queue with replay, conflict handling between devices, and glove-friendly controls. | RNG-02 (full), RNG-13, RNG-30 | Ranges are often outdoors with poor connectivity. | L | P1 |

### Medium (selected; see the finding index for all 88)
| # | Work item | Findings | Cx | Gate |
|---|---|---|---|---|
| M-1 | Bulk roster building (by unit, rank or "due for qualification") for range days and agency training | RNG-29, TRN-17 | M | P1 |
| M-2 | Vehicle assignment, pool checkout and return, and accident report with photos and supervisor review | FLT-12, FLT-13 | M–L | P1 |
| M-3 | Equipment inventory count/audit, equipment inspections (TASER spark test, armor check), lost/stolen state | EQP-08, EQP-10, EQP-14 | M | P1 |
| M-4 | Audit log viewer: filters, per-record history, audited exports; unify `audit_log`/`audit_events` presentation | ADM-12, ARM-07 | M | P1 |
| M-5 | Leave, light-duty and waiver handling for readiness | TRN-15 | M | P1 |
| M-6 | Unified inbox (one notification surface, unread badge, filters, off-duty email) | TRN-19, TRN-22, TRN-24 | M | P1 |
| M-7 | CSV formula-injection guard on all exports; robust CSV parser | ADM-25 | S | P0 (security hygiene) |
| M-8 | Show raw database and provider errors only in logs; give users sanitized messages | ADM-32, ARM-33 | S | P0 |
| M-9 | Terminology and status vocabulary normalization (see §7), and a product glossary | §7 | M | P1 |
| M-10 | Fleet ↔ Equipment single model for in-vehicle equipment | FLT-18 | M | P2 |
| M-11 | Drill library as its own page, with versioned templates; drill document versioning | RNG-31, RNG-32 | M | P2 |
| M-12 | Agency-defined roles (custom roles) | ADM-16 | M | P2 |
| M-13 | Transfer history (rank, unit, assignment) with effective dates | ADM-35, ADM-18 | M | P2 |

### Low
Cosmetic, copy and clean-up items, including:

- 36 `.backup`/`.bak` files inside `src/app`;
- 11 stale page copies at the repository root (`*-page.txt`, `*-route.txt`);
- an empty `docs/AUTH_SETUP.md` and a boilerplate `README.md`;
- the orphaned `/settings/command-dashboard-analytics`;
- dead quick-create forms;
- snooze options;
- label copy ("Equipment custody" on every label).

See the finding index (all items with priority Low). These are P1 hygiene items, except that **removing pilot/dev language and real-agency placeholder text from customer-facing UI is P0** (ADM-30, ADM-31) for commercial credibility.

---

## 9. Commercialization gating

### Must be complete before broader commercial rollout (P0)
1. **Security and tenancy:** C-1, and M-7/M-8 (hygiene). Also an independent tenant-isolation test, which is also ARC-28/ARC-55.
2. **Record integrity:** C-2, C-6, H-1, H-4, H-5, and the H-10 subset (no fake returns, custody history, server-side inspection rules).
3. **Alerting that actually alerts:** C-3, C-4, H-2.
4. **Accountability at separation:** C-7.
5. **Onboarding without the developer:** C-5, H-16, H-17, and H-8 (at minimum, hide inert settings).
6. **Roles that match their names:** H-3, H-6, H-7.
7. **Field credibility:** the H-9 deep link (labels that open), and the H-15 dashboard error states.
8. **Engineering gate:** C-8. Plus the outstanding production gates from Appendix F that are not product work but block go-live:
   - ARC-38 agency cutover approval;
   - ARC-42 backup/PITR restore validated;
   - ARC-75 pilot checklist (0 of 156 checked);
   - ARC-K3 the MFA policy.
9. **Marketing alignment:** remove landing-site claims that are not backed by code (ADM-31: unit-level readiness, supervisor exception views, reports for supervisors), or ship the corresponding features first (H-7, H-15).

**Rough effort for P0:** about 10–14 engineer-weeks. It is dominated by C-3, H-1, H-7 and C-8. The other items are S/M fixes in well-localized code.

### Suitable for early follow-on releases (P1)
H-11 ammunition single ledger (unless ammunition is a headline selling point), H-12 remainder, H-13, H-14, H-18, H-19 (full offline), H-9 in-app scanner, M-1 to M-6, M-9.

### Later releases (P2)
M-10 to M-13, the partner `/api/v1` (ARC-70), completing the Cognito/AWS data-provider conversion (ARC-60 to ARC-63), and custom report builder enhancements.

---

## 10. Reconciliation of earlier architecture recommendations (summary)

Full table: [Appendix F](appendix-f-architecture-reconciliation.md). Of 83 recommendations extracted from the prior assessment corpus:

| Status | Count |
|---|---|
| Implemented & verified by test or committed evidence | 23 |
| Implemented, not verified | 6 |
| Partially implemented | 30 |
| Not implemented | 16 |
| Superseded / no longer applicable | 3 |
| Cannot determine from repo | 5 |

Key points:

- **Supabase remains the only runtime auth and data provider.** There are about 541 `.from` calls and 56 `.rpc` calls. The Cognito, SES and Postgres-session code is tested but not wired in (`server-provider.ts:8`). S3 is the only switchable AWS provider.
- **The browser-local workspace problem identified in `backend-source-audit.md` is only partly resolved** (ARC-01, ARC-77, ARC-83):
  - Off-duty requests and the inbox are now persisted on the server.
  - Range Days still falls back to `localStorage`, and its server copy is a single JSON blob.
  - Training-alert state is localStorage-only, as migration `202609060001` itself acknowledges.
- **Critical open architecture items:**
  - No PR quality gate (ARC-K2).
  - No route-level tests (ARC-64).
  - No behavioral tenant-isolation suite in CI (ARC-28).
  - PITR or backup restore not validated (ARC-42).
  - Agency cutover approval not recorded (ARC-38).
  - The pilot checklist has never been run (ARC-75).
- **Newly observed architecture issues:**
  - K1: concurrent-edit loss in JSON workspaces.
  - K3: the MFA setting is not enforced.
  - K4: no email-dispatch scheduler.
  - K5: three pages of 5,000–7,700 lines, plus backup files in `src`.
  - Missing HSTS and CSP headers.
- **Stale documentation:**
  - `aws-provider-conversion-status.md` still says no S3 provider exists.
  - `infra/README.md` still marks the attachment bucket as deferred.
  - `training-alert-permission-hardening.md` describes permissions that were later retired.

---

## 11. Recommended next steps

1. **Q-1 (this week):** C-1 and C-4. Small, isolated, and they close the most serious exposure. Verify the live database grants for ARM-04 and the live CHECK constraint for EQP-09.
2. **Q-2:** Stand up the PR quality gate (C-8) before starting the backlog, so fixes do not regress.
3. **Q-3:** Provide an authenticated staging tenant with synthetic personnel. Run the role walk-throughs in §4 through the real UI (desktop and phone) to confirm or retire the 24 "operational validation" findings. Record the results against the Readington pilot checklist.
4. **Q-4:** Sequence the remaining P0 work as:
   - C-2/H-3 (range durability);
   - C-5/H-16/H-17 (onboarding);
   - C-3/H-7 (notifications and supervisor scope, designed together);
   - C-7 (offboarding);
   - H-1/H-2/H-4/H-5 (cross-module records).
5. **Q-5:** Freeze new modules until the P0 list is closed, as the project's own `refinement-plan.md` already prescribed.
