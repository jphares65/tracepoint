# Reconciliation: Appendix C (Training, Certifications, Alerts, Notifications) — TRN-01..TRN-38

- **Audit baseline:** `origin/main @ a3677a6` (Oct 7). Audit file: `/home/user/tracepoint/docs/operational-audit-20261020/appendix-c-training-notifications.md`.
- **Reconciled against:** `origin/codex/staging-mobile-api-release-20261007 @ 555f061` (Oct 9), read-only checkout at `/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/current`. a3677a6 is an ancestor of 555f061 (404 commits ahead).
- **Method:** I re-read every cited path in the current tree. I diffed a3677a6..555f061 over the audited areas. I scanned every `refs/remotes/*` branch tip for fix signatures. I ran 4 isolated `tsx` scripts against the real source (described below). No network calls. Nothing in `/home/user/tracepoint` or the checkout was modified.
- **What changed in the audited area since a3677a6:**
  - `notifications/route.ts`: small changes (internal fetch URL, ammunition gating, shadow logging, `date-value.ts` extraction).
  - `email-dispatch/route.ts`: now has a Postgres client and SES provider selection.
  - New Postgres event writer, plus `database/aws/007` (dispatcher grants), `008` (closeout wrapper) and `024` (server-only enqueue function).
  - New SES **feedback** Lambda (SNS→SQS→Lambda; it is not a dispatcher) and SES suppression check before sending.
  - New read-only `/api/mobile/inbox`.
  - **No changes** to any `agency-training` route or component, training certification routes, `certification-readiness.ts`, `agency-training-notifications.ts`, `event-reconciliation.ts`, `/notifications/page.tsx`, Training Alerts or off-duty notification writers.
- **Other branches:** none of the 41 remote branch tips has a fix for these findings. On every tip I checked:
  - there is no `Schedule.rate/cron`, `aws-scheduler` or `ScheduledFargateTask` in `infra/lib` (except `backup-recovery-stack.ts`);
  - the three `userId !== context.user.id` self-only filters are present;
  - `AgencyTrainingEventEditor.tsx` has no `certificationTypeId`;
  - the Training Alerts localStorage key is still used;
  - the Dockerfile sets no `TZ`;
  - the off-duty `notification_events` upserts have no `onConflict`;
  - the 4-source list is unchanged.

  Branches whose files differ, for example `feature/permission-controlled-editing-20260905`, have *older* versions. The audit branch `claude/tracepoint-operational-audit-w567t8` adds only docs.

## Counts

| Classification | Count | IDs |
|---|---|---|
| Confirmed applicable defect | 24 | 01, 02, 03, 04, 05, 06, 07, 08, 10, 11, 12, 13, 18, 19, 20, 22, 26, 27, 29, 30, 31, 32, 34, 35 |
| Already resolved | 0 | — |
| Partially resolved | 2 | 16, 23 |
| Not applicable to current architecture | 0 | — |
| Enhancement rather than defect | 11 | 09, 14, 15, 17, 21, 24, 28, 33, 36, 37, 38 |
| Requires runtime verification | 1 | 25 |
| **Total** | **38** | |

**Priority changes:**
- **TRN-08** goes from High (potential gap) to **Critical (confirmed)** for the AWS-native target.
- **TRN-01** stays Critical, and is now worse because of the mobile inbox.
- **TRN-28** goes to Enhancement / Low, because DB migration 008 now explicitly encodes `manage_training` only.
- **TRN-16** and **TRN-23** are partly mitigated in AWS-native mode only.

All paths below are relative to the current checkout root.

## Findings table

| ID | Title | New classification | Revised priority | Current evidence (path:line — quote) | Note |
|---|---|---|---|---|---|
| TRN-01 | Notifications/emails generated only when recipient opens inbox | Confirmed applicable defect | Critical (unchanged) | `src/app/api/notifications/route.ts:925` `export async function GET`; `:1127` `await eventWriter.upsertEvent(reconciliation.row);`; `:1142` `try { await eventWriter.upsertEmail({`. The only `upsertEmail` caller in `src/`. `src/app/api/mobile/inbox/route.ts:67-88` only *reads* `notification_events` | No scheduled or server-side evaluator exists anywhere (infra, `src/app/api/internal/**` holds only `rehearsal-tenant-negative`, no workers). AWS enqueue `database/aws/024:14` `if session_user <> 'tracepoint_runtime'` and `:32-37` requires a matching `notification_events` row, so enqueue is tied to the request path. The mobile inbox makes this worse (see deep-dive). |
| TRN-02 | Event times drift by UTC offset on each save | Confirmed applicable defect | High (unchanged) | `src/app/components/AgencyTrainingEventEditor.tsx:115-119` `localDateTimeValue`; `:410` `startsAt: draft.startsAt,`; `src/app/api/agency-training/events/route.ts:47-51` and `[eventId]/route.ts:20-24` `const parsed = new Date(valueText);`. No `TZ` in `Dockerfile`/`Dockerfile.aws-native-production` (runner is `gcr.io/distroless/nodejs24-debian13`, line 38/34) or in the `infra/lib/runtime-stack.ts:96-117` env | Reproduced (Test 1): 18:00 PT becomes 11:00, then 04:00, then 21:00 the previous day over 3 saves. `departments` now has a `timezone` (`api/platform/agencies/route.ts:86`, default `America/New_York`), but training code does not use it. |
| TRN-03 | Closeout never issues certifications for UI-created events | Confirmed applicable defect | High | `supabase/migrations/20260828040000_agency_training_closeout.sql:81` `if event_row.certification_type_id is not null then`; `events/route.ts:130` `nullableText(body.certificationTypeId)`; editor has no `certificationTypeId` (grep: 0 matches); `[eventId]/route.ts` PATCH has no certification field; `courses/route.ts:103` stores `certification_type_id` | `database/aws/008` only wraps the RPC with an auth check (`:22-26`) and calls `close_agency_training_event_internal` unchanged. Not fixed on any branch. |
| TRN-04 | Picking an outcome forces attendance to Present | Confirmed applicable defect | High | `src/app/components/AgencyTrainingRosterBoard.tsx:340` `outcomeStatus === "pending" ? row.attendanceStatus : "present",`; closeout SQL `:50` checks only `outcome_status = 'pending'` | Unchanged. |
| TRN-05 | No advance email by default | Confirmed applicable defect | High | `notifications/route.ts:800` `critical_email_only: data?.critical_email_only ?? true`; `:1131-1135` `!preferences.critical_email_only \|\| item.priority === "Critical"`; due-soon `priority: "High"` `:506`; `agency-training-notifications.ts:83` gives High or Normal | Reproduced (Test 3): with default preferences, the due-soon items (High or Normal) are not queued and expired items (Critical) are queued. |
| TRN-06 | Supervisors/staff never notified about subordinates | Confirmed applicable defect | High | `notifications/route.ts:466` `if (row.userId !== context.user.id) continue;` (certifications); `:592` `if (userId !== context.user.id) {` (qualifications); `:696` `if (userId !== context.user.id) continue;` (equipment); only `agency-training-notifications.ts:91` `if (isStaff && memberId !== currentUserId && ...)` fans out | The self-only filter is **still present**. Test 2 shows the evaluator computes rows for other members, and the route then discards them. The mobile inbox is self-only (`mobile/inbox/route.ts:85-86` `.eq("department_id", departmentId).eq("user_id", userId)`). |
| TRN-07 | Per-credential reminder schedule never used | Confirmed applicable defect | Medium | `src/app/training/certifications/page.tsx:1055-1072` chips; `api/training/certifications/route.ts:20` `function reminderDays`; `certification-readiness.ts:31-38` credential type has no reminder field; `agency-training-notifications.ts:69` `Math.max(0, ...warningDays)` | `grep reminder_days src` finds only the page and the POST route. |
| TRN-08 | No scheduled invoker for email dispatcher | **Confirmed applicable defect** (AWS-native) | **Critical** (raised from High) | No `Schedule`/Scheduler/Rule targeting dispatch in `infra/lib/*.ts`. The only schedules are `backup-recovery-stack.ts:42,49` (backups). `ses-feedback-worker-stack.ts:117-145` is an SQS-triggered feedback Lambda (`entry: .../ses-feedback-handler.ts`). In AWS-native mode the proxy blocks bearer-only callers: `src/lib/authentication/request-proxy-core.ts:1-3` (public set excludes `/api/notifications/email-dispatch`), `request-proxy.ts:51-52,17-18` returns 401 with no session. Legacy `src/lib/supabase/proxy.ts:13` does list it as public | Legacy (bridge) production has an out-of-repo pg_cron job, `tracepoint-notification-email-dispatch` `*/15`, calling Vercel (`docs/final-cutover-proof-addendum-20260926.md:14`). The cutover runbook **pauses** it (`supabase/production-cutover/20260927_activate_source_fence.sql:124` `cron.alter_job(jobid, active := false)`). `docs/operational-source-quiescence-20260927.md:63` says "Production EventBridge Scheduler had zero schedules". Test 4: after cutover, no in-repo invoker exists, and an external bearer-secret invoker would get 401 from the proxy. |
| TRN-09 | Outside training can't satisfy requirements; no self-submission | Enhancement rather than defect | High | `agency-training-notifications.ts:42` `.eq("agency_training_events.status", "completed")` is the only completion source; `api/training/certifications/route.ts:121` `if (!context.canManage) {` → 403; `:239` `document_url: text(body.documentUrl) \|\| null` | New workflow (submit, then verify). Unchanged. |
| TRN-10 | Daily-changing text resets snooze and queues new email | Confirmed applicable defect | Medium | `src/lib/notifications/event-reconciliation.ts:23-27` `return JSON.stringify(item);`; `:58-59` `acknowledged_at: changed ? null : ...`, `snoozed_until: changed ? null : ...`; detail = `row.statusReason` (`notifications/route.ts:489,504`) | Reproduced (Test 2): "expired 10 days ago" becomes "expired 11 days ago", the fingerprint changes and `snoozed_until` is cleared. The dispatcher drops prior-fingerprint rows as stale (`email-dispatch/route.ts:339-356`), so the result is about one fresh queue row per day the user visits. |
| TRN-11 | Roster with deactivated officer can't be saved; removal hard-deletes | Confirmed applicable defect | Medium | `[eventId]/roster/route.ts:221-226` `.eq("is_active", true).in("user_id", userIds)` → `:237` "not active department members"; `:290-295` `.from("agency_training_attendees").delete()` | Unchanged. |
| TRN-12 | Roster save rewrites recorded_by/at and created_by | Confirmed applicable defect | Medium | `roster/route.ts:264-266` `recorded_by_user_id: context.userId, recorded_at: new Date().toISOString(), created_by_user_id: context.userId`; `:305` `.upsert(rows, { onConflict: "event_id,user_id" })`; audit trigger `20260828030000_command_training_fleet_audit.sql:104` | Unchanged. |
| TRN-13 | My Home shows Acknowledge that API rejects (409) | Confirmed applicable defect | Medium | `src/app/page.tsx:153-165` `isConditionBasedReadiness` (9 kinds); `notifications/route.ts:61-83` `CONDITION_BASED_NOTIFICATION_KINDS` (21 kinds); `:1268-1278` returns 409 | Test 3: 12 kinds show Acknowledge but are rejected (6 `qualification_*`, 6 `agency_training_*`). The mobile inbox has no acknowledge action at all. |
| TRN-14 | No supervisor→team scoping | Enhancement rather than defect | High | `api/readiness/certifications/route.ts:8` `["manage_certifications", "view_command_dashboard", "view_analytics"]` with no scope parameter; `department_group` is used only in settings/invite/permissions/types | Requires a new relationship model. |
| TRN-15 | No leave/light-duty/waiver handling | Enhancement rather than defect | Medium | `certification-readiness.ts:23-29` requirement type has no exemption field; membership still only `is_active`/`activation_status` | New AWS SQL (`009`, `010`) adds Cognito lifecycle, not duty status. |
| TRN-16 | Deactivated users can still be emailed queued digests | Partially resolved | Low | Mitigation: `database/aws/024:25-31` enqueue requires `m.is_active = true`, so no *new* rows are queued for inactive members (AWS-native only). Remaining: `email-dispatch/route.ts:347-353` cancels only resolved/acknowledged/snoozed rows, with no membership check at dispatch | Already-queued Daily/Weekly rows are still sent after separation. The bridge (Supabase writer) has no enqueue check. |
| TRN-17 | One-by-one rostering, no bulk actions | Enhancement rather than defect | Medium | `AgencyTrainingRosterBoard.tsx` has no select-all, mark-all or unit filter (search only, `:149`) | Unchanged. |
| TRN-18 | Complete Event ignores unsaved roster edits | Confirmed applicable defect | Medium | `AgencyTrainingCloseoutPanel.tsx:5` `type Props = { eventId: string; eventStatus: string; canManage: boolean; onClosed: () => void };` `:50` POSTs closeout directly | No dirty-state prop. Unchanged. |
| TRN-19 | Off-duty notifications not emailed, unfilterable, re-notify fails silently | Confirmed applicable defect | High | `api/off-duty-firearms/route.ts:394-396` `.from("notification_events").upsert(notifications);` (no `onConflict`); `[requestId]/route.ts:219-220`, `:336-338` the same; `route.ts:566-570` `console.error(` swallows. AWS-native `postgres-data-client.ts:208` defaults conflict to `["id"]`, so `notification_events_user_key_uidx` (`20260720_central_notification_engine_v3.sql:26`) still raises; the `Source` union `notifications/route.ts:29-37` has no "Off-Duty" | Applies to both bridge and AWS-native. Off-Duty rows do appear in the mobile inbox, because it reads all of the user's events. |
| TRN-20 | Training Alerts status in localStorage; remediation blob | Confirmed applicable defect | High | `src/app/training-alerts/TrainingAlertsClient.tsx:253-254` `window.localStorage.setItem(TRAINING_ALERTS_STORAGE_KEY,`; `:394-395` `assignedInstructor: "Range Master", dueDate: "Next scheduled range block"`; `api/pilot/remediations/route.ts:106-109` upserts the whole `remediations` array; `:133` `remediation_count` | Unchanged. AWS SQL adds no remediation tables. |
| TRN-21 | No per-officer hours/transcript | Enhancement rather than defect | High | `hours_completed` readers: only certificate, report, roster routes and `agency-training/read-repository-core.ts`; `training/page.tsx:12-15` "Training History" → `href: "/qualifications"` | Feature gap. |
| TRN-22 | Inbox UI covers 4 sources | Confirmed applicable defect | Medium | `src/app/notifications/page.tsx:34` `const sources = ["Personal Rifle", "Ammunition", "Inspection", "Range"];` `:135` header text | Unchanged. |
| TRN-23 | Email failures invisible; bounces/suppressions unhandled | Partially resolved | Medium | Resolved for AWS-native/SES: `src/lib/email/ses-provider-core.ts:47-52` checks `isSuppressed` before sending; `ses-feedback-postgres.ts:11,37` writes and reads `email_suppressions`; `infra/lib/ses-feedback-worker-stack.ts:143` SQS→Lambda feedback with alarms `:148-151`. Remaining: `email-dispatch/route.ts:173-178` `status: terminal ? "Failed" : "Pending"` with no admin or user surface; candidate query `:240-246` selects only `Pending`, so stuck `Processing` rows are never reclaimed | Brevo (bridge) still has no bounce webhook. |
| TRN-24 | Department items copied per user, no assignment | Enhancement rather than defect | Medium | `notifications/route.ts:1251,1295` `.eq("user_id", context.user.id)` | Unchanged. |
| TRN-25 | Staff alerts scale officers×requirements, sequential writes per page load | Requires runtime verification | Medium | `notifications/route.ts:1117-1127` loop with `await eventWriter.upsertEvent`; `:948-979` six `internalJson(...)` fan-outs (now loopback `127.0.0.1:${PORT}` in AWS-native via `internal-source-url.ts:11-15`) | The code pattern is confirmed. The latency and DB-load impact needs a load test. In AWS-native, each `upsertEmail` is also a separate pooled query (`event-writer-postgres.ts:27-34`). |
| TRN-26 | Any member can read all training results / certifications | Confirmed applicable defect | High | `[eventId]/roster/route.ts:138-161` GET has only `resolveServerAccess()` and returns `scoreText`/`remedialNotes` (`:128-130`); `api/training/certifications/route.ts:88-89` returns the full workspace; `training/read-repository-supabase.ts:7` `from("training_certifications").select("*").eq("department_id", id)`. RLS `20260827203000_agency_training_v1.sql:191-193` `using (public.is_department_member(department_id))`; `202608060001_training_certifications.sql:104` | AWS-native keeps these policies: `database/aws/004:32-51` rewrites each policy, replacing only `auth.uid()` with `tracepoint_auth.subject_id()`. No `database/aws/*.sql` touches these tables' SELECT policies. The `report/route.ts:10` gate is still inconsistent. |
| TRN-27 | Reopen doesn't restore superseded credentials | Confirmed applicable defect | Medium | closeout SQL `:137-142` `set is_active = false ... and prior.issue_date <= issue_date_value`; `:220-222` reopen deactivates only `source_training_event_id = p_event_id` | `008` wraps the same `_internal` functions. |
| TRN-28 | Closeout lets manage_training issue/deactivate certs | Enhancement rather than defect | Low | `closeout/route.ts:5` `const MANAGE = ["manage_training"] as const;`; `database/aws/008:24,45` `not public.has_department_permission(p_department_id,'manage_training')` | AWS-native now *deliberately* encodes manage_training-only authority at the DB layer. Treat as a separation-of-duties policy decision. |
| TRN-29 | Weak certification validation; history rewrite | Confirmed applicable defect | Medium | `api/training/certifications/route.ts:15-18` `dateOrNull` returns the text unchanged; `[certificationId]/route.ts:223` `user_id: userId,`; `:293-296` `is_active: false` with no reason | Unchanged. |
| TRN-30 | Event/requirement APIs accept invalid state | Confirmed applicable defect | Low–Medium | `events/route.ts:18-24` `VALID_STATUSES` includes `"completed"`; `roster/route.ts:247-252` `throw new Error(...)` inside `submitted.map`, while the PUT (`:167`) has no try (the only `try` is in GET `:144`); `requirements/route.ts:213` hard `.delete()`; `agency-training-notifications.ts:24` `if (!requirement.interval_value \|\| !requirement.interval_unit) return null;` | Unchanged. |
| TRN-31 | Requirements UI behind Settings gate; hub says "Coming next" | Confirmed applicable defect | Medium | `src/lib/tracepoint/permissions.ts:95` `{ prefix: "/settings", requirement: { anyOf: ["manage_users", "view_audit_log", "administer_department"] } }`; `settings/page.tsx:4228` `<AgencyTrainingRulesPanel />`; `training/page.tsx:29-35` `comingSoon: true` | Unchanged. |
| TRN-32 | Requirement scope values are free text | Confirmed applicable defect | Medium | `AgencyTrainingRulesPanel.tsx:75` `scopeValues: draft.scopeValues.split(",")`; `agency-training-notifications.ts:31-32` `values.has(lower(member.unit_name))` | A typo silently drops members from a mandatory requirement, so I treat it as a defect rather than UX. |
| TRN-33 | Rostering/cancel/reschedule notifies nobody | Enhancement rather than defect | Medium | `agency-training-notifications.ts:82` kinds are only missing/overdue/due_soon | Unchanged. |
| TRN-34 | Snooze unvalidated, fixed 1 day | Confirmed applicable defect | Low | `notifications/route.ts:1287` `snoozed_until: body.snoozedUntil \|\| new Date(Date.now() + 86400000).toISOString()`; `notifications/page.tsx:188` "Snooze 1 Day" | Unchanged. |
| TRN-35 | Disabling in-app silently disables email and resolves everything | Confirmed applicable defect | Low–Medium | `notifications/route.ts:1091-1093` `const filtered = preferences.in_app_enabled ? generated.filter(...) : [];` and resolve loop `:1162-1170` | Unchanged. |
| TRN-36 | Coordinator mobile layouts are wide tables | Enhancement rather than defect | Low | `AgencyTrainingRosterBoard.tsx:291` `min-w-[1050px]`; `training/certifications/page.tsx:722` `min-w-[980px]` | The new `/api/mobile/*` covers equipment/fleet/range/QR/inbox, but not training rosters or certifications. |
| TRN-37 | Thin tests for risky logic | Enhancement rather than defect | Medium | No test files for `certification-readiness.ts`, `agency-training-notifications.ts`, `email-dispatch`, closeout/reopen SQL; `package.json` has no `"test"` script | New tests were added only for `date-value`, `event-writer-postgres`, `internal-source-url`, `postgres-read-contract`. |
| TRN-38 | Dead quick-create modal | Enhancement rather than defect | Low | `src/app/agency-training/page.tsx:183` `const [showCreate, setShowCreate] = useState(false);` `:647` `{showCreate ? (`; `setShowCreate(true)` is never called; live button `:331` `onClick={() => setEditorEvent(null)}` | Unchanged. |

## Priority deep-dives

### Notifications (TRN-01 / 05 / 06 / 08 / 10): is there any scheduled or server-side generation or dispatch?

**No.** Here is the full inventory in 555f061.

**Generation.** `collectCertificationReadiness`, `collectAgencyTrainingNotifications` and all the collectors are called only from `GET /api/notifications` (`route.ts:954,986`). The only `upsertEmail` caller is `route.ts:1142`.

- The writer is per-user by construction: `event-writer-core.ts` `TenantBoundNotificationEventWriter.authorize` throws unless `row.user_id === this.userId`.
- The AWS enqueue function `database/aws/024` requires `session_user = 'tracepoint_runtime'` and an existing `notification_events` row with a matching fingerprint.
- Together these mean a future batch evaluator must write events before it enqueues, and must build one writer per recipient.

**Dispatch.**
- `POST /api/notifications/email-dispatch` gained Postgres and SES support (`route.ts:213-237`). `database/aws/007` grants `tracepoint_runtime` cross-tenant `select, update` on the queue for "a trusted, server-only cross-tenant worker".
- **No such worker or schedule exists.** `infra/lib` has no EventBridge Scheduler, Rule, ScheduledFargateTask, or dispatch Lambda. The only Lambda is the SES *feedback* worker, `ses-feedback-worker-stack.ts:117` (`entry: .../src/lib/email/ses-feedback-handler.ts`, SQS source `:143`). The changeset `infra/changesets/production-ses-worker-20260926/finalActive.json` contains only that Lambda, its EventSourceMapping, alarms, security groups and VPC endpoints.
- The container entrypoint, `scripts/start-tracepoint-container.mjs`, validates config and imports `server.js`, with no timers.
- `src/app/api/internal/**` contains only `rehearsal-tenant-negative`.

**The AWS-native proxy blocks the dispatcher for bearer-only callers.**
- `src/proxy.ts:44-46`: the matcher covers `/api/notifications/email-dispatch`.
- `request-proxy-core.ts:1,3`: `isAwsNativePublicPath` does not include it.
- `request-proxy.ts:51-52`: no principal gives `signInRequiredResponse`, which returns a 401 JSON for `/api/*`.
- By contrast, the bridge proxy `src/lib/supabase/proxy.ts:13` lists it in `PUBLIC_PATHS`.
- So even if someone adds an EventBridge API destination or a cron curl carrying `Authorization: Bearer <NOTIFICATION_DISPATCH_SECRET>`, it fails in aws-native mode unless the proxy allow-list is changed too. (Test 4.)

**Legacy runtime.** Repo docs show the legacy production dispatcher was the out-of-repo Supabase pg_cron job `tracepoint-notification-email-dispatch` (`*/15`, `net.http_post` to Vercel; `docs/final-cutover-proof-addendum-20260926.md:14`, `docs/production-authoritative-writer-inventory-20260927.md:29,112-114`). The cutover fence pauses it (`supabase/production-cutover/20260927_activate_source_fence.sql:124`). The Sep 27 AWS inventory found "Production EventBridge Scheduler had zero schedules" (`docs/operational-source-quiescence-20260927.md:63`). Once AWS-native is authoritative, queued email has **no invoker** in the repo or in the documented AWS inventory. TRN-08 is therefore a confirmed, Critical cutover blocker. Before final sign-off, live-check the AWS account for any out-of-band schedule.

**Mobile inbox (`src/app/api/mobile/inbox/route.ts`).**
- It is a read-only SELECT of the caller's own rows: `:85-87` `.eq("department_id", departmentId).eq("user_id", userId).is("resolved_at", null)`. It filters acknowledged and snoozed rows in memory (`:100-110`) and computes counts.
- It **generates nothing**, for neither self nor supervisors, and it has no acknowledge or snooze action.
- Bearer tokens are accepted only on `/api/mobile/*` (`src/lib/tracepoint/server-access.ts:141-143`). A mobile-only officer therefore can never trigger the `/api/notifications` GET generator.
- Result: their mobile inbox is empty, or shows rows last materialized at their most recent web visit. Rows whose condition has since cleared are never resolved, and new expirations never appear.
- This makes TRN-01 worse. It also makes TRN-06 worse, because supervisors cannot see subordinate items on mobile either.

**`if (row.userId !== context.user.id) continue`.** Still present at `notifications/route.ts:466`, with the qualification (`:592`) and equipment (`:696`) equivalents.

**TRN-10.** Unchanged. Reproduced in Test 2.

### TRN-02: timezone
- No `TZ` is set in either Dockerfile. The runtime is distroless Debian with UTC by default.
- No `TZ` is set in the `runtime-stack.ts` task environment (`:96-117`) or the proof/rehearsal stacks.
- Parsing is still naive on both POST and PATCH (`new Date(valueText)` on an offset-less `datetime-local` string).
- Closeout still uses `event_row.starts_at::date` (`closeout.sql:79`), and the certificate PDF formats in `timeZone: "UTC"` (`certificates/[certificateId]/route.ts:43`). So evening events can also get the wrong issue date.
- Fix options: the client sends `new Date(local).toISOString()`, or the server interprets the string in `departments.timezone`, which now exists.

### TRN-03: closeout certification issuance
Unchanged.
- The AWS wrapper `database/aws/008` renames the original RPCs to `_internal`, revokes them, and adds a security-definer wrapper.
- The wrapper checks that `tracepoint_auth.department_id()` and `subject_id()` match and that the caller has `manage_training`, then delegates.
- The issuance branch still depends on `event_row.certification_type_id`. The editor never sets it and PATCH cannot set it.

### TRN-20: Training Alerts localStorage
Unchanged.
- `TrainingAlertsClient.tsx:177-178` reads and `:253-254, :262` write `window.localStorage`.
- The remediation hard-codes remain at `:394-395`.
- `/api/pilot/remediations` still upserts one JSON array per department.
- No AWS SQL or branch adds disposition tables.

### TRN-26: visibility under AWS-native authorization
- **App level:** roster GET (`roster/route.ts:138-161`) and certifications GET (`training/certifications/route.ts:88-89`) still return department-wide sensitive fields to any member who has the feature.
- **DB level:** `database/aws/001` and `004` replace the `auth.uid()` provider with `tracepoint_auth.subject_id()` and recreate every policy with the same predicate (`004:32-51`). The SELECT policies `is_department_member(department_id)` therefore carry over unchanged.
- `tracepoint_runtime` is `nobypassrls` and is granted `authenticated` (`003:9-11,32`), so RLS is enforced. But the policy itself permits all members.
- No `database/aws/0xx` (001–037) touches `agency_training_attendees` or `training_certifications` SELECT policies. 017–020 tighten armory, fleet and off-duty only.
- Confirmed, High.

## Isolated tests

All scripts are in `/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/recon/work-training/`.
- `node_modules` is a symlink to `/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/runtime/work/node_modules`.
- Run each as `./node_modules/.bin/tsx <script> /tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/current`.
- The scripts import or extract code from the current checkout at run time; logic is not re-typed. Output is saved alongside as `*.out`.

### Test 1: TRN-02 drift (`trn02-timezone.mts`, output in `trn02.out` and `trn02-control.out`)
- **Steps:**
  1. Regex-extract `localDateTimeValue` from the editor and `dateTimeOrNull` from `events/route.ts`.
  2. Run the server function in a child process with `TZ=UTC`, and the browser function with `TZ=America/Los_Angeles`.
  3. Loop: send the typed value, store it, redisplay it, and re-send the redisplayed value.
- **Expected:** stored instant `2026-10-25T01:00:00.000Z`, redisplayed `18:00` on every save.
- **Actual:**
```
save 1: sent=2026-10-24T18:00 stored=2026-10-24T18:00:00.000Z redisplayed=2026-10-24T11:00
save 2: sent=2026-10-24T11:00 stored=2026-10-24T11:00:00.000Z redisplayed=2026-10-24T04:00
save 3: sent=2026-10-24T04:00 stored=2026-10-24T04:00:00.000Z redisplayed=2026-10-23T21:00
intended instant (browser-local 18:00) = 2026-10-25T01:00:00.000Z
```
- **Control:** with `SERVER_TZ=America/Los_Angeles` the value is stable at `2026-10-25T01:00:00.000Z` / `18:00`. So the defect is the TZ mismatch, and that mismatch is the deployed configuration (no `TZ`).

### Test 2: TRN-10 fingerprint churn and TRN-06 self-filter (`trn10-fingerprint.mts`, output in `trn10.out`)
- **Steps:**
  1. Import the real `evaluateCertificationReadiness` and `buildNotificationEventReconciliationRow`.
  2. Fix `Date` to 2026-10-20 and then 2026-10-21.
  3. Build the alert exactly as `route.ts:483-505` does, and simulate a user snooze after day 1.
- **Expected (if correct):** the fingerprint is stable for the same expired credential, and the snooze is preserved.
- **Actual:**
```
2026-10-20 u-self status=expired days=-10 reason="Certification expired 10 days ago."
2026-10-20 u-other status=due_soon days=16 reason="Certification expires in 16 days."
2026-10-21 u-self status=expired days=-11 reason="Certification expired 11 days ago."
  fingerprint changed vs prior: true; snoozed_until carried: null
```
- `u-other` rows are computed but discarded by `route.ts:466`. This supports TRN-06: the data needed for supervisor fan-out is already evaluated.

### Test 3: TRN-05 email gate and TRN-13 acknowledge mismatch (`trn05-13-gates.mts`, output in `trn05-13.out`)
- **Steps:**
  1. Extract the default `critical_email_only` and the exact queue `if (...)` condition from `route.ts:1129-1141` and evaluate it.
  2. Extract both kind lists (`route.ts:61-83` and `page.tsx:153-165`) and diff them.
- **Expected (if correct):** due-soon items are email-eligible by default, and Acknowledge is hidden for every kind the API refuses.
- **Actual:**
```
default critical_email_only=true; default email_enabled=true
  required_certification_due_soon      priority=High     email queued=false
  agency_training_due_soon (<=30d)     priority=High     email queued=false
  agency_training_due_soon (>30d)      priority=Normal   email queued=false
  required_certification_expired       priority=Critical email queued=true
TRN-13: API 409 kinds=21, home hides Acknowledge for=9; Acknowledge shown but rejected (409) for 12:
  qualification_no_record, qualification_missing_day, qualification_missing_night, qualification_failed, qualification_overdue, qualification_due_soon, agency_training_missing, agency_training_overdue, agency_training_due_soon, agency_training_missing_staff, agency_training_overdue_staff, agency_training_due_soon_staff
```

### Test 4: TRN-08 dispatcher reachability (`trn08-proxy.mts`, output in `trn08.out`)
- **Steps:**
  1. Import the real `isAwsNativePublicPath`.
  2. Extract the bridge `PUBLIC_PATHS` and the `src/proxy.ts` matcher.
  3. Test `/api/notifications/email-dispatch` against each.
- **Expected (if a scheduler can work):** the path is public in both modes, so the route's bearer check is reached.
- **Actual:**
```
proxy matcher applies to /api/notifications/email-dispatch: true
bridge (Supabase) proxy treats it as public: true
aws-native proxy treats it as public: false
```
- In aws-native mode, a cookie-less bearer request gets 401 from `request-proxy.ts:17-18,51-52` before `email-dispatch/route.ts:197-208` runs.
- **Limit:** this is static reachability from pure functions. An HTTP-level check against a running aws-native container would confirm it end to end, but I did not run one (no network, no app run).

### Not tested (and why)
- **Closeout/reopen SQL (TRN-03, TRN-27):** needs Postgres; none was used. Evidence is from reading the SQL.
- **`collectAgencyTrainingNotifications`:** needs a DB client context. Its `dueDate` and `applies` helpers are not exported.
- **Roster PUT 500 (TRN-30f):** needs the Next runtime.
