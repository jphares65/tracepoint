# TracePoint UI/UX audit: web application and mobile web

- **Date:** 2026-10-22
- **Type:** read-only assessment. No code, migrations or deployments were changed.
- **Scope:** every route, modal, table and form in the web app; the public marketing site; the mobile-web experience.
- **Companion work:** the operational defect audit (OA), `docs/operational-audit-20261020/` on `origin/claude/tracepoint-operational-audit-w567t8`. This report cross-references OA IDs (`ARM-…`, `RNG-…`, `TRN-…`, `FLT-…`, `EQP-…`, `ADM-…`) and does not repeat its findings. It also responds to GitHub issue #11 and stays clear of the permission-matrix work in #10.

---

## 0. How to read this report

### Baseline

`origin/main` (2026-10-07) is **not** the current product. Staging runs Cognito sign-in, which exists only on the remediation line. Every finding was therefore checked twice:
1. against `main`;
2. against the release candidate (RC) `origin/claude/integration-defects-20261020` @ `5b6cc00` (candidate code `5b9ec98`).

All `path:line` references in the appendices point into the RC. Findings already fixed in the RC are shown as fixed, not counted.

### Evidence levels

| Label | Meaning |
|---|---|
| **Verified (staging)** | Observed on `https://staging.tracepointhq.com` on 2026-10-22 with a real browser (Chromium, 1440×900 and 390×844 touch). Screenshots are in [`evidence/`](evidence/). |
| **Source-evident** | The RC code unambiguously renders or behaves this way, for example a literal string, a missing loading branch or a default value. It is high confidence, but **not** observed in a running UI. |
| **Suspected** | A likely usability problem that needs live confirmation. |

### Limits

- **No authenticated staging access was available.** Only the signed-out experience (landing, sign-in, auth error paths) was exercised live. The OA was in the same position (OA README §1, Q-3).
- Every in-app finding is therefore Source-evident or Suspected. None claims an observed defect.
- The authenticated walk-throughs in issue #11 (officer, instructor, armorer, fleet manager, supervisor, admin) remain to be run with synthetic accounts. §7 lists the acceptance checks to run.

### Native mobile app

A native iOS/Android client exists. It uses `tracepoint://auth`, `/api/mobile/**` and the QR resolver, but its source is **not in either repository** (`docs/remediation/NATIVE-STAGING-BUILD.md`: "Local / not pushed"). It could not be audited.

"Mobile" in this report means the web app at phone width. The two QR-dependent field flows (vehicle inspection by scan, equipment custody by scan) work only in that native client. Native-app UX is listed as an open gap (§7).

### Finding types

Every finding is classified as one of:
- **Functional defect:** the UI behaves wrongly, for example lost input, wrong feedback, a dead control or a request that always fails.
- **Usability:** friction, confusion, extra steps or poor field ergonomics.
- **Aesthetic:** visual polish only.

### Totals

- 352 findings were raised.
- 9 are fixed in the RC and 4 are obsolete, leaving **339 open**.
- Of the open findings, 44 are the same issue as an OA finding and 118 overlap one. **177 are UX-only.**

| Open findings | Critical | High | Medium | Low |
|---|---|---|---|---|
| Functional defect | 5 | 41 | 30 | 3 |
| Usability | 2 | 37 | 126 | 53 |
| Aesthetic | — | — | 14 | 28 |

### Appendices

Module-by-module detail, with every finding, its screen, evidence, RC status, OA reference and recommendation:
- [A: Shell, navigation, Home, sign-in, design-system inventory](appendix-a-shell-navigation-design-system.md)
- [B: Range Days, Qualifications, Training, Certifications, Agency Training, Training Alerts, Analytics](appendix-b-range-qualifications-training.md)
- [C: Armory (firearms, ammunition, reconciliation, inspections, personal rifles, off-duty)](appendix-c-armory.md)
- [D: Equipment, Fleet, vehicle inspections, Inventory, QR](appendix-d-equipment-fleet-inventory.md)
- [E: Settings, Users & Roles, rules panels, Import/Export, Platform, Super Admin](appendix-e-settings-admin-import-platform.md)

---

## 1. Executive assessment

**Maturity: functional, but not yet a product system. That is level 2 of 5.**

| Level | Description |
|---|---|
| 1 | Prototype |
| **2** | **Feature-complete islands** (TracePoint today) |
| 3 | Consistent system |
| 4 | Optimised for roles and the field |
| 5 | Best in class |

TracePoint covers an unusually broad operational surface: armory, range, training, certifications, fleet, equipment, inventory, notifications and administration. It also has a recognisable visual identity, a dark slate theme with a blue accent. At a glance it looks cohesive.

Used for real, it behaves like **about 30 independently built applications that share a sidebar**:
- Each page builds its own header, modals, buttons, status colours, loading and empty states, and success and error messages.
- The RC fixed a great deal of data correctness, but added UI in the same ad-hoc way. Every design-system metric got slightly worse between `main` and the RC.

| Design-system signal (RC, `src/app`, excluding `api/`) | Count |
|---|---|
| Hand-built full-screen overlays (`fixed inset-0`) / shared Dialog component | 26 / **0** |
| Browser `confirm` / `prompt` / `alert` dialogs, used for audited reasons and destructive actions | 17 / 7 / 5 (main: 14 / 6 / 4) |
| Toast system / `beforeunload` unsaved-changes guards | **0 / 0** |
| Distinct button class strings / distinct "primary blue" variants | 359 / 90 (main: 321 / 84) |
| Arbitrary pixel font sizes / of which 10px or smaller | 1,036 / 445 |
| Local status-colour maps / local badge or pill components | 12 / 10 |
| Tables forced wider than a phone (`min-w-[860–1260px]`) | 13 |
| Native `<select>` elements vs. shared searchable picker usages | 136 / 1 |
| Leftover backup source files under `src/` | 33 (main: 48) |

### What is working

- **The tone is consistent.** Dark slate cards, lucide icons and a professional, non-gimmicky voice in most operational copy.
- **Some components are already good and can serve as templates:**
  - `FleetWorkOrderDialog` (mobile bottom sheet, sticky header and footer);
  - `AssignPasswordModal` (inline error, busy state);
  - the dirty-tracking and Reset in `RangeQualificationRulesPanel`;
  - Fleet's URL-synced filters and sortable headers;
  - the new `SearchablePicker`;
  - the RC's range save-status indicator ("Saving… / Saved / Save failed – Retry").
- **The RC removed several of the worst range and admin traps:**
  - Packet "Ready" no longer locks a day (RNG-03).
  - Removing a roster officer no longer deletes their results (RNG-22).
  - Scorers can mark attendance (RNG-07).
  - Officers can reach My Notifications (ADM-06).
  - Agency Training no longer completes with an unsaved roster (TRN-18).

### What keeps it from feeling commercially mature

1. **Feedback appears where the user isn't looking.** In at least five modules, validation and server errors are written to a page banner behind the open modal or drawer, so **Save appears to do nothing**: certifications (B-49), vehicles and all equipment modals (D-08), Users & Roles (E-01), off-duty drawers (C-48) and firearm issue/return below 1440px (C-09). Success is similarly off-screen or absent.
2. **Several forms are safe only if the user does extra work.**
   - Inspection checklists start fully "Pass": firearms C-03 = ARM-15, fleet D-04 = FLT-10.
   - Vehicle issue reports default to "Safe to operate" (D-10).
   - Returned magazines are prefilled (C-08).
   - An unknown firearm status displays as "In Service" (C-02).
   - A Completion drill shows "Complete" but saves nothing or Incomplete (B-05).

   For a public-safety system these defaults matter more than any visual polish.
3. **Developer, vendor and roadmap text ships to customers.**
   - "The next build step is wiring the New Inspection button…" (C-04).
   - "Save currently validates… Next step is connecting this to the inspection database/API", although Save **does** change firearm status (C-06).
   - "Files and certificates are the next build phase" (B-56), "Excel support can be added after we lock the field mappings" (E-38), "AWS Cognito identity service" on the sign-in page (Verified, V-03), a printed QR label reading "Verified." (C-59) and Help that contradicts the product (A-51).
4. **Wayfinding breaks at the edges.**
   - Signing in always lands on Home and drops the requested page (A-64).
   - Inbox "Open" goes to a module list, not the record (A-31).
   - Settings tabs are not addressable by URL, so links into them land on the wrong tab (E-08).
   - Multi-agency users have no switcher (A-09).
   - A failed or cancelled sign-in shows a raw JSON page (A-65, Verified V-06).
5. **The phone experience is an afterthought.**
   - 445 uses of text at 10px or smaller.
   - Checklist and scoring targets of about 22–30px (D-07, C-29, A-26).
   - Thirteen tables that need horizontal scrolling.
   - Eight Range Day tabs stacked vertically above the scoring board (B-14).
   - On a phone, the signed-out front door hides "Sign in" until 6,869px down the page (A-49, Verified V-07).
6. **One concept goes by many names.** For example:
   - Agency / Department;
   - Officer / Personnel / User / Member;
   - Issue / Assign / Custody;
   - Return (custody) vs Return (to service);
   - Inbox / Operational Inbox / Priority Action Queue / Training Alerts Inbox / Officer Inbox;
   - Archive / Remove / Delete.

   There are two equipment custody models with no cross-links (D-72), and duplicate editors for certification requirements, equipment requirements, personal-rifle rules and fleet rules.

### Bottom line

The fastest route to "one polished enterprise application" is **not** a redesign. Three things deliver most of the benefit at low risk:
- about 12 shared primitives (§4);
- a content pass to remove developer copy and unsafe defaults;
- fixing where feedback appears.

Most of the 339 findings collapse into those three work streams. The top 10 in §5 are all S-effort, or mechanical M-effort.

---

## 2. Verified on staging (signed-out surfaces)

| # | Finding | Type / impact | Evidence |
|---|---|---|---|
| V-01 | **Sign-in is a two-screen hand-off to an unbranded default Cognito page.** The TracePoint page ("Continue with secure sign-in") hands off to a grey AWS template: an empty grey header bar, no TracePoint logo, the browser tab title "Signin", the placeholder "name@host.com" and default AWS blue. Officers who have just seen a branded page then type credentials into a page that looks unrelated, which invites phishing doubt and support calls. | Usability · High | [`mobile_cognito.png`](evidence/mobile_cognito.png), [`desktop_cognito.png`](evidence/desktop_cognito.png) |
| V-02 | **The hosted email field is not phone-friendly.** It is `type="text"` with no `autocomplete`/`inputmode`, so there is no email keyboard and weaker password-manager pairing. Inputs are 34px tall. Empty submit relies on the browser bubble "Please fill out this field." | Usability · Medium | [`mobile_cognito_empty_submit.png`](evidence/mobile_cognito_empty_submit.png) |
| V-03 | The sign-in page tells users "Authentication and MFA are completed by TracePoint's AWS Cognito identity service." That is vendor detail on a customer screen. Its value tiles say "Built for range staff" on a product that also covers fleet, equipment and administration. | Aesthetic / content · Low | [`desktop_login.png`](evidence/desktop_login.png) |
| V-04 | The logo PNG renders inside a visible darker rectangle on the sign-in page at both widths, because the image background doesn't match the page. | Aesthetic · Low | [`desktop_login.png`](evidence/desktop_login.png), [`mobile_deeplink_login.png`](evidence/mobile_deeplink_login.png) |
| V-05 | **Positive:** every protected URL redirects to `/login?next=<path>`, so the deep link survives the first hop. The source shows it is then dropped at the Cognito callback (A-64, Source-evident). That could not be exercised live without credentials. | — | `/login?next=%2Ffirearms%3Fx%3D1` observed |
| V-06 | **Sign-in failure is a raw JSON page.** `GET /api/auth/cognito/callback?error=access_denied`, which Cognito sends when a user cancels, and any expired or invalid flow return HTTP 401 with the body `{"code":"authorization_rejected"}` and clear the session cookies. There is no message, no link back and no retry. (A-65) | Functional defect · High | `curl` on staging, 2026-10-22 |
| V-07 | **On a phone, the signed-out front door hides sign-in.** `/` redirects to the `/landing` marketing page. Its header "Sign in" is hidden below the `sm` breakpoint; the only visible link is "Agency Sign In" at y = 6,869px of a 7,194px page. "Request a Demo" points to `/login`. An officer whose session expired and who opens the bookmark sees a sales page. (A-49) | Functional defect · High | [`mobile_root_viewport.png`](evidence/mobile_root_viewport.png); DOM probe |
| V-08 | Every app page has the same browser tab title, "TracePoint". With several tabs open, an armorer cannot tell Firearms from Range Days. Public pages also log a 401 from `/api/access` to the console, which is harmless but untidy. | Aesthetic · Low | page titles observed |

---

## 3. Module-by-module findings (summary)

Each subsection lists the issues that matter most. The full tables are in the appendices.

**Legend.** "= OA" means the OA owns the defect; this report adds only the UX angle. **UX-only** means the issue is not in the OA.

### 3.1 Shell, navigation, Home, sign-in (Appendix A)

**Screens:**
- `TracePointShell` (sidebar, mobile drawer, agency interstitial, appearance overrides);
- `/` My Home (Priority Action Queue);
- `/notifications`;
- `/command-dashboard`;
- `/help`;
- `/login`, Cognito hosted UI, `/landing`, `/unauthorized`, `/activate`, `/auth/setup`.

**Findings:**
- **Functional, High:**
  - A-64: the sign-in destination is lost.
  - A-65 / V-06: raw JSON failure pages.
  - A-49 / V-07: sign-in hidden on phones.
  - A-03: the "balanced" and "high-contrast" appearance overrides match `hover:` classes, so every inactive nav item looks selected and the active state disappears.
- **Usability, High:**
  - A-09: no agency switcher; Help points to a control that doesn't exist.
  - A-31: Inbox "Open" goes to module index pages.
  - A-26: Home actions are about 28px tall with 9–11px text.
  - A-47: the idle sign-out has no countdown, runs per tab, and an idle second tab can end the session of the active one (Suspected for multi-tab).
  - A-60: wide tables.
- **Structural:**
  - The shell is mounted separately by all 30 pages, so every navigation refetches access and collapses nav groups (A-01, A-02).
  - `/training`, `/settings/command-dashboard-analytics` and `/personal-rifle-review/[id]` are reachable only by URL.
- **Terminology:** see §4.3.

### 3.2 Range Days, Qualifications, Training (Appendix B)

**Screens:**
- `/range-days`: list, a day with 8 tabs, the scoring board (mobile cards and a desktop grid), and the printable packet;
- `/qualifications`;
- `/training` hub;
- `/training/certifications`, with 3 modals;
- `/agency-training`: event editor, roster board, closeout;
- `/training-alerts`;
- `/analytics`.

**Fixed in the RC:** B-06 (= RNG-03), B-10 (= RNG-22), B-22 (= RNG-07), B-54 (= TRN-18).

**Partly fixed:** B-01, the save status is now visible (= RNG-01). The remaining open findings:
- **Critical, UX-only.** B-05: on Completion drills the toggle shows "Complete" by default but saves nothing, or Incomplete if a note was typed, so the record is wrong.
- **High, UX-only:**
  - B-16: a manual Pass/Fail override is silently replaced the next time the score is edited.
  - B-69: one server-rejected value stalls every later save. The only signal is an 11px "Save failed", and rows stay green "Saved".
  - B-70: "Changed on another device → Reload" discards typed scores without warning.
  - B-55: switching Agency Training events drops roster edits.
  - B-49: certification modal errors are hidden behind the modal.
- **High, OA-owned:**
  - B-60 (= TRN-20): alert acknowledge and resolve are stored only in the browser.
  - B-09 (= RNG-21): the AAR locks at completion.
  - B-14 (= RNG-30): phone tab stack.
  - B-08 (~ RNG-04): no correction or reopen after finalize.
- **Field ergonomics:**
  - Two different save buttons on phones (B-13).
  - Save feedback lands in the scrolled-off header (B-11, partly fixed).
  - No "save & next run" or "unscored only" filter (B-15).
  - The desktop grid is forced to 1,040px on 1024px tablets (B-18).
- **Information architecture (IA):**
  - The Training hub has two cards that open the same page, omits Agency Training, and still says Requirements is "Coming next" (B-46).
  - Each area has a different name in the nav, the H1 and the hub (B-47).
  - Readiness is computed three times, with three vocabularies, in Analytics, Alerts and Qualifications (B-67).
  - Officers get department lists instead of "my record" (B-42, B-51).

### 3.3 Armory (Appendix C)

**Screens:**
- `/firearms`: Standard and Focus views; detail panel with the Custody, Restricted and Documents tabs and a "…" menu; Add card;
- `/firearms/[id]`;
- `/firearms/ammunition`, with 6 tabs;
- `/firearms/ammunition/reconciliation`;
- `/firearms/inspections`;
- `/firearms/inspections/new`, a 19-item checklist;
- `/firearms/personal-rifles`;
- `/off-duty-firearms`, with 2 drawers.

**New in the RC: C-63, functional defect, High, UX-only.** The new "Physical Custody → Transfer to Secure Storage / Return to Assigned Officer" form on `/firearms/[id]` posts `{toHolderType, …}`. The RC custody API accepts only `{action: "CHECK_OUT" | "CHECK_IN", …}` and returns 400. **Every transfer from this page fails.**
- Evidence: `src/app/firearms/[firearmId]/page.tsx:255-266` vs `src/app/api/armory/firearms/[firearmId]/custody/route.ts:35-36`.
- The OA counts this form toward ARM-14 without noting the failure. Recommend handing this to the defect-remediation owner before release.

**Other open findings:**
- **Critical:**
  - C-01 (= ARM-14): in Focus view, the drawer sends armorers to a read-only page for issue and return.
  - C-02 (UX-only): an unknown or null status displays as "In Service".
  - C-03 (= ARM-15): a pre-passed checklist.
- **High, UX-only:**
  - C-11: "Available" counts out-of-service guns.
  - C-04, C-05, C-06: inspection developer copy; no inspection history anywhere; after saving, the user is redirected to an empty page; the copy says status won't change, but it does.
  - C-07, C-48: double-submit on inspection save and off-duty decisions.
  - C-37: reconciliation is blank when loading fails.
  - C-09, C-10: issue and return feedback is off-screen below 1440px, and the first firearm is auto-selected.
  - C-41: officers who submit personal rifles have no nav path to the page.
  - C-44: Revoke, Suspend and Deny run without confirmation, and every action reports the generic "workflow updated".
- **Duplication:**
  - Two physical-count flows with no link between them (C-31 = ARM-03).
  - Personal rifles and off-duty are parallel workflows with different patterns and different status words (C-40).
  - Three different inspection forms.
  - Five local status-badge maps.
  - Personal-rifle rules can be edited in two places (C-46).
- **Step counts.**
  - Issue: 5–7 interactions with no summary.
  - Return: 4–5 interactions with magazines prefilled.
  - Starting an inspection from the work queue: 3 clicks plus finding the firearm again.

  See Appendix C, "Workflow step counts".

### 3.4 Equipment, Fleet, Inventory, QR (Appendix D)

**Screens:**
- `/equipment`: inventory table, officer readiness, 4 modals, QR label;
- `/fleet-management`: table, filter drawer, 26-field vehicle modal;
- `/fleet-management/[id]`: 6 tabs, Quick Inspection, work-order dialog, equipment dialog, documents;
- `/inventory` (new in the RC): checkout form, outstanding checkouts;
- `/settings/fleet`;
- the Equipment Rules panel.

**QR.** Labels encode `tracepoint://vehicle|equipment/<id>`. In the RC they resolve **only inside the native app** (B5). A phone camera or browser without the app cannot open them. The web modal still says "Scan with a mobile device to open this vehicle". The OA owns this as FLT-04 / ARM-01. **UX angle:** make the web copy honest now, and decide the web-only scan story with the OA owner (D-01, D-02, D-03).

**Open findings:**
- **Critical:** D-04 (= FLT-10). Every vehicle checklist item starts as Pass, with the copy "Mark only what changed" and "Ready for one-tap submission". That copy actively encourages rubber-stamping brakes, lights and belts.
- **High, UX-only:**
  - D-58: "Inspection saved. Vehicle remains ready." can display while the vehicle is on a critical safety hold, and the audit warning is dropped.
  - D-10: issue operability defaults to "Safe to operate".
  - D-12: history hides which items failed.
  - D-13: managers have no fleet-wide view of failed inspections, open work or holds.
  - D-60: a safety hold is visible on only one card.
  - D-07: Pass/Defect/Critical buttons are about 22px tall with 9px text.
  - D-27, D-28: comma lists erase commas as you type; Fleet Rules silently show defaults when loading fails, and saving overwrites the real rules. Since F2, these role codes decide who may inspect.
- **Inventory (new, all UX-only):**
  - D-62: recipients are shown as raw UUIDs.
  - D-63: the officer picker lists only the clerk unless the clerk holds unrelated permissions.
  - D-65: double taps duplicate append-only ledger entries.
  - D-70: the form says consumables are "used up as issued", but there is no issue or use action.
  - D-72: equipment custody and inventory checkout use conflicting models and vocabulary, with no cross-links.
- **Step count.** Officer, vehicle inspection on a phone with web only: about 8–9 taps plus typing, through a 1,260px table. The native-app QR path is not auditable.

### 3.5 Settings, administration, import, platform (Appendix E)

**Screens:**
- `/settings` (one 5,058-line component): 9 tabs; Rules Engine with 8 sub-tabs; Invite, Edit member, Role permissions and Assign Password modals;
- `/notifications` preferences;
- `/settings/import-export`: classic wizard, Report Builder, Export Center, Templates, Onboarding;
- AI importer;
- Multi-file migration;
- `/platform`, `/platform/[id]`, `/super-admin`;
- the Support Mode banner.

**Open findings:**
- **Critical, UX-only.** E-04: the header "Save Rules Engine" is visible on all 8 sub-tabs but saves only the cycle and armory fields. It reports "Operational rules saved" while panel edits remain unsaved.
- **High:**
  - E-02 (UX-only): Save Access can wipe an officer's group assignments if the groups have not finished loading.
  - E-01: modal errors are hidden, including the new deliberate 409 "already a member".
  - E-06: no unsaved-changes guard; sub-panels unmount, and Refresh overwrites edits.
  - E-09: no settings search; the same field appears on two tabs.
  - E-11 (= ADM-29): the member list has no search.
  - E-12 (~ ADM-05): deactivation is an unconfirmed switch. In the RC it also disables Cognito login.
  - E-16 (= ADM-13): session timeout and MFA controls that don't apply.
  - E-35, E-41, E-42: the import page puts reports above the wizard; the preview shows only 25 rows and 30 issues; Import has no confirmation or progress and counts every personnel row as "Created".
  - E-39: "Employee Number" auto-maps to Badge.
  - E-50 (= ADM-22) and E-52: "Make Administrator" and agency-wide module switches are one unconfirmed click.
  - E-58 (new): the "Inbox Sources" checkboxes silently hide Critical items.
- **Fixed in the RC:**
  - E-20: officers can reach My Notifications (= ADM-06).
  - E-40: the CSV parser handles quoted line breaks (= ADM-25).

---

## 4. Platform-wide design standards and reusable components

### 4.1 Foundations

Define these once, in Tailwind v4 `@theme`, and delete the class-rewriting `AppearanceStyleOverrides` (A-03 to A-05).

| Token family | Standard |
|---|---|
| **Colour semantics** | Five status tones: `success`, `warning`, `danger`, `info`, `neutral`, each with a surface, border and text value tested at ≥4.5:1 on `slate-900`/`950`. The brand accent (blue, or an agency accent) is **never** a status colour. Today emerald is used as both accent and success (185 uses). Status is always paired with an icon or text, never colour alone. |
| **Text** | Minimum body text is 14px on desktop and 15–16px on field screens. 12px is the floor for secondary text. 11px is allowed only for uppercase eyebrows. Hint text is at least `slate-400`; the 37 uses of `slate-600`/`700` hint text fail contrast. Four heading sizes, so the 28 distinct H1 styles collapse into one page title style. |
| **Touch** | Field screens (Home, inspections, scoring, inventory checkout, the officer views) use ≥44px targets and ≥8px gaps. Dense desktop tables may use 36px. |
| **Space and shape** | Spacing on a 4/8 grid. Three radii: `lg` for inputs and buttons, `2xl` for cards, `full` for pills. Retire `rounded-[2rem]` and `rounded-3xl` heroes. |
| **Theme** | Dark by default. "High contrast" becomes a **per-user** preference, because officers in daylight need it; today it is agency-wide (E-19). |

### 4.2 Components

Most of these already exist somewhere in the codebase. Promote the best local version rather than writing new ones.

| Component | Replaces | Seed to start from |
|---|---|---|
| **AppShell** route-group layout with an access context | 30 per-page `<TracePointShell>` mounts and repeated `/api/access` fetches (A-01, A-02) | `TracePointShell` |
| **PageHeader**: eyebrow, title, description, primary and secondary actions, breadcrumb | About 8 header patterns, `ArmoryPageHeader` (unused) and `ArmorySectionShell` | `ArmoryPageHeader.tsx` |
| **Button**: 4 variants (primary, secondary, danger, ghost) × 3 sizes, with a built-in `busy` state | 359 class strings. Its `busy` state also fixes the double-submit family: C-07, C-48, D-65 and others. | — |
| **Field**: label, hint, error, required marker, correct `id`/`htmlFor` | Placeholder-only inputs (C-14, C-51, D-39) and Range Days' 45 labels with only 1 `htmlFor` | `fleet-management` `Field` |
| **SearchablePicker** for people, firearms, vehicles and locations | 136 native selects. The officer picker (C-15), firearm picker (C-28) and roster add (B-23) need it most. Harden it first (A-68). | `components/SearchablePicker.tsx` |
| **Dialog / Sheet**: Escape, focus trap, labelled close, **inline error slot**, sticky footer, mobile bottom sheet, dirty-close guard | 26 overlays (B-49, D-08, D-38, E-01, E-28) | `FleetWorkOrderDialog`, `AssignPasswordModal` |
| **ConfirmDialog / ReasonDialog**: states the consequence and the count ("Affects 14 members"), with a required reason where audited | 17 `confirm`, 7 `prompt` and 5 `alert` calls, plus the missing confirmations (C-44, E-50, E-52, E-13, B-61, C-35) | — |
| **Toast + InlineAlert**: one feedback channel, layered above dialogs, auto-dismissing for success and persistent for errors | 22 local message states and the hidden-banner pattern | — |
| **StatusBadge + status registry** (enum → label, tone, icon) | 12 colour maps, 10 pill components and raw enums shown to users (D-43, D-47, E-44) | — |
| **EmptyState / Skeleton / ErrorState with Retry**: never show "No records" while loading | B-24, B-40, B-63, C-26, C-37, C-53 | — |
| **DataTable with a mobile card mode**, sortable headers and URL-synced filters | 13 forced-width tables (A-60, B-50, C-39, D-16, D-44) | Fleet `SortableHeader` and `inventory-state` |
| **SaveBar**: sticky, shows dirty state, Reset, Save, last-saved time, plus `beforeunload` and route guards | 4 save models in Settings (E-04 to E-06, E-33), Fleet Rules (D-30) and Agency Training (B-55) | `RangeQualificationRulesPanel` |
| **Tabs**: URL-synced (`?tab=`), horizontally scrollable on phones, with an overflow menu | Settings (E-08, E-10), Range Days (B-14), Ammunition (C-36) | — |
| **SegmentedControl** (Pass / Defect / Critical / N/A, ≥44px, no default value) | Inspection and scoring toggles (C-29, D-07, B-05) | — |
| **EvidenceCapture**: one camera and upload flow with thumbnail and status | `QuickQualificationCamera`, `QualificationEvidence`, fleet evidence (B-20, D-05) | `QuickQualificationCamera` |
| **Formatters**: `formatDate`, `formatDateTime`, `formatEnumLabel`, person display name | Local copies of `formatDate`, `humanize` and `formatLabel` | `src/lib/format/date`, already shared in the RC |

### 4.3 Content standards

**Glossary.** Publish one glossary and enforce it in nav labels, H1s, Help and notifications:

| Use | Avoid | Reference |
|---|---|---|
| **Agency** | Department, in user-facing copy | — |
| **Officer** (a person on the roster); **User** only for account administration | Personnel, Member | — |
| **Issue / Return** (custody of a firearm or equipment) | Assign | C-62 |
| **Return to service** | Return | D-20 |
| **Out of service** | OOS | — |
| **Archive** (reversible) | Remove / Delete, except for true deletion | — |
| **Inbox** for `/notifications` and Home | Priority Action Queue, Operational Inbox, Officer Inbox | — |
| **Range Day** | Range & Training, as an H1 | — |
| **Qualification record** | Qualification History, Training History | — |

**Copy rules:**
- **No implementation, roadmap or vendor language in the product.** No Supabase, Cognito, "next build step", "Beta" or "deterministic". Run a release check that searches for these strings.
- **Consequence-first copy on state changes.** For example, "Saving a Failed result sets this firearm to Inspection Required", or "Deactivating ends this officer's sign-in immediately and leaves 2 firearms issued to them."
- **A scan is not a confirmation.** Labels and scan screens must not say "Verified" (C-59). Custody screens should name who confirmed what, and when.
- **Help is tested against the UI.** Extend `help-content.test.ts` so that every label Help names exists in the nav (A-51).

### 4.4 Interaction rules

1. **Safe by default.** No safety-relevant field starts in the "OK" state. This covers checklists, operability, returned quantities and unknown statuses. Bulk "All pass" is allowed only as an explicit, separate action. This is an agency policy decision for C-03 and D-04; the OA marks ARM-15 and FLT-10 as owner decisions.
2. **Errors appear where the user acted:** in the dialog, next to the field or next to the Save button. The page banner is reserved for page-level load failures.
3. **Every submit has a busy state and is idempotent from the user's view.** One tap creates one record.
4. **Every consequential or irreversible action states its effect and asks once:** finalize, certify, revoke, deactivate, grant admin, disable a module, remove from a roster. Routine actions do not ask.
5. **State is addressable.** Tabs, selected records and filters live in the URL. Every notification and inbox item links to the record. Sign-in returns the user to the page they asked for.
6. **Officers see "mine" first.** Qualifications, Certifications, Equipment and Firearms open on the signed-in officer's own record when the user lacks department-wide scope (B-42, B-51, C-42, D-17).

---

## 5. Top 10: the greatest usability benefit for the least implementation risk

All ten are front-end changes with no schema change. None removes a capability.

| # | Improvement | Fixes | Effort / risk | Why it ranks here |
|---|---|---|---|---|
| 1 | **Show errors inside the dialog or drawer.** Add an error slot to each modal now. It becomes part of the shared Dialog later. | B-49, D-08, E-01, C-48 (drawer), plus the 409/400 responses the RC added | S / very low | Today, Save appears to do nothing in five modules, and the RC added server validations that land invisibly. |
| 2 | **Safe defaults.** Show "Unknown" instead of "In Service" for unrecognised statuses. Make the Completion toggle match what is saved. Require an explicit operability choice. Leave "magazines returned" empty. Present an unset checklist plus an explicit "Mark all remaining as Pass" action, pending the owner decision. | C-02, B-05, D-10, C-08, C-03 / D-04 | S / low; the checklist part needs a policy decision | Prevents wrong records, which matters more than polish. |
| 3 | **Fix the sign-in path.** Carry `next` through the PKCE flow record. Redirect auth failures to `/login?notice=` with friendly copy. Show "Sign in" on mobile `/landing`, or send signed-out `/` to `/login`. Remove "AWS Cognito" from the copy. Brand the hosted UI (logo and CSS in Cognito managed-login branding). | A-64, A-65 / V-06, A-49 / V-07, V-01, V-03 | S / low; branding is configuration only | Every user meets this every day. Today it costs 2–4 extra navigations per deep link and looks broken when it fails. |
| 4 | **Busy and disabled state on every submit button** (a `SubmitButton` wrapper). | C-07, C-48, D-65 and every other submit without a busy state (Appendix A, A-58) | S / very low | Stops duplicate inspections, ledger entries and decisions on slow phone connections. |
| 5 | **Fix the record-page custody transfer contract.** | C-63 | S / low; route it through the defect-remediation owner | A new RC control that always fails. Hand it over before release. |
| 6 | **Content pass.** Delete developer, roadmap and vendor copy. Correct copy that is now wrong. Fix the "?" mojibake. Update Help. | C-04, C-06, C-13, C-56, B-34, B-39, B-56, B-64, D-48, E-23, E-24, E-25, E-38, C-47, C-59 ("Verified."), D-01 (web copy), A-51, B-46 | S / none | It is the single biggest jump in perceived commercial maturity, at zero risk. |
| 7 | **Loading is not empty.** Use a skeleton until data arrives, and an error state with Retry when loading fails. Never show "No records" or zero counts while loading. | B-24, B-40, B-63, C-26, C-37, C-53, A-35, D-28, C-57 | S / very low | Today a slow connection looks like lost data on Range Days, Qualifications, Alerts, Inspections and Reconciliation. |
| 8 | **Settings save integrity.** Hide or relabel the header Save on Rules sub-tabs. Disable Save until data has loaded, and keep it disabled after a load failure (member groups, Fleet and Off-Duty rules). Sync `?tab=`. Fix the comma-list inputs. | E-04, E-02, D-28, C-57, E-08, D-27 | S / low | Admins currently get "saved" messages for unsaved edits, and can silently overwrite policy or group membership. |
| 9 | **Field ergonomics on the four field screens:** Home, vehicle inspection, firearm inspection and range scoring. Use 44px segmented controls, a 12px text floor, a sticky Save with inline result, and a horizontal tab strip on Range Days. | D-07, C-29, A-26, D-53, B-11, B-13, B-14 | S per screen / low | The officer and instructor tasks happen standing, gloved and outdoors. |
| 10 | **ConfirmDialog and ReasonDialog.** Replace native `confirm`/`prompt`/`alert`, and add confirmation with a stated consequence to Revoke, Deny, Make Administrator, module disable, Resolve/Escalate alert and the type Archive. | 17 + 7 + 5 native dialogs; C-44, E-50, E-52, B-61, C-35, D-21, D-35 | M, mechanical / low | Audited reasons stop being typed into unstyled browser pop-ups, and irreversible actions stop happening on one tap. |

**Next tier.** These are worth doing right after the top 10, but carry more effort:
- Inbox "Open" → the record (A-31).
- "My record" defaults for officers (B-42, B-51, D-17).
- Fleet manager triage filters: last inspection failed, open work, safety hold (D-13, D-60).
- Settings search and member search (E-09, E-11).
- An agency switcher (A-09).

---

## 6. Prioritised improvement backlog

Grouped into work items by **user impact**. Each work item lists the finding IDs it closes; the appendices have the evidence for each. Within each priority, items are separated into **Functional defects**, **Usability** and **Aesthetic**. "OA" marks items whose defect is owned by the operational audit; those rows carry only the UX treatment.

### Critical

These can produce wrong records or misdirect a safety-relevant decision.

| ID | Work item | Findings | Class | Effort |
|---|---|---|---|---|
| CR-1 | Completion drills: the toggle display must match the saved value | B-05 | Functional (UX-only) | S |
| CR-2 | Unknown or missing firearm status shown as "In Service" | C-02 (and the same fallback in inspections and the record page) | Functional (UX-only) | S |
| CR-3 | "Save Rules Engine" reports success for unsaved panel edits | E-04, E-05, E-33 | Functional (UX-only) | M |
| CR-4 | Focus view is a dead end for issue and return | C-01 (= ARM-14 OA), C-25 | Functional | M |
| CR-5 | Alert acknowledge and resolve are local to one browser. Until the OA fix lands, label it "This device only". | B-60 (= TRN-20 OA), B-61 | Functional | M (S for the label) |
| CR-6 | Pre-passed inspection checklists and "one-tap submission" copy | C-03 (= ARM-15 OA), D-04 (= FLT-10 OA) | Usability (policy decision) | S–M |

### High

These are daily friction, hidden failures or likely mistakes.

**Functional defects:**

| ID | Work item | Findings | Effort |
|---|---|---|---|
| H-F1 | Record-page custody transfer always returns 400 | C-63 | S |
| H-F2 | Errors hidden behind modals and drawers | B-49, D-08, E-01, C-48 | S |
| H-F3 | Sign-in drops the destination; raw JSON failure pages; sign-in hidden on mobile `/landing` | A-64, A-65, A-49 (Verified V-06, V-07) | S |
| H-F4 | Double-submit on inspection save, off-duty decisions and inventory actions | C-07, C-48, D-65 | S |
| H-F5 | Range save robustness. One rejected value stalls every save. Reload discards drafts. A stale offline copy can overwrite the server. An override is replaced on edit. | B-69, B-70, B-03 (~ RNG-02 OA), B-16, B-04 (partly fixed) | M |
| H-F6 | Settings and rules load-failure overwrites; group wipe; comma inputs | D-28, C-57, E-02, D-27, D-32 | S |
| H-F7 | Vehicle inspection outcome messaging contradicts the safety hold; "Limited use" behaves like "Safe" | D-58, D-09 (= FLT-13 OA) | S |
| H-F8 | Inventory: raw-ID recipients, a self-only officer picker, no consumable draw-down | D-62, D-63, D-70 | S–M |
| H-F9 | Import: Badge mis-mapping, every row counted "Created", no confirmation or progress | E-39, E-42, E-41, E-43 | M |
| H-F10 | Wrong developer copy around inspections; no inspection history; post-save redirect to an empty page | C-04, C-05, C-06 | S–M |
| H-F11 | Firearm "Available" count; reconciliation is blank on a load failure | C-11, C-37 | S |
| H-F12 | Appearance overrides break the nav active state | A-03, A-04, A-05 | M |
| H-F13 | Agency Training event switch drops roster edits | B-55 | S |
| H-F14 | Training hub links: duplicate cards, a missing module, "Coming next" for a feature that exists | B-46 | S |
| H-F15 | Vehicle QR: printing unreachable, misleading web copy. The scan path itself is owned by FLT-04 / ARM-01 in the OA. | D-01, D-02, D-03, C-59 | S |

**Usability:**

| ID | Work item | Findings | Effort |
|---|---|---|---|
| H-U1 | Field ergonomics: tap targets, a 12px floor, sticky actions, Range Day tabs on phones | D-07, C-29, A-26, B-11, B-13, B-14 (= RNG-30 OA), B-18, D-53 | S per screen |
| H-U2 | Branded and phone-friendly Cognito hosted UI | V-01, V-02, V-03 | S (configuration) |
| H-U3 | Confirmation and consequence for irreversible or privileged actions | C-44, E-50 (= ADM-22 OA), E-52, E-12, E-13, C-09, B-61, C-38 | M |
| H-U4 | Safe-default form fields beyond the checklists | D-10, C-08, D-51 | S |
| H-U5 | Fleet manager triage: failed inspections, open work, safety holds, failed items in history | D-12, D-13, D-60 | M |
| H-U6 | Inbox and notification deep links to records; "View all" from Home | A-31, A-22 | M |
| H-U7 | Officer reachability and "mine" defaults: personal-rifle submission nav, own qualifications, certifications, equipment and firearms | C-41, A-18 (= ADM-34 OA), B-42, B-51, C-42, D-17 | S–M |
| H-U8 | Settings findability: search, member search and filter, URL tabs, one place per field | E-09, E-11 (= ADM-29 OA), E-08, E-10, E-35 | M |
| H-U9 | Unsaved-changes protection everywhere | E-06, D-30, B-55, B-70 | M |
| H-U10 | Idle sign-out: countdown, shared across tabs, return to the same page | A-47 (~ ADM-13 OA) | M |
| H-U11 | Agency switcher for multi-agency users | A-09 | M |
| H-U12 | Custody models: equipment custody vs inventory checkout, two requirement editors | D-72, D-23, D-18 (= EQP-06 OA) | M |
| H-U13 | Range Day finalize and correct: lock banner, AAR after close, reopen with reason | B-08 (~ RNG-04 OA), B-09 (= RNG-21 OA) | M |
| H-U14 | Settings that look live but are not enforced: session timeout, MFA toggle, the inert Fleet toggle, Inbox Sources hiding Critical items | E-16 (= ADM-13 OA), E-61, E-58 | S |
| H-U15 | Ammunition count flows and officer-owned firearm workflows feel like different products | C-31 (= ARM-03 OA), C-40 | M |

### Medium

These are consistency and efficiency issues; there are about 170. They are best handled by the component work in §4, not finding by finding.
- **Shared primitives:** status badges, page headers, tables with mobile cards, form fields, pickers and dialogs. This covers most of A-56 to A-61, C-14 to C-19, C-36, C-39, D-38, D-39, D-44, E-28 to E-33, B-29, B-50 and B-53.
- **Loading, empty and error states:** B-24, B-40, B-63, C-26, C-53, A-35, D-36.
- **Workflow shortcuts (no new features):**
  - "Start inspection" from the queue and after a return (C-27);
  - "Save & next run" and an "unscored only" filter (B-15);
  - multi-select roster add and "Mark all present" (B-23);
  - reviewer default modes (C-45, C-49);
  - remember the view choice (C-24, D-17);
  - Quick Inspect opens the form (D-06).
- **Duplicate editors and routes:** certification requirements (B-52), personal-rifle rules (C-46), fleet rules (D-33), dashboard settings (E-34), `/super-admin` vs `/platform` (E-51).
- **Terminology and glossary rollout:** A-63, B-36, B-47, C-12, C-62, D-20, D-45.
- **Import page structure and preview:** E-36, E-44 to E-47.

### Low

These are polish items:
- the logo box and tab titles (V-04, V-08);
- icons, where three siblings share `Boxes` (D-50);
- light-theme leftovers in dark UI (C-16, C-17, D-29);
- mojibake (C-47, E-23);
- raw enums and UUIDs in history and audit views (D-47, E-17);
- date format drift (D-54);
- dead components and backup files (A-62, C-61);
- micro-typography on non-field screens.

---

## 7. Role-specific usability

| Role | What works | What hurts most today | Primary fixes |
|---|---|---|---|
| **Patrol officer (phone)** | My Notifications is now in the nav (ADM-06 fixed). Fleet issue reporting uses a proper bottom sheet. | Sign-in is two screens plus MFA, and lands on Home rather than the linked page (V-01, A-64). Signed out on a phone, `/` shows a marketing page (V-07). There is no "my firearms" or "my record" view (C-42, B-42). A web inspection takes about 9 taps through a wide table, with tiny pre-passed toggles (D-04, D-07, D-16). There is no self check-out or check-in on the web (D-18). The QR path needs the native app. | §5 #2, #3, #9; H-U7 |
| **Range instructor (tablet or phone)** | Save status is now visible (B3). Scorers can mark attendance. Roster removal is safe. | Completion drills record the wrong result (B-05). Overrides are silently replaced (B-16). One bad value stalls every save (B-69). Reload discards drafts (B-70). A long scroll to reach Scoring (B-14). No "next run" (B-15). No correction after finalize (B-08). | CR-1, H-F5, H-U1, H-U13 |
| **Armorer (desktop)** | The Restricted tab and Physical Custody split are clearer in concept. Lost or stolen guns can be archived with a reason. | Focus view dead end (C-01). Record-page custody transfer fails (C-63). Feedback off-screen below 1440px (C-09, C-10). "Available" is wrong (C-11). Inspections have no history and wrong copy (C-04 to C-06). Two ammunition count flows (C-31). | CR-2, CR-4, H-F1, H-F10, H-F11 |
| **Fleet / equipment manager** | Vehicle documents became a real form (D-34 fixed). Safety holds exist. URL filters on Fleet. | No fleet-wide triage (D-13). Holds visible on only one card (D-60). Failed items hidden (D-12). Rules editing is fragile (D-27, D-28). Two custody models (D-72). Inventory picker and IDs (D-62, D-63). | H-U5, H-F6, H-F8, H-U12 |
| **Supervisor / command** | The Command Dashboard now shows "Data unavailable" instead of fake zeros (ADM-10). | Alert acknowledgements aren't shared (B-60). Analytics rows don't link to records (B-65). Readiness is shown three ways (B-67). KPI cards aren't links (A-33). | CR-5, H-U6 |
| **Department administrator** | An atomic member save (B11). The 14-character password policy is shown. | Saves that don't save (E-04). Group wipe (E-02). Hidden modal errors (E-01). No member search (E-11). Unconfirmed deactivate and admin grant (E-12, E-50). Import counts and mapping (E-39, E-42). | CR-3, H-F2, H-F6, H-F9, H-U3, H-U8 |
| **Platform / support** | Support Mode exists, with a banner. | Two consoles (`/super-admin` and `/platform`) with different entry semantics (E-51). Unconfirmed module disable (E-52). Activation guidance that loops (E-55). | H-U3; consolidate consoles (Medium) |

### Desktop and mobile, separately

- **Desktop:**
  - Generally serviceable.
  - The main structural problems are the 1440px breakpoint in Firearms, which hides the action panel below the table on most laptops (C-10), and the fixed 1,040px scoring grid on 1024px tablets (B-18).
  - Long single-page forms with Save only at the bottom (D-30, D-57, C-29).
- **Mobile web:**
  - Sign-in and the front door have verified problems (V-01, V-02, V-07).
  - The field screens use 9–11px text and 22–30px targets.
  - Thirteen tables need sideways scrolling.
  - Native `<select>` lists of every officer or firearm are used where a searchable picker is needed.
- **Native app:** not auditable (source not in the repositories). **Recommendation:** include the native client in the authenticated walk-through, especially QR resolve → inspection and QR → custody. Apply the same standards (§4) to it, so the field app and the web app share vocabulary and status tones.

### Acceptance checks for the authenticated walk-through (issue #11)

Run these against staging with synthetic officer, instructor, armorer, fleet manager, supervisor and admin accounts. Each confirms or retires a group of source-evident findings.
1. Open an emailed or inbox deep link while signed out, then sign in. Do you land on the record? (A-64)
2. In each modal (Certification, Vehicle, Equipment, Invite member, Off-duty drawer), trigger a server validation error. Is it visible without closing the modal? (H-F2)
3. Score a Completion drill without touching the toggle, then save. What is recorded? (B-05)
4. Edit an Off-Duty rules field on Settings → Rules, then press the header "Save Rules Engine" and reload. Did the edit persist? (E-04)
5. On a 390px phone, complete a vehicle inspection from Fleet. Count the taps and note the target sizes. (D-04, D-07, D-16)
6. On `/firearms/[id]`, transfer an issued firearm to secure storage. (C-63)
7. Throttle the network to "Slow 3G" and open Range Days, Qualifications and Training Alerts. Is an empty state shown while loading? (§5 #7)
8. Double-tap Save on New Inspection and on Inventory Check out. How many records are created? (H-F4)

---

## 8. Simplifying existing workflows without adding features

Each item removes steps or decisions from something that already exists.

1. **Sign in once, land where you meant to go.** Preserve `next`, auto-continue from the TracePoint page to the hosted UI when arriving from a deep link, and brand the hosted UI. This saves 1 tap and 2–4 navigations per deep link. (A-64, A-66, V-01)
2. **Inbox → record → back.** Point Inbox "Open" at the record with `?tab=` (Fleet already does this) and update the item in place on return instead of reloading. (A-31, A-24)
3. **Range scoring, phone:**
   - a horizontal tab strip;
   - feedback next to the sticky Save;
   - one Save per breakpoint;
   - "Save & next run";
   - completion counts in the drill and run selectors ("Run 2 – 18/30");
   - an "Unscored only" toggle.

   This saves about 3–5 taps and two long scrolls per run. (B-11 to B-15)
4. **Finalize as a step, not a side effect.** The RC already confirms terminal statuses. Add a summary of unscored officers, missing photos and open malfunctions, a lock banner, an editable AAR after close, and "Reopen with reason", reusing the Agency Training pattern. (B-07 to B-09)
5. **Armorer issue, return and inspect from one place at any width.**
   - The custody panel works in Focus view and as a drawer below `lg`.
   - After Return, offer a "Start post-return inspection" link, using the route that already accepts `?firearmId=`.
   - Each work-queue row gets "Start inspection".
   - This saves 2–3 clicks and one firearm re-selection per inspection. (C-01, C-10, C-27)
6. **Vehicle inspection.** "Quick Inspect" opens the form directly, and `?tab=inspections` is honoured, which saves 1 tap. An explicit "All remaining items pass" action replaces pre-filled Pass. That costs 1 tap, but it is a deliberate one. (D-04, D-06)
7. **Officers see their own record first** in Qualifications, Certifications, Equipment readiness and issued firearms. This removes searching a department list. (B-42, B-51, D-17, C-42)
8. **One editor per policy:**
   - certification requirements (Settings or the module, not both);
   - equipment requirements;
   - personal-rifle program rules;
   - Fleet rules (one route).

   The other location becomes a link. (B-52, D-23, C-46, D-33)
9. **One save model per settings panel:** a sticky SaveBar with dirty state and Reset. Remove the header "Save {tab}" where panels own their saves. (E-04 to E-06, E-33)
10. **Import is a page, not a stack.** Use separate Import, Export and Reports tabs, a sticky step indicator, an "Errors only" filter with row numbers in the preview, and a confirmation with a count before committing. (E-35, E-41, E-42)
11. **Reviewers start in review.**
    - Off-duty opens in Department Review for reviewers.
    - The personal-rifle queue shows only the stages the viewer can act on.
    - Both remember the last choice. (C-45, C-49)
12. **Merge duplicate entry points:**
    - Training hub cards (B-46);
    - Agency Training "Roster" and "Attendance & Results" tiles (B-56);
    - `/super-admin` and `/platform` (E-51);
    - Ammunition "Physical Count" and Reconciliation, by linking them now and stating which is authoritative (C-31).

---

## 9. Method

- **Static review.** Five parallel module reviews read every route, modal, table and form, with path:line evidence for every finding. They were first done against `origin/main`, then re-verified finding-by-finding against the RC. They were cross-referenced with the operational audit's 186 findings and its reconciliation. Design-system counts are reproducible with [`evidence/scripts/inv.sh`](evidence/scripts/inv.sh) and [`evidence/scripts/btn.py`](evidence/scripts/btn.py).
- **Spot checks.** The coordinator re-read the source for the highest-impact claims before including them: B-01, B-02, B-05, B-06, B-60, C-01, C-02, C-06, C-63, D-01, D-58, D-63, D-70, E-02, E-04, A-64 and A-65.
- **Live checks.** Playwright and Chromium against `staging.tracepointhq.com`: public routes at 1440×900 and 390×844 touch, the sign-in hand-off, hosted UI form attributes, the callback error path and a DOM probe of `/landing` (§2).
- **Not done.** No authenticated walk-throughs, because no credentials were available. No native-app review, because the source is not in the repositories. No screen-reader or assistive-technology testing beyond static checks. No changes to code, data or infrastructure.
