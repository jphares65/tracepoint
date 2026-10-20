# Finding status against the current application

Every finding from the 2026-10-20 audit (186) plus 14 new findings from the reconciliation, classified against the latest code line `origin/codex/staging-mobile-api-release-20261007` @ `555f061` and the newest deployment evidence. Evidence for each row is in the linked module report (R2–R6), with database-level results in [R7](R7-database-verification.md).

**Status** uses the five categories requested: Verified defect · Already corrected · Outdated / not applicable · Unverified – requires testing · Enhancement – defer. No finding was found fully corrected; partly corrected items are marked.

**Disposition**: *Fix* = defect in existing behavior, in remediation scope. *Fix – owner decision* = existing setting or behavior is inconsistent; the owner must say which behavior is intended before it is corrected (often 'hide the setting' is the smallest fix). *Defer (missing capability)* = the reviewer called it a defect but correcting it means building something that does not exist today; deferred under the no-new-features rule. *Defer* = enhancement. *Verify* = needs a staging or native-client run.

| ID | Priority | Status | Disposition | Finding | Report |
|---|---|---|---|---|---|
| ADM-01 | Critical | Verified defect | Fix | Bulk-imported personnel can't complete activation | [admin](R6-admin-onboarding.md) |
| ARM-04 | Critical (Supabase only) | Already corrected on AWS-native; still open on Supabase | Verify – confirm both Supabase projects are retired | `update_firearm_with_audit` SECURITY DEFINER, PUBLIC execute | [armory](R2-armory.md) |
| EQP-01 | Critical | Verified defect | Fix | Separated officer's gear shows as Unassigned | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-01 | Critical | Verified defect | Fix | A manual status change permanently disables auto out-of-service | [fleet-equipment](R5-fleet-equipment.md) |
| NEW-01 | Critical | Verified defect | Fix | In AWS-native mode, "admin" is the subject's RLS client, so inspector and officer field writes fail silently | [fleet-equipment](R5-fleet-equipment.md) |
| NEW-ADM-A | Critical | Verified defect | Fix | Pending Cognito identities (all invites, imports and migrations) can't complete first sign-in. Only admin Assign Password promotes them. | [admin](R6-admin-onboarding.md) |
| RNG-01 | Critical | Verified defect | Fix | Score correction or re-shoot re-save rejected, rejection hidden | [range](R3-range.md) |
| RNG-03 | Critical | Verified defect | Fix | packetStatus "Ready" locks the day before shooting | [range](R3-range.md) |
| RNG-13 | Critical | Verified defect | Fix | Concurrent devices lock each other out | [range](R3-range.md) |
| TRN-01 | Critical | Verified defect | Fix | Notifications/emails generated only when recipient opens inbox | [training](R4-training-notifications.md) |
| TRN-08 | Critical | Verified defect | Fix | No scheduled invoker for email dispatcher | [training](R4-training-notifications.md) |
| ADM-04 | High | Verified defect (partly corrected) | Fix | Classic re-import strips roles and reactivates separated officers | [admin](R6-admin-onboarding.md) |
| ADM-10 | High | Verified defect | Fix | Dashboard hides load failures | [admin](R6-admin-onboarding.md) |
| ARM-01 | High | Verified defect (partly corrected) | Fix | QR labels unresolvable; firearms unlabeled | [armory](R2-armory.md) |
| ARM-02 | High | Verified defect | Fix | Tables missing from tracked migrations | [armory](R2-armory.md) |
| ARM-06 | High | Verified defect | Fix | Archive requires fictitious return | [armory](R2-armory.md) |
| ARM-21 | High | Verified defect | Fix | Ammo JSON last-write-wins, no actor, no feature gate | [armory](R2-armory.md) |
| ARM-23 | High | Verified defect | Fix | Reconciliation single-person, client-supplied expected | [armory](R2-armory.md) |
| EQP-04 | High | Verified defect | Fix | Inactive holder blocks out-of-service or lost updates | [fleet-equipment](R5-fleet-equipment.md) |
| EQP-06 | High | Verified defect | Fix | Self-service custody API has no UI | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-02 | High | Verified defect | Fix | Odometer can be rolled back by issues and work-order edits | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-04 | High | Verified defect (partly corrected) | Fix | QR labels encode `tracepoint://`; nothing resolves them | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-05 | High | Verified defect | Fix | Alerts are generated only when the recipient opens the app; nothing is pushed | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-08 | High | Verified defect | Fix | Inspection write is non-atomic and drops the work order on failure | [fleet-equipment](R5-fleet-equipment.md) |
| NEW-02 | High | Verified defect | Fix | QR resolve returns 500 for unit numbers, asset numbers and serials on PostgreSQL | [fleet-equipment](R5-fleet-equipment.md) |
| NEW-ADM-C | High | Verified defect | Fix | `/super-admin` entitlement writes are unwired from 015 and denied by grants in aws-native; the read is tenant-scoped. | [admin](R6-admin-onboarding.md) |
| NEW-ADM-D | High | Verified defect | Fix | Cognito personnel writer calls the legacy `issueActivationEmail`, which throws in aws-native after membership re-enable. | [admin](R6-admin-onboarding.md) |
| NEW-ARM-A | High | Verified defect | Fix | `/api/armory/ammunition` and `/api/armory/ammunition/reconciliations` crash in aws-native mode | [armory](R2-armory.md) |
| NEW-ARM-B | High | Verified defect | Fix | QR resolver returns 500 for every identifier that is not a UUID | [armory](R2-armory.md) |
| RNG-04 | High | Verified defect | Fix | Finalization is one unconfirmed tap, irreversible, no amendment | [range](R3-range.md) |
| RNG-07 | High | Verified defect | Fix | Instructor role cannot run a line | [range](R3-range.md) |
| RNG-08 | High | Verified defect | Fix | Unsaved typed scores silently discarded | [range](R3-range.md) |
| RNG-09 | High | Verified defect | Fix | Firearm type "Any" never counts toward handgun currency | [range](R3-range.md) |
| RNG-10 | High | Verified defect | Fix | Same-day re-shoot cannot clear Failed | [range](R3-range.md) |
| RNG-11 | High | Verified defect | Fix | Load normalization can make every autosave fail | [range](R3-range.md) |
| RNG-12 | High | Verified defect | Fix | Target-photo evidence tied to transient IDs; fails for imports and instructors | [range](R3-range.md) |
| TRN-02 | High | Verified defect | Fix | Event times drift by UTC offset on each save | [training](R4-training-notifications.md) |
| TRN-03 | High | Verified defect | Fix | Closeout never issues certifications for UI-created events | [training](R4-training-notifications.md) |
| TRN-04 | High | Verified defect | Fix | Picking an outcome forces attendance to Present | [training](R4-training-notifications.md) |
| TRN-19 | High | Verified defect | Fix | Off-duty notifications not emailed, unfilterable, re-notify fails silently | [training](R4-training-notifications.md) |
| TRN-20 | High | Verified defect | Fix | Training Alerts status in localStorage; remediation blob | [training](R4-training-notifications.md) |
| ADM-02 | Medium | Verified defect (partly corrected) | Fix | No supported first-admin path for platform owner | [admin](R6-admin-onboarding.md) |
| ADM-06 | Medium | Verified defect | Fix | Officers can't reach My Notifications | [admin](R6-admin-onboarding.md) |
| ADM-08 | Medium | Verified defect | Fix | Help Center stale | [admin](R6-admin-onboarding.md) |
| ADM-19 | Medium | Verified defect (partly corrected) | Fix | Invite fails at scale; re-invite overwrites | [admin](R6-admin-onboarding.md) |
| ADM-23 | Medium | Verified defect | Fix | Feature-gate inconsistency | [admin](R6-admin-onboarding.md) |
| ADM-25 | Medium | Verified defect | Fix | CSV parser breaks on multi-line cells; formula injection | [admin](R6-admin-onboarding.md) |
| ADM-36 | Medium | Verified defect (partly corrected) | Fix | Admin and onboarding flows untested | [admin](R6-admin-onboarding.md) |
| ARM-10 | Medium | Verified defect | Fix | Range malfunctions never reach firearm | [armory](R2-armory.md) |
| ARM-11 | Medium | Verified defect | Fix | Status change while issued | [armory](R2-armory.md) |
| ARM-13 | Medium | Verified defect | Fix | Restore wipes archive disposition | [armory](R2-armory.md) |
| ARM-16 | Medium | Verified defect | Fix | Inspection result rules client-only | [armory](R2-armory.md) |
| ARM-17 | Medium | Verified defect | Fix | Inspection status change bypasses history; not atomic | [armory](R2-armory.md) |
| ARM-22 | Medium | Verified defect | Fix | Physical count silently overwrites; Adjust decrease-only | [armory](R2-armory.md) |
| ARM-26 | Medium | Verified defect | Fix | Reviewer approves own request | [armory](R2-armory.md) |
| ARM-28 | Medium | Verified defect | Fix | Failed off-duty inspection leaves authorization | [armory](R2-armory.md) |
| ARM-29 | Medium | Verified defect | Fix | Personal rifle self-review; non-atomic history | [armory](R2-armory.md) |
| EQP-09 | Medium | Verified defect (partly corrected) | Fix | Tracked CHECK rejects `out_of_service` | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-09 | Medium | Verified defect | Fix | Blank mileage is saved as 0 | [fleet-equipment](R5-fleet-equipment.md) |
| NEW-ADM-B | Medium | Verified defect | Fix | App Cognito password policy is min 10; the pool requires min 14. Assign Password accepts values Cognito rejects. | [admin](R6-admin-onboarding.md) |
| NEW-ADM-E | Medium | Verified defect | Fix | Settings deactivation doesn't disable Cognito or revoke sessions; the import path does. | [admin](R6-admin-onboarding.md) |
| NEW-ADM-F | Medium | Verified defect | Fix | Platform "Send Activation" fails in aws-native unless the admin is in Support Mode for that agency. | [admin](R6-admin-onboarding.md) |
| NEW-ADM-G | Medium | Verified defect | Fix | The tenant-isolation SQL test doesn't apply `database/aws`. CI has no PR trigger for app tests. Two `src/**/*.test.mjs` files are never run. | [admin](R6-admin-onboarding.md) |
| NEW-ARM-C | Medium | Verified defect | Fix | Clean-bootstrap validator stale | [armory](R2-armory.md) |
| RNG-14 | Medium | Verified defect | Fix | No score range or type validation | [range](R3-range.md) |
| RNG-15 | Medium | Verified defect | Fix | Complete/Incomplete toggle ignored except for Completion drills | [range](R3-range.md) |
| RNG-22 | Medium | Verified defect | Fix | Roster removal has no confirm and deletes results (server rejects) | [range](R3-range.md) |
| RNG-23 | Medium | Verified defect | Fix | Re-save resets malfunction type and notes | [range](R3-range.md) |
| RNG-24 | Medium | Verified defect | Fix | Qualification status counts open (non-closed) days | [range](R3-range.md) |
| RNG-36 | Medium | Verified defect | Fix | Test coverage misses high-risk paths | [range](R3-range.md) |
| TRN-10 | Medium | Verified defect | Fix | Daily-changing text resets snooze and queues new email | [training](R4-training-notifications.md) |
| TRN-11 | Medium | Verified defect | Fix | Roster with deactivated officer can't be saved; removal hard-deletes | [training](R4-training-notifications.md) |
| TRN-12 | Medium | Verified defect | Fix | Roster save rewrites recorded_by/at and created_by | [training](R4-training-notifications.md) |
| TRN-13 | Medium | Verified defect | Fix | My Home shows Acknowledge that API rejects (409) | [training](R4-training-notifications.md) |
| TRN-18 | Medium | Verified defect | Fix | Complete Event ignores unsaved roster edits | [training](R4-training-notifications.md) |
| TRN-27 | Medium | Verified defect | Fix | Reopen doesn't restore superseded credentials | [training](R4-training-notifications.md) |
| TRN-29 | Medium | Verified defect | Fix | Weak certification validation; history rewrite | [training](R4-training-notifications.md) |
| ADM-03 | Low | Verified defect (partly corrected) | Fix | Separated user can self-create a department | [admin](R6-admin-onboarding.md) |
| ADM-20 | Low | Verified defect | Fix | Member save = 3 non-atomic RPCs | [admin](R6-admin-onboarding.md) |
| ADM-27 | Low | Verified defect (partly corrected) | Fix | Admin-assigned passwords permanent and known | [admin](R6-admin-onboarding.md) |
| ADM-30 | Low | Verified defect | Fix | Leftover backups and boilerplate | [admin](R6-admin-onboarding.md) |
| ADM-32 | Low | Verified defect (partly corrected) | Fix | Raw DB and provider errors shown | [admin](R6-admin-onboarding.md) |
| ARM-33 | Low | Verified defect | Fix | Empty caliber → raw DB error | [armory](R2-armory.md) |
| EQP-12 | Low | Verified defect | Fix | No reason field; dates not validated | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-11 | Low | Verified defect | Fix | Vehicle detail ignores `?tab=` | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-19 | Low | Verified defect | Fix | Manually editable Open Issues count | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-20 | Low | Verified defect | Fix | Two vehicle PATCH endpoints behave differently | [fleet-equipment](R5-fleet-equipment.md) |
| NEW-ARM-E | Low | Verified defect | Fix | QR decision leaks existence; equipment has no permission check | [armory](R2-armory.md) |
| RNG-32 | Low | Verified defect | Fix | Drill documents hard-deleted; upload error leaves UI stuck | [range](R3-range.md) |
| TRN-16 | Low | Verified defect (partly corrected) | Fix | Deactivated users can still be emailed queued digests | [training](R4-training-notifications.md) |
| TRN-30 | Low | Verified defect | Fix | Event/requirement APIs accept invalid state | [training](R4-training-notifications.md) |
| TRN-34 | Low | Verified defect | Fix | Snooze unvalidated, fixed 1 day | [training](R4-training-notifications.md) |
| TRN-35 | Low | Verified defect | Fix | Disabling in-app silently disables email and resolves everything | [training](R4-training-notifications.md) |
| ARM-09 | High | Verified defect | Fix – owner decision on intended behavior | Qualification lockout never enforced | [armory](R2-armory.md) |
| ARM-15 | High | Verified defect | Fix – owner decision on intended behavior | Inspection form defaults to Pass/Passed | [armory](R2-armory.md) |
| ARM-25 | High | Verified defect | Fix – owner decision on intended behavior | No renewal; serial unique blocks re-request | [armory](R2-armory.md) |
| EQP-11 | High | Verified defect | Fix – owner decision on intended behavior | Command department readiness returns only the viewer's own data | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-06 | High | Verified defect | Fix – owner decision on intended behavior | Fleet rule settings are configurable but not enforced | [fleet-equipment](R5-fleet-equipment.md) |
| RNG-17 | High | Verified defect | Fix – owner decision on intended behavior | Firearm failure-lockout policy never enforced | [range](R3-range.md) |
| TRN-05 | High | Verified defect | Fix – owner decision on intended behavior | No advance email by default | [training](R4-training-notifications.md) |
| TRN-26 | High | Verified defect | Fix – owner decision on intended behavior | Any member can read all training results / certifications | [training](R4-training-notifications.md) |
| ADM-14 | Medium | Verified defect | Fix – owner decision on intended behavior | Department timezone ignored | [admin](R6-admin-onboarding.md) |
| ARM-31 | Medium | Verified defect | Fix – owner decision on intended behavior | Rifle approvals never Expired; alerts stop; no resubmit | [armory](R2-armory.md) |
| FLT-14 | Medium | Verified defect (partly corrected) | Fix – owner decision on intended behavior | Fleet APIs enforce less than the UI and RLS | [fleet-equipment](R5-fleet-equipment.md) |
| RNG-28 | Medium | Verified defect (partly corrected) | Fix – owner decision on intended behavior | Every member can read all range results | [range](R3-range.md) |
| TRN-07 | Medium | Verified defect | Fix – owner decision on intended behavior | Per-credential reminder schedule never used | [training](R4-training-notifications.md) |
| ADM-13 | Low | Verified defect (partly corrected) | Fix – owner decision on intended behavior | Security policy stored but not enforced | [admin](R6-admin-onboarding.md) |
| ARM-32 | Low | Verified defect | Fix – owner decision on intended behavior | Attachment list open to any member; cross-module archive | [armory](R2-armory.md) |
| ADM-07 | Medium | Unverified – requires testing | Verify | "Forgot password" documented but missing | [admin](R6-admin-onboarding.md) |
| ARM-27 | Medium | Unverified – requires testing | Verify | Qualification override bypasses policy; not firearm-specific | [armory](R2-armory.md) |
| FLT-17 | Medium | Unverified – requires testing | Verify | No offline tolerance or draft persistence | [fleet-equipment](R5-fleet-equipment.md) |
| NEW-ARM-D | Medium | Unverified – requires testing | Verify | The QR "firearm_custody" workflow has no mobile-callable endpoint | [armory](R2-armory.md) |
| RNG-26 | Medium | Unverified – requires testing | Verify | Drill-level components override agency standards | [range](R3-range.md) |
| TRN-25 | Medium | Unverified – requires testing | Verify | Staff alerts scale officers×requirements, sequential writes per page load | [training](R4-training-notifications.md) |
| RNG-02 | Critical | Verified defect | Defer (missing capability) | No reliable offline behaviour; local work lost or page empty | [range](R3-range.md) |
| ADM-05 | High | Verified defect | Defer (missing capability) | No offboarding workflow on deactivation | [admin](R6-admin-onboarding.md) |
| ADM-22 | High | Verified defect | Defer (missing capability) | Platform console fragmented and partly dead | [admin](R6-admin-onboarding.md) |
| ARM-03 | High | Verified defect | Defer (missing capability) | Two disconnected ammo ledgers | [armory](R2-armory.md) |
| ARM-05 | High | Verified defect | Defer (missing capability) | No lost/stolen lifecycle; two status columns | [armory](R2-armory.md) |
| ARM-07 | High | Verified defect (partly corrected) | Defer (missing capability) | Chain of custody never shown | [armory](R2-armory.md) |
| ARM-08 | High | Verified defect | Defer (missing capability) | Deactivation ignores issued firearms | [armory](R2-armory.md) |
| ARM-18 | High | Verified defect | Defer (missing capability) | No inspection due dates | [armory](R2-armory.md) |
| ARM-24 | High | Verified defect | Defer (missing capability) | Off-duty cannot be revoked/suspended | [armory](R2-armory.md) |
| EQP-02 | High | Verified defect | Defer (missing capability) | No department-level equipment alerts | [fleet-equipment](R5-fleet-equipment.md) |
| EQP-03 | High | Verified defect | Defer (missing capability) | Expiry tracking only runs for required types on officers | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-15 | High | Verified defect | Defer (missing capability) | Patrol officers cannot reach Fleet by default | [fleet-equipment](R5-fleet-equipment.md) |
| RNG-05 | High | Verified defect | Defer (missing capability) | Malfunctions never reach armory; catastrophic failure not out-of-service | [range](R3-range.md) |
| RNG-06 | High | Verified defect | Defer (missing capability) | Range results never reach relational tables; dashboard reads empty tables | [range](R3-range.md) |
| TRN-06 | High | Verified defect | Defer (missing capability) | Supervisors/staff never notified about subordinates | [training](R4-training-notifications.md) |
| ADM-09 | Medium | Verified defect | Defer (missing capability) | Report builder admin-only | [admin](R6-admin-onboarding.md) |
| ADM-12 | Medium | Verified defect | Defer (missing capability) | Audit viewer thin; CSV export unaudited | [admin](R6-admin-onboarding.md) |
| ADM-17 | Medium | Verified defect | Defer (missing capability) | Configuration Status always green | [admin](R6-admin-onboarding.md) |
| ADM-18 | Medium | Verified defect | Defer (missing capability) | Unit or rank rename doesn't propagate | [admin](R6-admin-onboarding.md) |
| ADM-21 | Medium | Verified defect (partly corrected) | Defer (missing capability) | Support mode inconsistent; exit not audited | [admin](R6-admin-onboarding.md) |
| ADM-24 | Medium | Verified defect (partly corrected) | Defer (missing capability) | Three importers, contradictory guidance | [admin](R6-admin-onboarding.md) |
| ADM-31 | Medium | Verified defect | Defer (missing capability) | Landing claims not backed | [admin](R6-admin-onboarding.md) |
| ARM-12 | Medium | Verified defect | Defer (missing capability) | Return records no observed condition | [armory](R2-armory.md) |
| ARM-14 | Medium | Verified defect (partly corrected) | Defer (missing capability) | Record page read-only / loads entire inventory | [armory](R2-armory.md) |
| ARM-19 | Medium | Verified defect | Defer (missing capability) | Armorer certification only on off-duty | [armory](R2-armory.md) |
| ARM-20 | Medium | Verified defect | Defer (missing capability) | Inspection history capped at 100 | [armory](R2-armory.md) |
| FLT-03 | Medium | Verified defect (partly corrected) | Defer (missing capability) | Inspection photo evidence API has no UI | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-07 | Medium | Verified defect | Defer (missing capability) | Each inspection creates a new work order for a known defect | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-18 | Medium | Verified defect | Defer (missing capability) | Fleet vehicle equipment cannot be edited or removed; two sources of truth | [fleet-equipment](R5-fleet-equipment.md) |
| RNG-16 | Medium | Verified defect | Defer (missing capability) | Remediation disconnected and weakly audited | [range](R3-range.md) |
| RNG-19 | Medium | Verified defect | Defer (missing capability) | Firearm serials missing on range and qualification screens | [range](R3-range.md) |
| RNG-21 | Medium | Verified defect | Defer (missing capability) | AAR read-only after close-out | [range](R3-range.md) |
| RNG-25 | Medium | Verified defect | Defer (missing capability) | Qualification detection by name matching | [range](R3-range.md) |
| RNG-27 | Medium | Verified defect | Defer (missing capability) | Audit trail is whole-document snapshots | [range](R3-range.md) |
| TRN-22 | Medium | Verified defect | Defer (missing capability) | Inbox UI covers 4 sources | [training](R4-training-notifications.md) |
| TRN-23 | Medium | Verified defect (partly corrected) | Defer (missing capability) | Email failures invisible; bounces/suppressions unhandled | [training](R4-training-notifications.md) |
| TRN-31 | Medium | Verified defect | Defer (missing capability) | Requirements UI behind Settings gate; hub says "Coming next" | [training](R4-training-notifications.md) |
| TRN-32 | Medium | Verified defect | Defer (missing capability) | Requirement scope values are free text | [training](R4-training-notifications.md) |
| ADM-26 | Low | Verified defect | Defer (missing capability) | Badge required for personnel import | [admin](R6-admin-onboarding.md) |
| ADM-29 | Low | Verified defect | Defer (missing capability) | Users list and access-denied UX | [admin](R6-admin-onboarding.md) |
| ADM-33 | Low | Verified defect (partly corrected) | Defer (missing capability) | Dev conveniences in production path | [admin](R6-admin-onboarding.md) |
| ADM-34 | Low | Verified defect | Defer (missing capability) | Officer self-service pages hidden | [admin](R6-admin-onboarding.md) |
| ARM-34 | Low | Verified defect | Defer (missing capability) | Command staff can't use ammo reports/alerts | [armory](R2-armory.md) |
| ARM-35 | Low | Verified defect (partly corrected) | Defer (missing capability) | listUsers(1000) per request; off-duty per-row reloads | [armory](R2-armory.md) |
| FLT-21 | Low | Verified defect (partly corrected) | Defer (missing capability) | Vehicle documents are URL-only prompts and expirations are not alerted | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-22 | Low | Verified defect | Defer (missing capability) | Fleet report fans out and truncates silently | [fleet-equipment](R5-fleet-equipment.md) |
| GEN-01 | Low | Verified defect | Defer (missing capability) | `/inspections` goes to firearms; stale files | [fleet-equipment](R5-fleet-equipment.md) |
| EQP-05 | High | Enhancement – defer | Defer | No consolidated officer property view or separation clearance | [fleet-equipment](R5-fleet-equipment.md) |
| TRN-09 | High | Enhancement – defer | Defer | Outside training can't satisfy requirements; no self-submission | [training](R4-training-notifications.md) |
| TRN-14 | High | Enhancement – defer | Defer | No supervisor→team scoping | [training](R4-training-notifications.md) |
| TRN-21 | High | Enhancement – defer | Defer | No per-officer hours/transcript | [training](R4-training-notifications.md) |
| ADM-15 | Medium | Enhancement – defer | Defer | No supervisor or team scoping | [admin](R6-admin-onboarding.md) |
| ARM-30 | Medium | Enhancement – defer | Defer | "Qualification verified" is a checkbox | [armory](R2-armory.md) |
| ARM-36 | Medium | Enhancement – defer | Defer | Almost no handler tests | [armory](R2-armory.md) |
| EQP-07 | Medium | Enhancement – defer | Defer | No bulk issue | [fleet-equipment](R5-fleet-equipment.md) |
| EQP-08 | Medium | Enhancement – defer | Defer | No lost, stolen or damaged workflow | [fleet-equipment](R5-fleet-equipment.md) |
| EQP-10 | Medium | Enhancement – defer | Defer | No inventory count or audit | [fleet-equipment](R5-fleet-equipment.md) |
| EQP-14 | Medium | Enhancement – defer | Defer | No equipment inspection recording | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-10 | Medium | Enhancement – defer | Defer | Default flow invites pencil-whipping | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-12 | Medium | Enhancement – defer | Defer | No vehicle assignment or pool checkout | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-13 | Medium | Enhancement – defer | Defer | Damage report is only an Issue category | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-23 | Medium | Enhancement – defer | Defer | No shift-inspection compliance board; alert fatigue | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-24 | Medium | Enhancement – defer | Defer | Fleet code has almost no behavioral tests | [fleet-equipment](R5-fleet-equipment.md) |
| RNG-18 | Medium | Enhancement – defer | Defer | No instructor certification or assignment check | [range](R3-range.md) |
| RNG-20 | Medium | Enhancement – defer | Defer | Range ammunition does not update inventory | [range](R3-range.md) |
| RNG-29 | Medium | Enhancement – defer | Defer | Roster built one officer at a time; no loaner in scheduled mode | [range](R3-range.md) |
| TRN-15 | Medium | Enhancement – defer | Defer | No leave/light-duty/waiver handling | [training](R4-training-notifications.md) |
| TRN-17 | Medium | Enhancement – defer | Defer | One-by-one rostering, no bulk actions | [training](R4-training-notifications.md) |
| TRN-24 | Medium | Enhancement – defer | Defer | Department items copied per user, no assignment | [training](R4-training-notifications.md) |
| TRN-33 | Medium | Enhancement – defer | Defer | Rostering/cancel/reschedule notifies nobody | [training](R4-training-notifications.md) |
| TRN-37 | Medium | Enhancement – defer | Defer | Thin tests for risky logic | [training](R4-training-notifications.md) |
| ADM-11 | Low | Enhancement – defer | Defer | Shallow drill-downs, no export or print | [admin](R6-admin-onboarding.md) |
| ADM-16 | Low | Enhancement – defer | Defer | Fixed global roles | [admin](R6-admin-onboarding.md) |
| ADM-35 | Low | Enhancement – defer | Defer | No transfer history | [admin](R6-admin-onboarding.md) |
| EQP-13 | Low | Enhancement – defer | Defer | Equipment list is a desktop table; no My Gear view | [fleet-equipment](R5-fleet-equipment.md) |
| EQP-15 | Low | Enhancement – defer | Defer | Readiness and custody lack behavioral tests | [fleet-equipment](R5-fleet-equipment.md) |
| FLT-16 | Low | Enhancement – defer | Defer | Fleet pages are desktop layouts with small tap targets | [fleet-equipment](R5-fleet-equipment.md) |
| RNG-30 | Low | Enhancement – defer | Defer | Mobile layout: stacked tabs, small targets | [range](R3-range.md) |
| RNG-31 | Low | Enhancement – defer | Defer | Drill library only inside a Range Day; edits overwrite authorship | [range](R3-range.md) |
| RNG-33 | Low | Enhancement – defer | Defer | Printed packet is the only offline fallback | [range](R3-range.md) |
| RNG-34 | Low | Enhancement – defer | Defer | workspace-write-policy.ts dead code; rules in three places | [range](R3-range.md) |
| RNG-35 | Low | Enhancement – defer | Defer | Stale page copies at repo root | [range](R3-range.md) |
| TRN-28 | Low | Enhancement – defer | Defer | Closeout lets manage_training issue/deactivate certs | [training](R4-training-notifications.md) |
| TRN-36 | Low | Enhancement – defer | Defer | Coordinator mobile layouts are wide tables | [training](R4-training-notifications.md) |
| TRN-38 | Low | Enhancement – defer | Defer | Dead quick-create modal | [training](R4-training-notifications.md) |
| ADM-28 | Low | Outdated / not applicable | Close | Admin reset depends on Supabase email template | [admin](R6-admin-onboarding.md) |
