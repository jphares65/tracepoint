# Defect remediation plan: B7–B11

Planning only; no code has been changed for these batches. Scope comes from [finding-status.md](finding-status.md), restricted to disposition **Fix**: defects in existing behaviour, with no new capabilities.

## Ground rules

Each batch follows the same practice as B0–B6 and F1–F5:

- One branch per batch, cut from `claude/integration-defects-20261020`.
- Regression tests that fail before the fix and pass after.
- Real-PostgreSQL verification for any SQL change.
- Merge into integration only after CI is green.
- No deployment.

## Order and rationale

| Order | Batch | Why this order |
|---|---|---|
| 1 | **B9 Equipment holder** | EQP-01 is the last open Critical in the plan. Separated officers' gear shows as "Unassigned". It is a small fix with no dependencies. |
| 2 | **B7 Training records** | High-severity data-integrity defects in legal records: time drift, no-shows recorded as Present, certifications never issued on closeout. Depends on the DC date fix, which is already in integration. |
| 3 | **B10 Qualification computation & range roles** | Changes officers' qualification outcomes, so it must follow B3 (merged). Announce the change to agencies. |
| 4 | **B8 Armory integrity** | Server-side enforcement of rules that today exist only in the browser, plus separation of duties. |
| 5 | **B11 Admin correctness** | Mostly Medium/Low. Includes the CSV formula-injection guard (security hygiene). |

## B9: Equipment holder (≈ 2 days)

| ID | Defect | Minimal fix | Test |
|---|---|---|---|
| EQP-01 (Critical) | Gear held by a deactivated member is shown as "Unassigned" and disappears from per-officer views | Show the former holder (marked inactive) in the asset list and the per-officer grouping | Handler and UI-model test: an inactive holder's item lists the holder's name and an inactive flag |
| EQP-04 (High) | An item held by an inactive member or a retired vehicle cannot be marked out of service or removed until it is unassigned | Allow the lifecycle change for those holders. The custody trigger closes the assignment. | Real-PG test: an inactive holder's item can be set `out_of_service` and `removed`; the assignment history closes |
| EQP-12 (Low) | No reason field; dates not validated | Validate dates; take a reason on lifecycle change and write it to the audit | API tests |

## B7: Training records (≈ 4–6 days)

| ID | Defect | Minimal fix |
|---|---|---|
| TRN-02 (High) | Event times drift by the UTC offset on every save | Interpret `datetime-local` values in the department timezone, using the existing `departments.timezone`; display in the same zone |
| TRN-03 (High) | Closeout never issues certifications for events created in the UI | The editor sends the course's `certification_type_id`, which the API already accepts |
| TRN-04 (High) | Choosing an outcome forces attendance to Present | Keep attendance as entered; reject inconsistent combinations, such as Absent with Passed |
| TRN-11 | A roster containing a deactivated officer cannot be saved, and removing them hard-deletes the attendance record | Save rosters that contain inactive attendees; never hard-delete attended rows |
| TRN-12 | Each save rewrites `recorded_by`/`recorded_at` for every row | Write those columns only for rows that changed |
| TRN-18 | Complete Event ignores unsaved roster edits | Block closeout while edits are unsaved, with a prompt |
| TRN-27 | Reopening an event does not restore credentials it superseded | Reopen reactivates the credentials closeout deactivated (recorded link) |
| TRN-29 / TRN-30 | Weak validation; history can be rewritten | Server-side validation; protect history fields from edits |

**Owner dependency:** TRN-05 (whether due-soon items are emailed by default) is still a decision and is not part of B7.

## B10: Qualification computation & range roles (≈ 4–5 days)

| ID | Defect | Minimal fix |
|---|---|---|
| RNG-07 (High) | The Instructor role (`score_range_days`) cannot take attendance, add walk-ups or upload evidence | Grant those actions to `score_range_days` in the UI gate, the API and the evidence route; the workspace authoriser already separates planning from scoring |
| RNG-09 (High) | A drill with firearm type "Any" never counts toward handgun currency | Count "Any" toward the qualification's firearm class, or require an explicit type when the drill is a qualification (owner choice; default to the former) |
| RNG-10 (High) | A same-day re-shoot cannot clear "Failed" | Order attempts by save sequence or revision, not by date alone |
| RNG-12 (High) | Target-photo evidence is keyed to temporary result IDs and fails for imports and instructors | Key evidence to the stable result ID (B3 now keeps IDs stable); allow instructors |
| RNG-14 / RNG-15 / RNG-24 | No score validation; the complete/incomplete toggle is ignored; open days count toward currency | Validate score ranges; honour the completion flag; count only Completed/Locked days |

**Announcement:** some officers' qualification status will change. Before merging, produce a before/after report on the staging data.

## B8: Armory integrity (≈ 5–7 days)

| ID | Defect | Minimal fix |
|---|---|---|
| ARM-06 (High) | Archiving a lost or stolen weapon requires recording a fictitious "return" | Allow archive of an issued weapon with a required disposition reason; close the assignment as "not returned" |
| ARM-16 / ARM-17 | Inspection result rules are client-only; inspection status changes bypass the history; a "Passed" result never restores service | Enforce the rules server-side; route status changes through status history; a Pass restores In Service only when the inspection set it out of service |
| ARM-21 / ARM-22 / ARM-23 (High) | Ammunition ledger has no per-activity actor; a count overwrites stock silently; one person can count and certify; expected quantities come from the browser | Record the actor per activity; require a reason on count variance; counter ≠ certifier; compute expected quantities on the server (no ledger redesign) |
| ARM-11 / ARM-13 | Status can change while the weapon is issued; restore wipes the archive disposition | Validate status changes against custody; keep the disposition on restore |
| ARM-26 / ARM-29 | Reviewers can approve their own off-duty request; rifle owners can review their own rifle | Block self-approval and self-review in the API and the database |
| ARM-28 | A failed off-duty inspection leaves the authorization in force | A failed inspection marks the authorization not compliant (existing status values) |
| ARM-33 (Low) | A raw database error appears for an empty caliber | Validation message |

**Owner dependencies:**

- ARM-15 (inspection checklist defaults), ARM-25/ARM-31 (renewal) and ARM-09/RNG-17 (lockout) are plan §6 decisions.
- ARM-24 (revoke/suspend) is a missing capability and stays deferred.

## B11: Admin correctness (≈ 4–6 days)

| ID | Defect | Minimal fix |
|---|---|---|
| ADM-10 (High) | The Command Dashboard shows load failures as "not configured" or empty | Show an error state per card |
| ADM-25 | The CSV parser breaks on multi-line cells; exports allow formula injection | Use one RFC-4180 parser (SheetJS is already a dependency); guard `= + - @` in every CSV writer |
| ADM-06 / ADM-08 | Officers cannot reach My Notifications; Help is stale | Make the preferences panel reachable by every role; correct the Help copy (Forgot password, live modules) |
| ADM-19 / ADM-20 | Invite fails at scale and re-invite overwrites; a member save runs non-atomic RPCs | Paginated lookup; make re-invite idempotent; wrap the member save in one RPC |
| ADM-23 | Feature-gate handling is inconsistent between nav, layouts and support mode | Use one helper for nav, layout and API |
| ADM-32 | Raw database and provider errors are shown to users | Sanitise error messages at the API boundary |
| ADM-30 | Leftover backups, page copies and boilerplate | Remove the backup files and root `*.txt` page copies; replace the boilerplate README |
| ADM-07 | Forgot password under Cognito | Verify on staging (S14 variant) before any change |
| ADM-02 | (residual) | Covered by Support Mode guidance (F1); verify only |

## Effort and sequencing

| Scope | Engineer-days | Elapsed |
|---|---|---|
| B9 + B7 + B10 + B8 + B11 | ≈ 19–26 | — |
| Each batch's staging verification, run by the owner (S-steps added to the staging package per batch) | — | ≈ 0.5 day per batch |
