# TracePoint Audit: Training, Certifications, Alerts and Notifications

**Method:** I read the source code only. **Nothing was executed at runtime.** I did not run tests, the app, the database, or the email dispatcher. I made no changes to the repo. Every finding comes from reading handlers, SQL migrations, and UI components under `/home/user/tracepoint`. A claim is marked "Confirmed defect" only when the code path was read end to end. Anything that depends on deployment configuration not in the repo is marked "Potential gap".

---

## 1. Workflow inventory

| Workflow | Route(s) / API | Operational purpose | Primary roles |
|---|---|---|---|
| Agency training event scheduling | `/agency-training` page + `AgencyTrainingEventEditor`; `POST/PATCH /api/agency-training/events[/:id]` | Create in-service or outside-instructor training events, link a library course, assign instructors | Training coordinator (`manage_training`) |
| Course library | `GET/POST /api/agency-training/courses`, `courses/[courseId]` | Canonical course titles and aliases, default hours, and an optional certification type | Training coordinator |
| Roster and attendance | `AgencyTrainingRosterBoard`; `GET/PUT /api/agency-training/events/:id/roster` | Assign personnel, record attendance, outcome, hours, score and remedial notes | Coordinator / instructor |
| Closeout and reopen | `AgencyTrainingCloseoutPanel`; `POST .../closeout` → RPC `close_agency_training_event`; `PATCH .../events/:id {reopen}` → RPC `reopen_agency_training_event` | Lock results, issue `training_certifications` and PDF certificates, reopen with a reason | Coordinator |
| Training files | `GET/POST .../events/:id/files`, `/api/attachments/:id` | Lesson plan (can be required for closeout) and supporting documents | Coordinator |
| Completion certificate PDF | `GET .../events/:id/certificates/:certId` | Officer downloads their own certificate. Managers can download any. | Officer, coordinator |
| Event CSV report | `GET .../events/:id/report` | Export of roster results | Coordinator |
| Recurring training requirements | Settings → `AgencyTrainingRulesPanel`; `GET/POST/PATCH/DELETE /api/agency-training/requirements` | Interval, scope (rank/unit), grace period, warning days, notification flags | Coordinator / admin |
| Certification records | `/training/certifications`; `GET/POST /api/training/certifications`, `PATCH/DELETE .../[certificationId]` | Officer-held credentials (CPR, EMT, instructor certs) with expiry | Certification manager (`manage_certifications`) |
| Certification types and requirements | `/api/training/certification-types`, `/api/training/certification-requirements` | Catalog, and which types are required for readiness | Certification manager |
| Certification readiness (department) | `GET /api/readiness/certifications` (used only by `/command-dashboard`) | Current / due soon / expired / missing for each officer | Command staff |
| Training hub | `/training` | Card links to qualifications, certifications, range, alerts | All |
| Training Alerts and remediation | `/training-alerts` (`TrainingAlertsClient`); `/api/pilot/performance-summary`, `/api/pilot/remediations` | Range performance concerns turned into remediation records | Coordinator (`manage_training`), analytics viewers |
| Officer home ("My Home") | `/` (`src/app/page.tsx`) → `GET/PATCH /api/notifications` | Personal action items plus a "department" action list for managers | Everyone |
| Operational inbox | `/notifications` → same API | Full inbox with acknowledge, snooze and preferences | Everyone (not in the nav) |
| Notification preferences | `/notifications` (inline) and Settings → `NotificationPreferencesPanel`; `PUT /api/notifications/preferences` | In-app / email / critical-only / digest / per-source toggles | Everyone (Settings panel is admin-gated) |
| Email delivery | `POST /api/notifications/email-dispatch` (bearer secret) → Brevo | Sends queued `notification_email_queue` rows as digests | System (needs an external invoker) |

---

## 2. Role-based end-to-end assessments

### A. Coordinator schedules an in-service, rosters 30 officers, takes attendance, closes out, credits hours
1. Nav → Agency Training → **New Event** opens the editor. About 8–12 fields: course search, dates, instructor, hours, lesson-plan flag, certificate flag. There is **no certification-type field**, even when the course has one (TRN-03).
2. Times are entered in a `datetime-local` field with no timezone. The server parses them in its own timezone (UTC), and each later edit shifts the time again (TRN-02).
3. Select event → Roster → **Add Personnel**. Officers must be checked one at a time. There is no "add by unit/rank/group" and no "select all" (TRN-17). That is about 30 clicks, then Add.
4. Each officer needs an attendance select, an outcome select and hours: about 60–90 controls. There is no "mark all present / completed" bulk action. Choosing any outcome silently sets attendance to "Present", including for no-shows (TRN-04).
5. **Save Roster**. This is a full replace. It rewrites `recorded_at` and `recorded_by` for every row (TRN-12).
6. Attach the lesson plan if one is required, then **Complete Event** and confirm. Closeout reads the database, not unsaved grid edits (TRN-18).
7. Result: PDF certificates are issued if enabled. **No `training_certifications` row is created**, because the UI never sets `certification_type_id` (TRN-03). The coordinator must re-key each officer's credential in `/training/certifications`, about 7 fields × 30 officers. Hours are stored per attendee, but **no per-officer hours total or transcript exists anywhere** (TRN-21).

**Total:** roughly 150+ interactions for one 30-person class, plus duplicate credential entry.

### B. Officer completes outside training and wants credit
There is no officer self-service at all. Officers cannot POST certifications (`manage_certifications` is required). There is no "submit for verification" state, no verifier field, and no file upload (only a free-text "Document link" URL). The officer must email the coordinator, who keys the record. Outside training **cannot satisfy an agency training requirement at all**, because requirement compliance only counts attendees of completed internal `agency_training_events` (TRN-09).

### C. Certification nearing expiry: who is told, when, and how?
1. A notification is computed only inside `GET /api/notifications`, which runs when *that user* opens My Home or `/notifications`. Nothing runs on a schedule. An officer who does not log in never gets an event row and never gets an email queued (TRN-01).
2. The notification goes only to the officer. Supervisors and command staff are never notified about subordinates' certifications (`if (row.userId !== context.user.id) continue;`) (TRN-06).
3. Email defaults to `critical_email_only = true`, and "due soon" is priority High, so **by default no advance email is ever sent**. An email is queued only once the credential is *expired* (Critical) (TRN-05).
4. The per-credential "Reminder schedule" chips in the UI (180/90/60/30/14/7/0) are stored and never read (TRN-07).
5. Even when queued, delivery needs something outside the repo to POST `/api/notifications/email-dispatch`. No cron or scheduler is defined in the repo (TRN-08).
6. The alert text says "expires in N days", so its fingerprint changes every day. A snooze is wiped daily and a new email row is queued each day for expired items (TRN-10).

### D. Officer on leave or separated
There is no leave, light-duty or waiver concept. `department_memberships` has only `is_active` and `activation_status`. An officer on extended leave shows as overdue and generates Critical alerts for themselves and for training staff, with no exemption (TRN-15). A separated (deactivated) officer drops out of readiness. But a roster that contains them can no longer be saved, because all roster IDs must be active (TRN-11). Their pending digest emails can still be sent, because cancellation needs the event to be resolved, and that only happens on *their own* inbox load (TRN-16).

### E. Supervisor wants only their squad's readiness
There is no supervisor→team relationship. `department_groups`, `department_group_members` and `department_units` exist (migration `202608190004`) but are not used by training, certification or notification code. Readiness is either self-only or department-wide (`/api/readiness/certifications` returns the whole department, and requires command/analytics/cert-manager permission). A sergeant without those permissions sees nothing about their squad. With them, they see everyone (TRN-14).

### F. Officer acknowledges a notification
- On My Home, Acknowledge is hidden for certification and equipment readiness, but **shown** for qualification and agency-training readiness. The API rejects those with 409 (TRN-13).
- On `/notifications`, Acknowledge is shown for every item. Snooze is fixed at "1 day".
- Department-scope items are copied per user. One manager acknowledging does not clear the item for others. There is no "claimed by" or assignment (TRN-24).

### G. Alerts from other modules
Off-duty approval events are written directly to `notification_events` with source "Off-Duty". They are **never emailed**, cannot be filtered or muted in the inbox UI, and re-notifying after a resubmit or second decision fails silently on the unique key (TRN-19). Range failures alert only the officer, not range staff or supervisors (TRN-06). Training Alerts (remediation) is a separate, pull-only page whose alert status lives in browser localStorage (TRN-20). The `/notifications` page source filter lists only 4 of the 9+ sources (TRN-22).

### H. Email deliverability failure
A failed send is marked `Failed` in `notification_email_queue` and kept forever. There is no UI, no admin report, and no in-app indication to the user. The Brevo bounce/complaint feedback is not wired. The `email_suppressions` table is never consulted by the dispatcher (TRN-23).

---

## 3. Findings

### TRN-01: Notifications and email reminders are generated only when the recipient opens their inbox
- **Classification:** Confirmed defect. **Priority:** Critical. **Module:** Notifications / email.
- **Scenario:** A patrol officer's required CPR certification expires while they are on nights and never open TracePoint. No notification row is created and no email is ever queued. The supervisor is not told either (TRN-06).
- **Evidence:**
  - `src/app/api/notifications/route.ts:1091` — `await eventWriter.upsertEvent(reconciliation.row);` and the `eventWriter.upsertEmail({...})` that follows run only inside `export async function GET`, and only for `context.user.id`.
  - The only writer of `notification_email_queue` is `src/lib/notifications/event-writer-supabase.ts` (`upsertEmail`), and it is called only from this GET. `grep notification_email_queue src` → only the dispatcher and this writer.
- **Fix:** Add a scheduled server-side evaluator, per department and per user, that runs the collectors with a service context and writes events and queue rows. It should be independent of user page loads.
- **Benefit:** Reminders actually reach officers who don't log in, which is the main purpose of expiry reminders.
- **Complexity:** L.

### TRN-02: Event times drift by the user's UTC offset on create and on every edit
- **Classification:** Confirmed defect (assumes the server process runs in UTC, the container default; no `TZ` is set in `Dockerfile` or `infra/lib/runtime-stack.ts`). **Priority:** High. **Module:** Agency training.
- **Scenario:** A coordinator in Pacific time schedules 18:00. It is stored as 18:00Z and shown as 11:00. Editing anything and saving re-sends "11:00", which is stored as 11:00Z. The time drifts 7 hours on each save. Rostered officers show up at the wrong time.
- **Evidence:**
  - `AgencyTrainingEventEditor.tsx:115-119` (`localDateTimeValue`) converts ISO to local for display.
  - `:410` sends `startsAt: draft.startsAt` (no offset).
  - `api/agency-training/events/route.ts` `dateTimeOrNull` → `new Date(valueText)` parses in server-local time. The same happens in `[eventId]/route.ts` `dateTimeOrNull`.
- **Fix:** Convert to ISO with an offset on the client (`new Date(local).toISOString()`), or store the agency's IANA timezone and convert on the server.
- **Benefit:** Correct schedules and correct certificate issue dates (closeout uses `starts_at::date`).
- **Complexity:** S.

### TRN-03: Training closeout never issues certification records from UI-created events
- **Classification:** Confirmed defect. **Priority:** High. **Module:** Agency training ↔ Certifications.
- **Scenario:** CPR recertification class is closed out. Officers get PDF certificates, but their CPR `training_certifications` record (which drives readiness and expiry alerts) is not created. CPR shows "Expired/Missing" until someone re-enters 30 records by hand.
- **Evidence:**
  - Closeout issues certifications only `if event_row.certification_type_id is not null` (`20260828040000_agency_training_closeout.sql:81`).
  - Event POST reads `body.certificationTypeId` only (`events/route.ts:130`). PATCH has no certification field at all.
  - The editor never sends it: `grep certificationTypeId AgencyTrainingEventEditor.tsx` → no match.
  - Courses *store* `certification_type_id` (`courses/route.ts:~103`), but the event does not inherit it.
- **Fix:** Inherit `certification_type_id` and `certification_valid_days` from the linked course on create/update. Expose them in the editor. Show "will issue: CPR (2 yr)" on the closeout panel.
- **Benefit:** Removes duplicate data entry and keeps readiness accurate.
- **Complexity:** S–M.

### TRN-04: Picking an outcome forces attendance to "Present" (no-shows get recorded as present)
- **Classification:** Confirmed defect. **Priority:** High. **Module:** Roster.
- **Scenario:** An officer no-shows. The instructor marks attendance "No Show". Closeout requires every attendee to have a non-pending outcome, so the instructor sets the outcome to "Incomplete". Attendance flips silently to "Present", and the official training record now falsely shows attendance.
- **Evidence:** `AgencyTrainingRosterBoard.tsx:339-340` — `attendanceStatus: outcomeStatus === "pending" ? row.attendanceStatus : "present",`. The closeout RPC also does not cross-check attendance against outcome. `completed` with `no_show` is accepted (`closeout.sql` only checks `outcome_status = 'pending'`).
- **Fix:** Only auto-set attendance when it is still `assigned` and the outcome is completed or passed. Add a server and RPC rule: completed/passed requires present.
- **Benefit:** Attendance records that hold up in litigation and audits.
- **Complexity:** S.

### TRN-05: By default no advance email is sent for expiring certifications or training due soon
- **Classification:** Confirmed defect (a default-configuration defect). **Priority:** High. **Module:** Notifications.
- **Scenario:** An officer has email enabled with default preferences. The 60-, 30- and 7-day warnings are in-app only. The first email arrives after the credential has expired.
- **Evidence:**
  - `notifications/route.ts:786` — `critical_email_only: data?.critical_email_only ?? true`.
  - The queue condition requires `item.priority === "Critical"` when that flag is set.
  - Due soon is `priority: "High"` (certifications, ~route.ts:488). Agency training due soon is `High` or `Normal` (`agency-training-notifications.ts`, the `priority` line).
- **Fix:** Treat "due soon" for required credentials and training as email-eligible regardless of the critical-only flag. Or change the default and relabel the flag "Only email me when something is overdue".
- **Benefit:** Officers get the lead time reminders are meant to provide.
- **Complexity:** S.

### TRN-06: Supervisors and training staff are never notified about subordinates' certifications, qualifications or equipment
- **Classification:** Confirmed defect. **Priority:** High. **Module:** Notifications.
- **Scenario:** A range master is never alerted that Officer X failed qualification. A lieutenant is not told that three squad members' certifications have expired.
- **Evidence:**
  - `notifications/route.ts:452` — `if (row.userId !== context.user.id) continue;` (certifications).
  - The qualification collector has `if (userId !== context.user.id) { continue; }`. The equipment collector has `if (userId !== context.user.id) continue;`.
  - Only agency training generates `_staff` alerts (`agency-training-notifications.ts`, `if (isStaff && memberId !== currentUserId ...)`).
- **Fix:** Add staff/supervisor fan-out alerts for certifications, qualification failures and equipment. Scope them by unit or group (TRN-14).
- **Benefit:** Command visibility without having to visit dashboards.
- **Complexity:** M.

### TRN-07: The per-credential "Reminder schedule" in the UI is stored and never used
- **Classification:** Confirmed defect. **Priority:** Medium. **Module:** Certifications.
- **Scenario:** A coordinator sets reminders at 180/90/30 days for an instructor certification and believes they are active. Alerts actually start at the certification type's single `default_due_soon_days` (default 30).
- **Evidence:**
  - `training/certifications/page.tsx:1048-1075` renders the reminder chips. `api/training/certifications/route.ts:238` saves `reminder_days`.
  - `grep reminder_days src` shows no reader in `certification-readiness.ts` or the notifications route. Readiness uses `effectiveDueSoonDays` only.
  - Likewise, agency training `warning_days` uses only `Math.max(...)` (`agency-training-notifications.ts:69`).
- **Fix:** Either implement staged reminders (a queue item per threshold crossed) or remove the controls.
- **Benefit:** The UI matches the actual behavior.
- **Complexity:** M.

### TRN-08: No scheduled invoker for the email dispatcher exists in the repo
- **Classification:** Potential gap requiring operational validation. **Priority:** High. **Module:** Email.
- **Scenario:** Queue rows sit in `Pending` forever unless something outside the repo POSTs the dispatcher. "Immediate" digests are then not immediate.
- **Evidence:**
  - `api/notifications/email-dispatch/route.ts` requires `Bearer NOTIFICATION_DISPATCH_SECRET|CRON_SECRET`.
  - There is no `vercel.json`, no EventBridge or schedule in `infra/lib/*.ts` (only the secret is injected at `runtime-stack.ts:134`), no GitHub workflow cron, and no `pg_cron` in migrations.
- **Fix:** Add an EventBridge Scheduler or ECS scheduled task (every 5 min) in CDK. Alarm on queue age and on `Failed` count.
- **Benefit:** Delivery is guaranteed and observable.
- **Complexity:** S–M.

### TRN-09: Outside training cannot satisfy agency training requirements, and officers have no self-submission or verification flow
- **Classification:** Verified usability problem. **Priority:** High. **Module:** Agency training / Certifications.
- **Scenario:** An officer attends a state-academy defensive tactics course. The requirement "Annual DT" stays overdue. There is no way to record an external completion except creating a fake internal event, and no officer upload with supervisor verification.
- **Evidence:**
  - `agency-training-notifications.ts` completions query: `from("agency_training_attendees")...eq("agency_training_events.status","completed")` is the only source of completion.
  - `api/training/certifications/route.ts` POST: `if (!context.canManage) ... 403`.
  - Evidence is `document_url: text(body.documentUrl)`, a free-text URL. The table never renders it as a link (`page.tsx` has no `href` for `document_url`).
- **Fix:** Add an "external training completion" record: officer submits with an uploaded certificate (reuse the attachments store), then a coordinator verifies it (status, verifier, timestamp), and only then does it count toward requirements and certifications.
- **Benefit:** Removes email/paper side-channels and gives verified evidence.
- **Complexity:** L.

### TRN-10: Daily-changing alert text resets snoozes and queues a new email every day for expired items
- **Classification:** Confirmed defect. **Priority:** Medium. **Module:** Notifications.
- **Scenario:** An officer snoozes an "Expired" alert. The next day it is back. Every day they open the app, another email row is queued for the same expired credential.
- **Evidence:**
  - Fingerprint = `JSON.stringify(item)` (`event-reconciliation.ts:26`).
  - Detail includes a day count: `` `Certification expired ${Math.abs(remaining)} day...ago.` `` and `` `Certification expires in ${remaining} days.` `` (`certification-readiness.ts:~421, ~463`).
  - On a fingerprint change, `acknowledged_at`/`snoozed_until` are nulled (`event-reconciliation.ts`, `changed ? null : ...`).
  - The queue is unique on `(dept,user,key,fingerprint)`, so a new row is created each day.
- **Fix:** Build the fingerprint from stable fields (kind, status, expiration date). Render relative day counts at display time.
- **Benefit:** Snooze works, and there is no daily email spam.
- **Complexity:** S.

### TRN-11: A roster containing a since-deactivated officer can't be saved, and removing them deletes their attendance record
- **Classification:** Confirmed defect. **Priority:** Medium. **Module:** Roster.
- **Scenario:** An officer attends training on Monday and resigns Tuesday. The coordinator tries to record results on Wednesday and gets "One or more selected personnel are not active department members." The only workaround is removing the row, which hard-deletes the proof they attended.
- **Evidence:**
  - `roster/route.ts` PUT validates `.eq("is_active", true).in("user_id", userIds)` and requires an exact count.
  - The UI sends every row (`AgencyTrainingRosterBoard.tsx` `rows.map(...)`).
  - Removed rows are hard-deleted: `.from("agency_training_attendees").delete()...in("id", removedIds)`.
- **Fix:** Validate active status only for *newly added* user IDs. Keep existing attendees regardless of status. Soft-remove instead of deleting.
- **Benefit:** Historical records stay intact.
- **Complexity:** S.

### TRN-12: Each roster save rewrites "recorded by/at" and created_by on every row, so attendance attribution is lost
- **Classification:** Confirmed defect. **Priority:** Medium. **Module:** Roster / audit.
- **Scenario:** An instructor records results. Later the coordinator adds one person. Every row now says the coordinator recorded it at the later time. The audit trigger also writes N "updated" audit events per save, even for unchanged rows.
- **Evidence:**
  - `roster/route.ts:243` onward builds each row with `recorded_by_user_id: context.userId, recorded_at: new Date()..., created_by_user_id: context.userId` and then `.upsert(rows, { onConflict: "event_id,user_id" })`.
  - Trigger: `20260828030000_command_training_fleet_audit.sql` (after insert/update/delete on `agency_training_attendees`).
- **Fix:** Diff on the server. Update only changed rows, and only stamp `recorded_*` when attendance or outcome changed. Never overwrite `created_by`.
- **Benefit:** A trustworthy chain of custody for training records.
- **Complexity:** S–M.

### TRN-13: My Home shows "Acknowledge" on alerts the API refuses (409)
- **Classification:** Confirmed defect. **Priority:** Medium. **Module:** Home / Notifications UI.
- **Scenario:** An officer taps Acknowledge on "Qualification Overdue" or "Use of Force Refresher Due Soon" and gets an error banner.
- **Evidence:**
  - `src/app/page.tsx:169-181` `isConditionBasedReadiness` lists only certification and equipment kinds.
  - The API's `CONDITION_BASED_NOTIFICATION_KINDS` (`notifications/route.ts:~59-81`) also includes `qualification_*` and `agency_training_*`, and returns 409.
  - `/notifications/page.tsx` shows Acknowledge for every item.
- **Fix:** Return a `canAcknowledge` flag per item from the API, and render buttons from that flag.
- **Benefit:** No dead-end actions.
- **Complexity:** S.

### TRN-14: No supervisor→team scoping for readiness or alerts
- **Classification:** Verified usability problem. **Priority:** High. **Module:** Readiness / Notifications.
- **Scenario:** A sergeant needs the squad's expiring certifications before shift briefing. The options are nothing (no permission) or the whole department (command dashboard).
- **Evidence:**
  - `readiness/read-repository-supabase.ts` `listCertificationMembers` has a department filter only.
  - `readiness/certifications/route.ts` gates on `manage_certifications|view_command_dashboard|view_analytics`, with no scope parameter.
  - `department_groups`/`department_group_members` exist (`202608190004_department_organization.sql:65,106`), but `grep department_group src` shows use only in settings/invite/permissions.
- **Fix:** Add a "supervises group/unit" relationship, a `view_team_readiness` permission, and a team filter on readiness and staff alerts.
- **Benefit:** First-line supervisors can manage readiness, which is how agencies actually operate.
- **Complexity:** M–L.

### TRN-15: No leave, light-duty or waiver/exemption handling
- **Classification:** Verified usability problem. **Priority:** Medium. **Module:** Requirements / Readiness.
- **Scenario:** An officer on 6-month military leave shows as Critical and overdue on every dashboard, and staff are alerted daily. The only "fix" is deactivating the member, which removes them from rosters and readiness entirely.
- **Evidence:** Membership has only `is_active` and `activation_status` (`202608200002_personnel_activation_status.sql:20-26`). The requirement schema and the certification readiness evaluator have no waiver or exemption field (`agency_training_requirements` insert payload in `requirements/route.ts` POST).
- **Fix:** Add a member duty status (active, leave, light duty) with effective dates, and per-requirement exemptions with reason, approver and expiry. Exclude or annotate these in readiness.
- **Benefit:** Accurate readiness numbers and less alert fatigue.
- **Complexity:** M.

### TRN-16: Deactivated or separated users can still be emailed queued digests
- **Classification:** Potential gap requiring operational validation. **Priority:** Low. **Module:** Email.
- **Scenario:** An officer with a Weekly digest separates on Wednesday. Monday's digest still goes to their address, because their events are never resolved (they no longer load the inbox).
- **Evidence:**
  - The dispatcher cancels only if the event is `resolved_at`, acknowledged or snoozed (`email-dispatch/route.ts`, the `activeRows` loop).
  - There is no membership `is_active` check before sending.
- **Fix:** Join to active membership at dispatch time. Cancel queued rows when a member is deactivated.
- **Benefit:** No information sent to separated personnel.
- **Complexity:** S.

### TRN-17: Rostering is one person at a time; there are no unit/rank/group or "assign everyone required" actions
- **Classification:** Verified usability problem. **Priority:** Medium. **Module:** Roster.
- **Scenario:** Annual in-service for 120 sworn officers takes 120 checkbox clicks across several sessions. Officers who are due or overdue under a requirement are not suggested.
- **Evidence:** `AgencyTrainingRosterBoard.tsx` Add Personnel modal has only a text search and individual checkboxes. There is no bulk option (grep for "select all", "mark all" or unit filter returns nothing).
- **Fix:** Add "Add by unit/rank/group", "Add all members due under requirement X", and "Mark all present + completed".
- **Benefit:** Order-of-magnitude fewer clicks.
- **Complexity:** S–M.

### TRN-18: "Complete Event" ignores unsaved roster edits
- **Classification:** Verified usability problem. **Priority:** Medium. **Module:** Closeout.
- **Scenario:** An instructor fills in outcomes, forgets Save, and clicks Complete Event. Closeout fails with "Every attendee needs a final outcome", or it closes with stale results.
- **Evidence:**
  - `AgencyTrainingCloseoutPanel.tsx` `closeout()` POSTs directly. The panel receives no `saved`/dirty state from the RosterBoard (props: `eventId, eventStatus, canManage, onClosed`).
  - The closeout RPC reads the database rows.
- **Fix:** Disable Complete while the roster is dirty, or auto-save first. Add a `beforeunload` guard.
- **Benefit:** Prevents lost or incorrect records.
- **Complexity:** S.

### TRN-19: Off-duty approval notifications are not emailed, can't be filtered, and re-notification fails silently
- **Classification:** Confirmed defect. **Priority:** High. **Module:** Notifications ↔ Off-duty.
- **Scenario:**
  - Command reviewers are never emailed about pending off-duty firearm approvals.
  - After an officer resubmits a returned request, reviewers get *no* new notification.
  - An officer whose request was Returned and then Approved gets no approval notice.
- **Evidence:**
  - `api/off-duty-firearms/route.ts:~366-397` and `[requestId]/route.ts:~219-245, ~305-337` call `.from("notification_events").upsert(rows)` **without `onConflict`**. PostgREST defaults to the primary key `id`, so a second insert for the same `(department_id,user_id,notification_key)` hits unique index `notification_events_user_key_uidx` and errors.
  - The errors are swallowed with `console.error(...)`.
  - There is no `notification_email_queue` insert for "Off-Duty".
  - "Off-Duty" is not in the inbox `Source` type, nor in the `/notifications` source list (`page.tsx:34`).
- **Fix:** Use `onConflict: "department_id,user_id,notification_key"`. Route these through the shared writer, including email queuing. Add "Off-Duty" to sources and preferences.
- **Benefit:** One inbox that actually covers approvals.
- **Complexity:** S.

### TRN-20: Training Alerts status and audit trail live in browser localStorage; remediations are one last-writer-wins JSON blob
- **Classification:** Confirmed defect. **Priority:** High. **Module:** Training Alerts / remediation.
- **Scenario:** Coordinator A marks an alert "Escalated". Coordinator B (or A on another PC) still sees "Open". Two coordinators editing remediations overwrite each other. The "audit log" entries have no actor or timestamp. "Escalated to Command" sets `commandNotified: true`, but nobody is notified.
- **Evidence:**
  - `TrainingAlertsClient.tsx:~251-257` `window.localStorage.setItem(TRAINING_ALERTS_STORAGE_KEY, JSON.stringify(alerts))`.
  - `updateAlertStatus` updates React state only (`:~339-353`).
  - `assignRemediation` hard-codes `assignedInstructor: "Range Master", dueDate: "Next scheduled range block"`.
  - `api/pilot/remediations/route.ts:~104-116` upserts the whole `remediations` array per department, and the audit records only `remediation_count`.
  - The page header promises to "preserve the audit trail from concern to resolution".
- **Fix:** Add server tables for alert dispositions and remediation records (row-level, with actor and timestamp). Notify on escalation. Link to agency-training `remedial_required` outcomes.
- **Benefit:** A defensible early-intervention record.
- **Complexity:** M–L.

### TRN-21: No per-officer training hours or transcript view
- **Classification:** Verified usability problem. **Priority:** High. **Module:** Agency training.
- **Scenario:** A state POST audit asks for each officer's annual in-service hours. Hours exist per attendee row, but nothing sums them, and officers can't see their own training history.
- **Evidence:**
  - `grep hours_completed|training_hours` → only the roster, report CSV (per event) and certificate PDF.
  - `/agency-training` lists all department events with no "my training" filter.
  - The `/training` hub "Training History" card links to `/qualifications` (`training/page.tsx:13-16`).
- **Fix:** Add an officer transcript (events, hours, certificates, certifications) and a department hours report by date range and category.
- **Benefit:** Meets mandate reporting; officers self-serve.
- **Complexity:** M.

### TRN-22: The inbox UI covers only 4 of the notification sources
- **Classification:** Confirmed defect. **Priority:** Medium. **Module:** Notifications UI.
- **Scenario:** An officer wants to filter to Training items, or to mute Fleet. Those sources don't appear. The header says "alerts from Ammunition, Personal Rifles, Inspections, and Range Operations" even though Training, Qualifications, Equipment, Fleet and Off-Duty items appear.
- **Evidence:** `notifications/page.tsx:34` `const sources = ["Personal Rifle", "Ammunition", "Inspection", "Range"];`. The header text is in the same file. The API `Source` union has 8 values plus "Off-Duty" written elsewhere.
- **Fix:** Get the sources from the API.
- **Benefit:** Usable filtering.
- **Complexity:** S.

### TRN-23: Email failures are invisible; Brevo bounces and suppressions aren't handled
- **Classification:** Confirmed defect. **Priority:** Medium. **Module:** Email.
- **Scenario:** An officer's mailbox is full or the address is invalid. Their queue rows go to `Failed` and nobody ever learns. Rows can also stay stuck in `Processing` permanently (as documented).
- **Evidence:**
  - `email-dispatch/route.ts` `retryRows(...)` sets `status: terminal ? "Failed" : "Pending"`.
  - `grep notification_email_queue src` → no admin or reporting reader.
  - The `email_suppressions` table (`202609050005_ses_feedback_persistence.sql`) is never read by the dispatcher. There is no Brevo webhook route.
  - `docs/aws-email-reconciliation-20260905.md`: "the claimed row remains Processing and is not automatically reclaimed."
- **Fix:** Add an admin "Email delivery health" view (failed/stuck by user). Add an in-app banner "We couldn't email you". Add a Brevo webhook to record suppressions, and check them before sending.
- **Benefit:** Operators can trust that the email channel works.
- **Complexity:** M.

### TRN-24: Department inbox items are copied per user with no assignment or shared state
- **Classification:** Verified usability problem. **Priority:** Medium. **Module:** Notifications.
- **Scenario:** Five sergeants with `review_off_duty_requests` all see the same item. One handles it and the others still see it until the request is resolved. For readiness items, every staff member must snooze individually each day.
- **Evidence:** Events are keyed `(department_id, user_id, notification_key)`. PATCH updates only `.eq("user_id", context.user.id)` (`notifications/route.ts` PATCH).
- **Fix:** Add shared department work items with claim/assign and resolution notes.
- **Benefit:** Less duplicated effort and clear ownership.
- **Complexity:** M.

### TRN-25: Staff training alerts scale as officers × requirements, written one at a time on every home-page load
- **Classification:** Potential gap requiring operational validation (performance). **Priority:** Medium. **Module:** Notifications.
- **Scenario:** In a 250-officer agency with 8 requirements, a coordinator could get hundreds of items. The GET does sequential `await eventWriter.upsertEvent` per item, plus 6 internal HTTP fan-out calls, on every My Home load. That means slow home pages and heavy database load.
- **Evidence:**
  - `notifications/route.ts` `for (const item of filtered) { ... await eventWriter.upsertEvent(...)`.
  - `internalJson(request, "/api/armory/...")` ×6.
  - `agency-training-notifications.ts` loops over `requirements × members`.
- **Fix:** Batch the upserts. Aggregate staff alerts ("12 members overdue for UOF Refresher"). Move evaluation to the scheduled job (TRN-01).
- **Benefit:** A responsive home page and readable staff alerts.
- **Complexity:** M.

### TRN-26: Any department member can read every officer's training results, remedial notes and certification records
- **Classification:** Confirmed defect (privacy / need-to-know). **Priority:** High. **Module:** Roster / Certifications / RLS.
- **Scenario:** A patrol officer opens a classmate's roster and reads "remedial_notes: failed handcuffing, retrain". They can also see all colleagues' credential numbers and notes on `/training/certifications`.
- **Evidence:**
  - `roster/route.ts` GET has no permission check (only `resolveServerAccess`). It returns `scoreText`, `resultNotes`, `remedialNotes`.
  - `api/training/certifications/route.ts` GET returns `training_certifications.select("*")` for the whole department to any member with the feature (`training/read-repository-supabase.ts listCertifications`).
  - RLS: `"department members can view agency training attendees"` (`20260827203000_agency_training_v1.sql:191-193`) and `"department members can view training certifications"` (`202608060001_training_certifications.sql:104-106`) remain SELECT policies. The later migration only replaced non-SELECT policies (`202609060003...:402-406`, `cmd <> 'SELECT'`).
  - By contrast, the CSV report *is* gated to `manage_training`, which is inconsistent.
- **Fix:** Self-or-manager visibility at the API and in RLS. Expose only name/attendance to non-managers if needed.
- **Benefit:** Protects sensitive personnel information (remediation can be discoverable in discipline cases).
- **Complexity:** S–M.

### TRN-27: Reopening a closed event deactivates its credentials but doesn't restore the ones it superseded
- **Classification:** Confirmed defect. **Priority:** Medium. **Module:** Closeout / Certifications.
- **Scenario:** CPR class closeout supersedes each officer's prior valid CPR certification (sets `is_active=false`). The coordinator reopens to fix a typo. Now *both* the new and prior certs are inactive, and every attendee shows "Missing CPR" (Critical alerts and emails) until the event is re-closed.
- **Evidence:**
  - Closeout: `update public.training_certifications prior set is_active = false ... and prior.issue_date <= issue_date_value` (`closeout.sql:137-147`).
  - Reopen: deactivates only `source_training_event_id = p_event_id` (`closeout.sql:220-222`). The superseded rows are never reactivated.
  - Superseding also ignores a prior cert that expires *later* than the new one.
- **Fix:** Record `superseded_by_certification_id` and reactivate on reopen. Only supersede when the new expiration is greater or equal.
- **Benefit:** No false readiness failures from corrections.
- **Complexity:** S–M.

### TRN-28: Closeout lets `manage_training` issue and deactivate certifications without `manage_certifications`
- **Classification:** Potential gap requiring operational validation (separation of duties). **Priority:** Low. **Module:** Permissions.
- **Scenario:** An agency deliberately separates the instructor role (`manage_training`) from the records/credentialing role. The instructor can still create and deactivate officer certifications through closeout and reopen.
- **Evidence:** `closeout/route.ts` checks only `["manage_training"]`. The RPCs are `security definer` and write `training_certifications`. RLS for direct writes requires `manage_certifications` (`202609050002...:391-397`).
- **Fix:** Require both permissions when the event issues certifications, or document this as intended.
- **Complexity:** S.

### TRN-29: Certification record API has weak validation and allows rewriting history
- **Classification:** Confirmed defect. **Priority:** Medium. **Module:** Certifications.
- **Scenario:**
  - An invalid or garbled date string returns a raw Postgres error with status 500.
  - A future issue date is accepted.
  - PATCH can move a certification to a *different officer* (`user_id: userId`), including closeout-generated records whose `source_training_attendee_id` then points to the wrong person.
  - DELETE needs no reason.
  - `documentUrl` accepts any string (for example a `javascript:` URL), though it is not currently rendered as a link.
- **Evidence:**
  - `api/training/certifications/route.ts` `dateOrNull` returns trimmed text unchanged.
  - `[certificationId]/route.ts` PATCH update includes `user_id: userId`.
  - DELETE sets `is_active:false` with no reason.
  - Only the DB check `expiration_date >= issue_date` exists (`202608060001:58-60`).
- **Fix:** Validate ISO dates (issue ≤ today ≤ …). Make `user_id` immutable. Lock `record_origin='agency_training'` rows to the source event. Require a reason on deactivation. Validate URL scheme or replace with an upload.
- **Complexity:** S.

### TRN-30: Event and requirement APIs accept inconsistent or invalid state
- **Classification:** Confirmed defect. **Priority:** Low–Medium. **Module:** Agency training API.
- **Evidence and scenario:**
  - (a) `events/route.ts` `VALID_STATUSES` includes `"completed"` on POST, so an event can be created "completed" without closeout, roster or certificate issuance.
  - (b) PATCH accepts `title: ""` and `endsAt < startsAt` (no checks in `[eventId]/route.ts`). An invalid `status` is silently ignored.
  - (c) `courseId` (events) and `certificationTypeId` (courses) are not checked against the department.
  - (d) Requirements accept `completion_date` basis with no interval, so `dueDate` returns null and the requirement is never due again after one completion (`agency-training-notifications.ts` `dueDate`).
  - (e) `selectedMemberIds` are not validated as members.
  - (f) The roster PUT `throw new Error("...invalid attendance status.")` at `roster/route.ts:243-255` is outside any try/catch, so it surfaces as a 500 instead of a 400.
  - (g) Requirement DELETE is a hard delete (history is lost).
- **Fix:** Add server validation for each case. Disallow `completed` outside the RPC. Soft-delete requirements.
- **Complexity:** S.

### TRN-31: Requirement configuration needs Settings access a training coordinator usually lacks; the hub says it's "Coming next"
- **Classification:** Confirmed defect. **Priority:** Medium. **Module:** Navigation / permissions.
- **Scenario:** A coordinator with only `manage_training` can create requirements through the API, but the only UI (Settings → Agency Training Rules) is blocked by the proxy rule. Meanwhile `/training` shows "Training Requirements — Coming next".
- **Evidence:**
  - `permissions.ts` route rule `{ prefix: "/settings", requirement: { anyOf: ["manage_users","view_audit_log","administer_department"] } }`, enforced in `lib/supabase/proxy.ts:~320`.
  - Panel at `settings/page.tsx:4227-4231`.
  - `training/page.tsx:30-36` `comingSoon: true`.
  - Officers likewise can't reach the Settings `NotificationPreferencesPanel` (digest mode). They only get the reduced inline preferences on `/notifications`, which has no digest selector.
- **Fix:** Move requirements to `/agency-training/requirements`, gated on `manage_training`. Fix the hub card. Move personal notification preferences out of admin Settings.
- **Complexity:** S–M.

### TRN-32: Requirement scope values are free text, not linked to units, ranks or groups
- **Classification:** Verified usability problem. **Priority:** Medium. **Module:** Requirements.
- **Scenario:** "Patrol Div" vs "Patrol Division" — a typo silently excludes the whole unit from a mandatory requirement, with no warning.
- **Evidence:**
  - `AgencyTrainingRulesPanel.tsx` `scopeValues: draft.scopeValues.split(",")`.
  - Matching is `values.has(lower(member.unit_name))` (`agency-training-notifications.ts` `applies`).
  - The `department_units` and `department_titles` tables exist but are unused here. The `selected_members` scope is supported by the API but not offered in the UI.
- **Fix:** Use pickers bound to the units, titles and groups tables. Show a preview "applies to N members".
- **Complexity:** S–M.

### TRN-33: Rostering, cancelling or rescheduling a training event notifies nobody
- **Classification:** Verified usability problem. **Priority:** Medium. **Module:** Agency training ↔ Notifications.
- **Scenario:** An officer is added to Saturday's in-service and is never told. A cancellation is not communicated either. (Range days *do* notify rostered officers.)
- **Evidence:** `agency-training-notifications.ts` generates only requirement missing/due/overdue kinds. Compare `collectRange` → `range_officer_assignment` in `notifications/route.ts`.
- **Fix:** Add `agency_training_assignment`, `..._changed` and `..._cancelled` notifications, plus an ICS attachment.
- **Complexity:** S–M.

### TRN-34: Snooze is unvalidated and fixed at 1 day in the UI
- **Classification:** Confirmed defect (API) / Verified usability problem (UI). **Priority:** Low. **Module:** Notifications.
- **Evidence:**
  - `notifications/route.ts` PATCH `snoozed_until: body.snoozedUntil || ...` has no date validation and no maximum. A client can snooze a Critical readiness alert until 9999, and a malformed value causes a database error (500).
  - The UI offers only "Snooze 1 Day".
- **Fix:** Validate, cap (for example 14 days, shorter for Critical), and offer a few choices.
- **Complexity:** S.

### TRN-35: Turning off "In-app notifications" silently turns off email and resolves everything
- **Classification:** Confirmed defect. **Priority:** Low–Medium. **Module:** Notifications.
- **Evidence:**
  - `notifications/route.ts:1055` `const filtered = preferences.in_app_enabled ? generated.filter(...) : [];`. Then every existing event from a successful source is resolved, and the email loop iterates over `filtered`, which is empty.
  - Per-source opt-out likewise mutes mandatory readiness alerts.
- **Fix:** Separate channel preferences from generation. Don't allow muting mandatory readiness sources.
- **Complexity:** S.

### TRN-36: Mobile layouts for core coordinator tasks are wide desktop tables
- **Classification:** Verified usability problem. **Priority:** Low. **Module:** Roster / Certifications.
- **Scenario:** An instructor taking attendance on a tablet or phone at the range or mat room has to scroll horizontally through a 1050px table.
- **Evidence:** `AgencyTrainingRosterBoard.tsx:291` `min-w-[1050px]`. `training/certifications/page.tsx:721` `min-w-[980px]`. There is no card layout.
- **Fix:** Add a card-per-attendee mobile layout with large present/complete toggles.
- **Complexity:** M.

### TRN-37: Thin test coverage for the riskiest logic
- **Classification:** Optional improvement. **Priority:** Medium. **Module:** Tests.
- **Evidence:** There are tests for the repository wrappers, reconciliation and Brevo outcome mapping. There are **no tests** for:
  - `close_agency_training_event`/`reopen` SQL
  - `agency-training-notifications.ts` due-date and scope math
  - `certification-readiness.ts` (no test file)
  - the roster PUT
  - the email-dispatch route
  - the notification GET email-queue rules
  
  Several existing tests are source-text assertions (for example `qualification-training-hotfix.test.ts`, `granular-permissions.test.ts`). `package.json` has no `test` script.
- **Fix:** Add unit tests for the due-date and readiness math, and SQL tests for closeout/reopen (supersede and restore).
- **Complexity:** M.

### TRN-38: The quick-create event form in the page is dead code that diverges from the editor
- **Classification:** Optional improvement. **Priority:** Low. **Module:** Agency training UI.
- **Evidence:** `agency-training/page.tsx:~646-760` `showCreate` modal (separate POST without course or instructor). `setShowCreate(true)` is never called. The live button uses `setEditorEvent(null)` (`:331`).
- **Fix:** Remove it.
- **Complexity:** S.

---

## 4. Cross-module integration gaps and terminology inconsistencies

**Integration gaps**
1. **There are four parallel "training" record systems with no linkage:**
   - Agency Training events and requirements (`agency_training_*`)
   - Certifications (`training_certifications`)
   - Qualifications / range (`qualification_results`)
   - Training Alerts remediations (a JSON blob plus localStorage)
   
   Closeout→certification only works when an API-only field is set (TRN-03). Roster `remedial_required` outcomes do not create remediation records. Range failures don't create agency training remedial events. Outside training feeds none of them (TRN-09).
2. **Readiness definitions differ by consumer.**
   - The notifications source filters requirements `is_required = true` (`notifications/read-repository-supabase.ts listCertificationRequirements`), but `/api/readiness/certifications` doesn't (`readiness/read-repository-supabase.ts`).
   - Agency training compliance isn't part of either the certification readiness API or the equipment readiness API, so command dashboard readiness ignores recurring training requirements unless a separate path exists.
3. **The notification "engine" is pull-based and per-user.** Off-duty writes its own events (no email). Training Alerts is a separate inbox. There is no global unread badge in `TracePointShell`, and `/notifications` is not in the nav.
4. **Organization model (units, titles, groups) is unused** by requirement scope, readiness, staff alerts and rostering.
5. **Email** depends on an external scheduler (not in the repo), there is no deliverability feedback, and the SES suppression tables are unused by the Brevo path.

**Terminology inconsistencies**

| Concept | Terms used | Where |
|---|---|---|
| Agency-run courses | "Agency Training", "Training Events", "Training Record", "Training Record Package" | nav, page header, closeout panel |
| Credentials | "Certifications" (records), "Certificates" (closeout PDFs), "Credentials", "certification_title" | `/training/certifications`, closeout panel, form copy |
| Recurring mandates | "Training Requirements" (hub, "Coming next"), "Agency Training Rules" (Settings), "recurring training" (API errors), "Required for agency readiness" (certifications) | `training/page.tsx`, `settings/page.tsx:4227`, `requirements/route.ts` |
| Alerts | "Training Alerts Inbox" (remediation), "Operational Inbox" (`/notifications`), "My Home" actions, "Inbox Summary" (email) | three separate surfaces |
| Training history | "Training History" card → `/qualifications` (range scores), not agency training | `training/page.tsx:13-16` |
| Source labels | Notifications show "Training" for both certification and agency-training items; the home page lumps certification alerts into "Reviews, decisions, and certifications" via regex `/(review|approval|certif|decision)/` | `page.tsx:~428, 589` |
| Statuses | Agency: `draft/scheduled/in_progress/completed/cancelled`, outcomes `completed/passed/failed/incomplete/remedial_required`; certifications: "Due in N days / Expired / No Expiration"; qualifications: "Current / Due Soon / Overdue / Failed / No Record"; training alerts: "Remediation Assigned / Escalated / Dismissed with Reason" | multiple |
| Permissions | `manage_training` = "Manage Agency Training"; Training Alerts read-only copy says "requires Agency Training management permission"; the page is also visible to `view_analytics` | `permissions.ts:17-29` |

*All findings above come from reading the code; nothing was executed.*
