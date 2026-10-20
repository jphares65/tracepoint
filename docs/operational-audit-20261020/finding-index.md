# Finding index

All 186 workflow findings from Appendices A–E, sorted by priority. Classification, priority and complexity are as recorded in each module appendix; the consolidated backlog in [README §8](README.md#8-prioritized-improvement-backlog) groups them into work packages.

| ID | Priority | Classification | Cx | Finding | Appendix |
|---|---|---|---|---|---|
| ADM-01 | Critical | Confirmed defect | S | Bulk-imported personnel can never complete email activation | [admin](appendix-e-admin-onboarding.md) |
| ARM-02 | Critical (for any new or clean install) | Confirmed defect | M | Status change and the whole relational ammunition stack depend on tables that no tracked migration creates | [armory](appendix-a-armory.md) |
| ARM-04 | Critical | Confirmed defect (security / accountability) | S | `update_firearm_with_audit` is SECURITY DEFINER, executable by PUBLIC, with no authorization check | [armory](appendix-a-armory.md) |
| EQP-01 | Critical | Confirmed defect | S | Equipment held by a separated (inactive) officer shows as "Unassigned" | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-01 | Critical | Confirmed defect | S | Any manual status change permanently disables automatic out-of-service, including for critical inspection defects | [fleet-equipment](appendix-d-fleet-equipment.md) |
| RNG-01 | Critical | Confirmed defect | M (in-place fix); L (relational move) | Re-saving a scored line (score correction or same-day re-shoot) is permanently rejected by the server, and the rejection is hidden | [range](appendix-b-range-qualifications.md) |
| RNG-02 | Critical | Confirmed defect | L | No reliable offline or poor-connectivity behavior; local work can be lost or the page can render empty | [range](appendix-b-range-qualifications.md) |
| RNG-03 | Critical | Confirmed defect | S | Setting "Packet Status: Ready" (a planning milestone) permanently locks the Range Day before shooting | [range](appendix-b-range-qualifications.md) |
| TRN-01 | Critical | Confirmed defect | L | Notifications and email reminders are generated only when the recipient opens their inbox | [training](appendix-c-training-notifications.md) |
| ADM-02 | High | Confirmed defect | M | The platform owner has no supported way to create a new agency's first administrator | [admin](appendix-e-admin-onboarding.md) |
| ADM-03 | High | Confirmed defect | S | A deactivated (separated) user can create a new department with themselves as Administrator | [admin](appendix-e-admin-onboarding.md) |
| ADM-04 | High | Confirmed defect | S | Classic personnel re-import strips every matched member's roles and can reactivate separated officers | [admin](appendix-e-admin-onboarding.md) |
| ADM-05 | High | Verified usability problem | L | Separation (deactivation) has no offboarding workflow | [admin](appendix-e-admin-onboarding.md) |
| ADM-06 | High | Confirmed defect | S | Officers cannot reach "My Notifications", although Help sends every role there | [admin](appendix-e-admin-onboarding.md) |
| ADM-07 | High | Confirmed defect | S | "Forgot password" is documented but doesn't exist | [admin](appendix-e-admin-onboarding.md) |
| ADM-09 | High | Confirmed defect | M | Command staff cannot use the report builder; per-report permissions are dead code | [admin](appendix-e-admin-onboarding.md) |
| ADM-10 | High | Confirmed defect | S | The Command Dashboard hides data-load failures as "not configured" or empty | [admin](appendix-e-admin-onboarding.md) |
| ARM-01 | High | Confirmed defect | M | QR labels encode an unresolvable `tracepoint://` URI; firearms have no label at all | [armory](appendix-a-armory.md) |
| ARM-03 | High | Confirmed defect | L | Two disconnected ammunition ledgers; reconciliation and reports do not reflect what armorers enter | [armory](appendix-a-armory.md) |
| ARM-05 | High | Verified usability problem | M | No lost / stolen / missing / transferred / destroyed lifecycle; two conflicting status columns | [armory](appendix-a-armory.md) |
| ARM-06 | High | Confirmed defect | S–M | A lost or stolen weapon cannot be archived without recording a fictitious "return" | [armory](appendix-a-armory.md) |
| ARM-07 | High | Confirmed defect | M | Chain of custody (past assignments) is never shown anywhere | [armory](appendix-a-armory.md) |
| ARM-08 | High | Confirmed defect | M | Deactivating an officer does not check or clear issued firearms | [armory](appendix-a-armory.md) |
| ARM-09 | High | Confirmed defect | M | Qualification failure lockout is configurable and enabled by default but never enforced | [armory](appendix-a-armory.md) |
| ARM-15 | High | Verified usability problem | S | The inspection form defaults every checklist item to "Pass" and the result to "Passed" | [armory](appendix-a-armory.md) |
| ARM-18 | High | Confirmed defect (missing core control) | M | No inspection due dates or overdue tracking for duty firearms | [armory](appendix-a-armory.md) |
| ARM-21 | High | Confirmed defect | M (interim) / L (proper) | The ammo JSON ledger is last-write-wins, has no per-activity actor, and has no feature gate | [armory](appendix-a-armory.md) |
| ARM-23 | High | Confirmed defect | M | Reconciliation: one person counts, submits and certifies; expected quantities come from the client; certify rewrites counts | [armory](appendix-a-armory.md) |
| ARM-24 | High | Confirmed defect | S–M | Off-duty authorizations cannot be revoked or suspended | [armory](appendix-a-armory.md) |
| ARM-25 | High | Confirmed defect | M | No renewal path for expired off-duty authorizations; the unique serial blocks re-requests permanently | [armory](appendix-a-armory.md) |
| EQP-02 | High | Confirmed defect | S | Department-level equipment alerts are never generated; only the holder sees their own expiry alerts | [fleet-equipment](appendix-d-fleet-equipment.md) |
| EQP-03 | High | Confirmed defect | M | Expiration and inspection tracking only runs for "required" equipment types and officer-held gear | [fleet-equipment](appendix-d-fleet-equipment.md) |
| EQP-04 | High | Confirmed defect | S | Gear held by an inactive officer or a retired vehicle cannot be marked out of service or lost without first unassigning it | [fleet-equipment](appendix-d-fleet-equipment.md) |
| EQP-05 | High | Potential gap requiring operational validation | M | No consolidated "everything this officer holds" view across firearms, equipment and vehicles, and no separation clearance | [fleet-equipment](appendix-d-fleet-equipment.md) |
| EQP-09 | High | Confirmed defect (tracked migrations); production must be validated | S | The tracked schema's lifecycle CHECK rejects `out_of_service`, which the API, custody check-in and readiness all use | [fleet-equipment](appendix-d-fleet-equipment.md) |
| EQP-11 | High | Confirmed defect (static analysis; runtime permission data not inspected) | S | Command staff "department" readiness quietly returns only their own data | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-02 | High | Confirmed defect | S | Odometer can be rolled back by issue reports and by editing older work orders | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-03 | High | Confirmed defect | M | Inspection photo/video evidence API has no UI, so officers cannot photograph damage | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-04 | High | Confirmed defect | S for the deep link, M for the in-app scanner | QR labels encode a custom `tracepoint://` URI that nothing can open, and no in-app scanner exists | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-05 | High | Confirmed defect | M | Alerts are generated only when the recipient opens the app, so critical defects and out-of-service events are not pushed | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-06 | High | Confirmed defect | M | Several fleet rule settings are configurable in the UI but never enforced | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-12 | High | Potential gap requiring operational validation | M/L | No vehicle assignment or pool checkout/return; "assigned to" is free text | [fleet-equipment](appendix-d-fleet-equipment.md) |
| RNG-04 | High | Confirmed defect | M | Finalization (Completed, Locked, Archived) is one unconfirmed tap, irreversible, and has no amendment path | [range](appendix-b-range-qualifications.md) |
| RNG-05 | High | Confirmed defect | M | Range malfunctions never reach the armory; catastrophic failures do not take the weapon out of service | [range](appendix-b-range-qualifications.md) |
| RNG-06 | High | Confirmed defect | L | Range Day results never reach the relational record; the dashboard and analytics read empty tables | [range](appendix-b-range-qualifications.md) |
| RNG-07 | High | Confirmed defect | M | The permission model prevents the default "Instructor" role from running a line | [range](appendix-b-range-qualifications.md) |
| RNG-08 | High | Confirmed defect | S | Scores typed but not yet saved are silently discarded | [range](appendix-b-range-qualifications.md) |
| RNG-09 | High | Confirmed defect | S | Qualification drills with firearm type "Any" (the form default) never count toward handgun currency | [range](appendix-b-range-qualifications.md) |
| RNG-10 | High | Confirmed defect | S | A same-day remedial re-shoot cannot clear a "Failed" status | [range](appendix-b-range-qualifications.md) |
| RNG-11 | High | Confirmed defect (code path confirmed; it triggers when legacy records exist) | M | Normalization on load can make every later autosave fail (data-dependent) | [range](appendix-b-range-qualifications.md) |
| RNG-12 | High | Confirmed defect | M | Target-photo evidence is fragile: tied to transient result IDs, fails for imports and instructors, and goes missing after corrections | [range](appendix-b-range-qualifications.md) |
| RNG-13 | High | Confirmed defect | L | Concurrent instructors on separate devices lock each other out (last-writer conflict) | [range](appendix-b-range-qualifications.md) |
| RNG-16 | High | Verified usability problem | M | Remediation is disconnected from the range and its records are weakly audited | [range](appendix-b-range-qualifications.md) |
| RNG-17 | High | Confirmed defect | M | The configured firearm failure-lockout policy is never enforced | [range](appendix-b-range-qualifications.md) |
| TRN-02 | High | Confirmed defect (assumes the server process runs in UTC, the container default; no `TZ` is set in `Dockerfile` or `infra/lib/runtime-stack.ts`) | S | Event times drift by the user's UTC offset on create and on every edit | [training](appendix-c-training-notifications.md) |
| TRN-03 | High | Confirmed defect | S–M | Training closeout never issues certification records from UI-created events | [training](appendix-c-training-notifications.md) |
| TRN-04 | High | Confirmed defect | S | Picking an outcome forces attendance to "Present" (no-shows get recorded as present) | [training](appendix-c-training-notifications.md) |
| TRN-05 | High | Confirmed defect (a default-configuration defect) | S | By default no advance email is sent for expiring certifications or training due soon | [training](appendix-c-training-notifications.md) |
| TRN-06 | High | Confirmed defect | M | Supervisors and training staff are never notified about subordinates' certifications, qualifications or equipment | [training](appendix-c-training-notifications.md) |
| TRN-08 | High | Potential gap requiring operational validation | S–M | No scheduled invoker for the email dispatcher exists in the repo | [training](appendix-c-training-notifications.md) |
| TRN-09 | High | Verified usability problem | L | Outside training cannot satisfy agency training requirements, and officers have no self-submission or verification flow | [training](appendix-c-training-notifications.md) |
| TRN-14 | High | Verified usability problem | M–L | No supervisor→team scoping for readiness or alerts | [training](appendix-c-training-notifications.md) |
| TRN-19 | High | Confirmed defect | S | Off-duty approval notifications are not emailed, can't be filtered, and re-notification fails silently | [training](appendix-c-training-notifications.md) |
| TRN-20 | High | Confirmed defect | M–L | Training Alerts status and audit trail live in browser localStorage; remediations are one last-writer-wins JSON blob | [training](appendix-c-training-notifications.md) |
| TRN-21 | High | Verified usability problem | M | No per-officer training hours or transcript view | [training](appendix-c-training-notifications.md) |
| TRN-26 | High | Confirmed defect (privacy / need-to-know) | S–M | Any department member can read every officer's training results, remedial notes and certification records | [training](appendix-c-training-notifications.md) |
| ADM-08 | Medium | Verified usability problem | S | The Help Center is stale and incomplete | [admin](appendix-e-admin-onboarding.md) |
| ADM-11 | Medium | Verified usability problem | M | Dashboard drill-downs are shallow, and Dashboard and Analytics have no export or print | [admin](appendix-e-admin-onboarding.md) |
| ADM-12 | Medium | Confirmed defect | M | The audit log viewer is too thin for oversight, and its CSV export bypasses export auditing | [admin](appendix-e-admin-onboarding.md) |
| ADM-13 | Medium | Verified usability problem | M | The Security Policy controls are stored but not enforced | [admin](appendix-e-admin-onboarding.md) |
| ADM-14 | Medium | Confirmed defect | M | The department timezone has no effect | [admin](appendix-e-admin-onboarding.md) |
| ADM-15 | Medium | Potential gap requiring operational validation | L | No supervisor-to-subordinate, team, shift or unit scoping | [admin](appendix-e-admin-onboarding.md) |
| ADM-16 | Medium | Optional improvement | M | Roles are a fixed global list; agencies cannot define their own | [admin](appendix-e-admin-onboarding.md) |
| ADM-17 | Medium | Confirmed defect | M | The "Configuration Status" panel always shows green for users and rules | [admin](appendix-e-admin-onboarding.md) |
| ADM-18 | Medium | Confirmed defect | M | Renaming a unit or rank doesn't update members or scoped requirements | [admin](appendix-e-admin-onboarding.md) |
| ADM-19 | Medium | Confirmed defect | S | Inviting can fail at scale, and re-inviting overwrites data | [admin](appendix-e-admin-onboarding.md) |
| ADM-21 | Medium | Confirmed defect | M | Support mode behaves inconsistently and its exit isn't reliably audited | [admin](appendix-e-admin-onboarding.md) |
| ADM-22 | Medium | Confirmed defect | M | The platform console is fragmented and partly dead | [admin](appendix-e-admin-onboarding.md) |
| ADM-23 | Medium | Confirmed defect | S | Feature-gate handling is inconsistent between nav, layouts and support mode | [admin](appendix-e-admin-onboarding.md) |
| ADM-24 | Medium | Confirmed defect | M | Three importers with contradictory guidance and divergent behaviour | [admin](appendix-e-admin-onboarding.md) |
| ADM-25 | Medium | Confirmed defect | S | The classic CSV parser breaks on multi-line cells, and exports allow formula injection | [admin](appendix-e-admin-onboarding.md) |
| ADM-27 | Medium | Potential gap requiring operational validation | S | Admin-assigned passwords are permanent and known to the admin | [admin](appendix-e-admin-onboarding.md) |
| ADM-28 | Medium | Potential gap requiring operational validation | M | The admin-initiated reset depends on an unverified email template; platform admins can't complete it | [admin](appendix-e-admin-onboarding.md) |
| ADM-31 | Medium | Verified usability problem | S for copy, L for features | Landing-site claims that the code doesn't back | [admin](appendix-e-admin-onboarding.md) |
| ADM-35 | Medium | Verified usability problem | M | No transfer history (rank, unit or assignment) | [admin](appendix-e-admin-onboarding.md) |
| ADM-36 | Medium | Optional improvement | M | Admin and onboarding flows have no tests | [admin](appendix-e-admin-onboarding.md) |
| ARM-10 | Medium | Confirmed defect | M | Range malfunctions never reach the firearm record or status; malfunction-threshold logic is dead code | [armory](appendix-a-armory.md) |
| ARM-11 | Medium | Confirmed defect | S | Status can be changed to Out of Service / Retired while the weapon is still issued | [armory](appendix-a-armory.md) |
| ARM-12 | Medium | Verified usability problem | S | The return records no observed condition, no notes and no "received by" distinct from the clerk | [armory](appendix-a-armory.md) |
| ARM-13 | Medium | Confirmed defect | S | Restore requires no reason and wipes the archive disposition from the record | [armory](appendix-a-armory.md) |
| ARM-14 | Medium | Verified usability problem | M | The "full firearm workspace" link leads to a read-only page; the record page loads the whole inventory | [armory](appendix-a-armory.md) |
| ARM-16 | Medium | Confirmed defect | S | The rule "a failed critical item cannot pass" and the result values are enforced only in the browser | [armory](appendix-a-armory.md) |
| ARM-17 | Medium | Confirmed defect | M | Inspections change status outside the status-history path and are not atomic; "Passed" never restores service | [armory](appendix-a-armory.md) |
| ARM-19 | Medium | Confirmed defect | S | Armorer certification gating applies to off-duty inspections but not to duty-weapon inspections | [armory](appendix-a-armory.md) |
| ARM-20 | Medium | Confirmed defect | S | Inspection history and the inspection report are capped at 100 rows | [armory](appendix-a-armory.md) |
| ARM-22 | Medium | Confirmed defect | S–M | A physical count silently overwrites on-hand quantity with no required explanation or review; "Adjust" can only decrease | [armory](appendix-a-armory.md) |
| ARM-26 | Medium | Confirmed defect | S | Reviewers can approve their own off-duty request | [armory](appendix-a-armory.md) |
| ARM-27 | Medium | Potential gap requiring operational validation | S–M | The qualification "override" bypasses the department's required-qualification policy, and the check is not firearm-specific | [armory](appendix-a-armory.md) |
| ARM-28 | Medium | Confirmed defect | S | A failed off-duty inspection leaves the authorization "Authorized" and is mislabeled "Not Inspected" | [armory](appendix-a-armory.md) |
| ARM-29 | Medium | Confirmed defect | S–M | Personal rifle: owners can review their own rifle, and a failed history write leaves the record changed | [armory](appendix-a-armory.md) |
| ARM-30 | Medium | Potential gap requiring operational validation | M | Personal rifle "qualification verified" is a self-attested checkbox | [armory](appendix-a-armory.md) |
| ARM-31 | Medium | Confirmed defect | S–M | Personal rifle approvals never become "Expired"; alerts stop on the expiration date; denied or revoked rifles cannot be resubmitted | [armory](appendix-a-armory.md) |
| ARM-36 | Medium | Optional improvement | M | The armory API handlers have almost no automated tests | [armory](appendix-a-armory.md) |
| EQP-06 | Medium | Confirmed defect | M | The self-service custody API (check-out/check-in with condition) has no user interface | [fleet-equipment](appendix-d-fleet-equipment.md) |
| EQP-07 | Medium | Verified usability problem | M | No bulk issue (academy class, new deployment) | [fleet-equipment](appendix-d-fleet-equipment.md) |
| EQP-08 | Medium | Potential gap requiring operational validation | M | No lost, stolen or damaged workflow, and no condition capture when the quartermaster reassigns | [fleet-equipment](appendix-d-fleet-equipment.md) |
| EQP-10 | Medium | Potential gap requiring operational validation | L | No inventory count or audit capability | [fleet-equipment](appendix-d-fleet-equipment.md) |
| EQP-14 | Medium | Potential gap requiring operational validation | M | No equipment inspection recording (for example, the monthly TASER spark test or quarterly armor check) | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-07 | Medium | Confirmed defect | M | Each inspection re-creates a new work order for an already-known defect | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-08 | Medium | Confirmed defect | M | Inspection write is non-atomic and silently drops the work order on failure | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-09 | Medium | Confirmed defect | S | Blank mileage is saved as 0: the inspection record shows 0 mi and an issue report sets the vehicle odometer to 0 | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-10 | Medium | Verified usability problem | S | The default inspection flow invites "pencil-whipping": everything starts as Pass and the odometer is pre-filled | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-13 | Medium | Potential gap requiring operational validation | M | The accident/damage report is only an "Issue" category, with no accident data, photos or supervisor review | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-14 | Medium | Confirmed defect | S | Fleet APIs enforce less than the UI and the RLS policies (no `view_fleet` check; inspections open to all members by default) | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-15 | Medium | Potential gap requiring operational validation | S | Patrol officers cannot reach Fleet by default | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-16 | Medium | Verified usability problem | M | Fleet inventory and vehicle detail are desktop layouts; tap targets are too small for phones in a parking lot | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-17 | Medium | Potential gap requiring operational validation | M | No offline tolerance or draft persistence for inspections | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-18 | Medium | Confirmed defect | M | Fleet vehicle equipment cannot be edited or removed; Fleet and Equipment keep separate records of what is in each car | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-23 | Medium | Potential gap requiring operational validation | M | No "shift inspection compliance" board; inspection-due alerts go only to managers and are vehicle-level | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-24 | Medium | Optional improvement | S/M | Fleet code has almost no behavioral tests | [fleet-equipment](appendix-d-fleet-equipment.md) |
| RNG-14 | Medium | Confirmed defect | S | No validation of score ranges or input types | [range](appendix-b-range-qualifications.md) |
| RNG-15 | Medium | Confirmed defect | S | The "Complete / Incomplete" toggle is ignored except for Completion drills, so DNFs are stored as completed | [range](appendix-b-range-qualifications.md) |
| RNG-18 | Medium | Potential gap requiring operational validation | M | No instructor certification or assignment check to run or score a range | [range](appendix-b-range-qualifications.md) |
| RNG-19 | Medium | Verified usability problem | S | Firearm serial numbers are missing wherever a firearm is identified on range and qualification screens | [range](appendix-b-range-qualifications.md) |
| RNG-20 | Medium | Potential gap requiring operational validation | M | Ammunition used at the range does not update ammunition inventory | [range](appendix-b-range-qualifications.md) |
| RNG-21 | Medium | Confirmed defect | S | The AAR becomes read-only once the day is closed; the tab order works against the real sequence | [range](appendix-b-range-qualifications.md) |
| RNG-22 | Medium | Confirmed defect | S | Removing an officer from the roster has no confirmation and deletes their results locally (the server rejects it, causing silent desync) | [range](appendix-b-range-qualifications.md) |
| RNG-23 | Medium | Confirmed defect | S | Re-saving a line replaces each logged malfunction's type and notes with "Failure to Feed" / blank | [range](appendix-b-range-qualifications.md) |
| RNG-24 | Medium | Verified usability problem | S | Qualification status counts results from Range Days that are not closed | [range](appendix-b-range-qualifications.md) |
| RNG-25 | Medium | Verified usability problem | S | Qualification detection relies on name matching ("qualification" in the name) | [range](appendix-b-range-qualifications.md) |
| RNG-26 | Medium | Potential gap requiring operational validation | M | Drill-level qualification components override the agency's official standards | [range](appendix-b-range-qualifications.md) |
| RNG-27 | Medium | Verified usability problem | M | The audit trail is a whole-document snapshot, written roughly every 650 ms of editing | [range](appendix-b-range-qualifications.md) |
| RNG-28 | Medium | Potential gap requiring operational validation | M | Every department member can read all range results, notes and deficiencies | [range](appendix-b-range-qualifications.md) |
| RNG-29 | Medium | Verified usability problem | M | Building a roster is one officer at a time, and scheduled mode has no shared or loaner firearm option | [range](appendix-b-range-qualifications.md) |
| RNG-30 | Medium | Verified usability problem | S | Mobile layout: stacked tabs, small text and small tap targets for gloved, outdoor use | [range](appendix-b-range-qualifications.md) |
| RNG-36 | Medium | Verified usability problem | M | Test coverage misses every high-risk path | [range](appendix-b-range-qualifications.md) |
| TRN-07 | Medium | Confirmed defect | M | The per-credential "Reminder schedule" in the UI is stored and never used | [training](appendix-c-training-notifications.md) |
| TRN-10 | Medium | Confirmed defect | S | Daily-changing alert text resets snoozes and queues a new email every day for expired items | [training](appendix-c-training-notifications.md) |
| TRN-11 | Medium | Confirmed defect | S | A roster containing a since-deactivated officer can't be saved, and removing them deletes their attendance record | [training](appendix-c-training-notifications.md) |
| TRN-12 | Medium | Confirmed defect | S–M | Each roster save rewrites "recorded by/at" and created_by on every row, so attendance attribution is lost | [training](appendix-c-training-notifications.md) |
| TRN-13 | Medium | Confirmed defect | S | My Home shows "Acknowledge" on alerts the API refuses (409) | [training](appendix-c-training-notifications.md) |
| TRN-15 | Medium | Verified usability problem | M | No leave, light-duty or waiver/exemption handling | [training](appendix-c-training-notifications.md) |
| TRN-17 | Medium | Verified usability problem | S–M | Rostering is one person at a time; there are no unit/rank/group or "assign everyone required" actions | [training](appendix-c-training-notifications.md) |
| TRN-18 | Medium | Verified usability problem | S | "Complete Event" ignores unsaved roster edits | [training](appendix-c-training-notifications.md) |
| TRN-22 | Medium | Confirmed defect | S | The inbox UI covers only 4 of the notification sources | [training](appendix-c-training-notifications.md) |
| TRN-23 | Medium | Confirmed defect | M | Email failures are invisible; Brevo bounces and suppressions aren't handled | [training](appendix-c-training-notifications.md) |
| TRN-24 | Medium | Verified usability problem | M | Department inbox items are copied per user with no assignment or shared state | [training](appendix-c-training-notifications.md) |
| TRN-25 | Medium | Potential gap requiring operational validation (performance) | M | Staff training alerts scale as officers × requirements, written one at a time on every home-page load | [training](appendix-c-training-notifications.md) |
| TRN-27 | Medium | Confirmed defect | S–M | Reopening a closed event deactivates its credentials but doesn't restore the ones it superseded | [training](appendix-c-training-notifications.md) |
| TRN-29 | Medium | Confirmed defect | S | Certification record API has weak validation and allows rewriting history | [training](appendix-c-training-notifications.md) |
| TRN-31 | Medium | Confirmed defect | S–M | Requirement configuration needs Settings access a training coordinator usually lacks; the hub says it's "Coming next" | [training](appendix-c-training-notifications.md) |
| TRN-32 | Medium | Verified usability problem | S–M | Requirement scope values are free text, not linked to units, ranks or groups | [training](appendix-c-training-notifications.md) |
| TRN-33 | Medium | Verified usability problem | S–M | Rostering, cancelling or rescheduling a training event notifies nobody | [training](appendix-c-training-notifications.md) |
| TRN-37 | Medium | Optional improvement | M | Thin test coverage for the riskiest logic | [training](appendix-c-training-notifications.md) |
| TRN-30 | Low–Medium | Confirmed defect | S | Event and requirement APIs accept inconsistent or invalid state | [training](appendix-c-training-notifications.md) |
| TRN-35 | Low–Medium | Confirmed defect | S | Turning off "In-app notifications" silently turns off email and resolves everything | [training](appendix-c-training-notifications.md) |
| ADM-20 | Low | Confirmed defect | S | Saving a member runs three separate, non-atomic RPCs | [admin](appendix-e-admin-onboarding.md) |
| ADM-26 | Low | Verified usability problem | S | Personnel import requires a badge number | [admin](appendix-e-admin-onboarding.md) |
| ADM-29 | Low | Verified usability problem | M | Admin UX gaps in the Users list and access-denied pages | [admin](appendix-e-admin-onboarding.md) |
| ADM-30 | Low | Optional improvement | S | Leftover backups, page copies, boilerplate and demo data | [admin](appendix-e-admin-onboarding.md) |
| ADM-32 | Low | Confirmed defect | S | Raw database and provider errors are shown to users | [admin](appendix-e-admin-onboarding.md) |
| ADM-33 | Low | Optional improvement | S | Development conveniences left in the production request path | [admin](appendix-e-admin-onboarding.md) |
| ADM-34 | Low | Potential gap requiring operational validation | S | Officer self-service pages are hidden from the nav | [admin](appendix-e-admin-onboarding.md) |
| ARM-32 | Low | Confirmed defect | S | Firearm attachment metadata is listable by any department member; another module's permission can archive armory documents | [armory](appendix-a-armory.md) |
| ARM-33 | Low | Confirmed defect | S | Editing a firearm with an empty caliber returns a raw database error | [armory](appendix-a-armory.md) |
| ARM-34 | Low | Confirmed defect | S | Command staff cannot use the ammunition reports or alerts they are listed for | [armory](appendix-a-armory.md) |
| ARM-35 | Low | Potential gap requiring operational validation (performance and correctness at scale) | S | Inventory load enumerates every platform auth user (first 1,000) on each request; the off-duty list does per-row reloads | [armory](appendix-a-armory.md) |
| EQP-12 | Low | Verified usability problem | S | Equipment asset edits have no reason field, and dates are not validated | [fleet-equipment](appendix-d-fleet-equipment.md) |
| EQP-13 | Low | Verified usability problem | M | The equipment list is a desktop table and officers have no mobile "My gear" view | [fleet-equipment](appendix-d-fleet-equipment.md) |
| EQP-15 | Low | Optional improvement | S/M | Equipment readiness logic and custody behavior lack behavioral tests | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-11 | Low | Confirmed defect | S | The vehicle detail page ignores `?tab=` deep links, so alert links land on Overview | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-19 | Low | Confirmed defect | S | The manually editable "Open Issues" count conflicts with the computed value | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-20 | Low | Confirmed defect | S | Two vehicle PATCH endpoints with different validation and side effects | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-21 | Low | Verified usability problem | M | Vehicle documents are URL-only, entered through prompts, and cannot be edited or deleted; document expirations are never alerted | [fleet-equipment](appendix-d-fleet-equipment.md) |
| FLT-22 | Low | Optional improvement | S | The fleet report fans out per vehicle and silently truncates inspections | [fleet-equipment](appendix-d-fleet-equipment.md) |
| GEN-01 | Low | Optional improvement | S | The `/inspections` alias goes to firearm inspections; stale doc and backup files sit inside `src/app` | [fleet-equipment](appendix-d-fleet-equipment.md) |
| RNG-31 | Low | Verified usability problem | M | Drill library is reachable only inside a Range Day; template edits overwrite authorship and are not versioned | [range](appendix-b-range-qualifications.md) |
| RNG-32 | Low | Confirmed defect | S | Drill documents are hard-deleted without versioning; an upload error can leave the UI stuck | [range](appendix-b-range-qualifications.md) |
| RNG-33 | Low | Optional improvement | M | The printed packet is the only offline fallback, and its results must be re-typed | [range](appendix-b-range-qualifications.md) |
| RNG-34 | Low | Optional improvement | S | `workspace-write-policy.ts` is dead code with its own tests; the rules are duplicated in three places | [range](appendix-b-range-qualifications.md) |
| RNG-35 | Low | Optional improvement | S | Stale page copies are committed at the repository root | [range](appendix-b-range-qualifications.md) |
| TRN-16 | Low | Potential gap requiring operational validation | S | Deactivated or separated users can still be emailed queued digests | [training](appendix-c-training-notifications.md) |
| TRN-28 | Low | Potential gap requiring operational validation (separation of duties) | S | Closeout lets `manage_training` issue and deactivate certifications without `manage_certifications` | [training](appendix-c-training-notifications.md) |
| TRN-34 | Low | Confirmed defect (API) / Verified usability problem (UI) | S | Snooze is unvalidated and fixed at 1 day in the UI | [training](appendix-c-training-notifications.md) |
| TRN-36 | Low | Verified usability problem | M | Mobile layouts for core coordinator tasks are wide desktop tables | [training](appendix-c-training-notifications.md) |
| TRN-38 | Low | Optional improvement | S | The quick-create event form in the page is dead code that diverges from the editor | [training](appendix-c-training-notifications.md) |
