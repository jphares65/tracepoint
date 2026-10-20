# TracePoint `date` (OID 1082) → JS Date regression: impact inventory (commit 8c4c032)

Read-only analysis. Source tree extracted via `git archive 8c4c032` into `scratchpad/dc/tree`. No repo modified.

## 0. Mechanism (verified)

- `src/lib/database/postgres-type-parsers.ts`: overrides only OID 20 (int8) and 1700 (numeric); everything else falls back to `pg-types` 2.2.0 (lockfile; `pg` 8.23.0).
- `pg-types/lib/textParsers.js:174` `register(1082, parseDate)` → `postgres-date` `getDate()` → `new Date(year, month, day)` = **local midnight**.
- `Dockerfile.aws-native-production`: runner is `gcr.io/distroless/nodejs24-debian13:nonroot`, ENV only NODE_ENV/NEXT_TELEMETRY_DISABLED/HOSTNAME/PORT/DEPLOYMENT_VERSION. **No TZ.** No `TZ` in `infra/lib/*`. ⇒ container is UTC ⇒ Date is `YYYY-MM-DDT00:00:00.000Z`; JSON → `"2028-03-01T00:00:00.000Z"`.
- `src/lib/database/postgres-pool.ts:13` passes `types: postgresRuntimeTypes` to the Pool. `src/lib/tracepoint/server-access-postgres.ts:73,104` builds `PostgresDataClient`, assigned to `context.admin`, `context.db`, `context.authDb`.
- **Important nuance**: `postgres-data-client.ts` `selectSql()` emits embedded relations via `row_to_json(q)` / `jsonb_agg(row_to_json(q))`. Date columns inside an *embedded relation* arrive as JSON strings `"YYYY-MM-DD"` (unaffected). Only **top-level** columns (`t.<col>`, `t.*`, `returning`) and **RPC result columns** of type `date` are Date objects. jsonb workspaces (`pilot_range_workspaces.workspace`, `range_days.outline`, etc.) are unaffected.
- Node checks (TZ=UTC): `` `${d}T00:00:00Z` `` → `"Wed Mar 01 2028 00:00:00 GMT+0000 (Coordinated Universal Time)T00:00:00Z"` → `Date.parse` = **NaN**; `String(d)` = `"Wed Mar 01 2028 00:00:00 GMT+0000 (Coordinated Universal Time)"`; `d.includes` → **TypeError**; browser `new Date("2028-03-01T00:00:00.000Z").toLocaleDateString()` in America/Chicago → **2/29/2028** (one day early).
- Timestamps (timestamptz, OID 1184) were *already* Date objects under pg; some code was adapted (`src/lib/notifications/date-value.ts`). That is a separate issue; see §6.

## 1. `date` columns in schema (supabase/migrations + database/aws @ 8c4c032)

No `alter column … type` changes any of these. No `date[]` columns.

| table.column | origin migration |
|---|---|
| training_certifications.issue_date, .expiration_date | 202608060001_training_certifications.sql |
| qualification_results.qualification_date, .expires_on | 202606220001_tracepoint_foundation.sql |
| qualification_course_versions.effective_date | foundation |
| range_days.range_date | foundation |
| remedial_training_recommendations.assigned_date, .completed_date | foundation |
| firearms.acquisition_date, .last_inspection_date, .next_inspection_due, .retired_date | foundation |
| firearm_inspections.inspection_date, .next_inspection_due | foundation; .follow_up_date (20260708_firearm_inspections.sql) |
| equipment_assets.issue_date, .expiration_date, .last_inspection_date, .next_inspection_date | 202608190001_equipment_assignment_history.sql |
| off_duty_firearm_requests.approval_date, .approval_expires_on, .last_qualification_date | foundation; .approval_effective_date, .approval_expiration_date (202608170001 / 202608180003) |
| off_duty_firearm_inspections.inspection_date | 202608170002 |
| personal_rifles.approval_date, .expiration_date, .inspection_date | 20260719_personal_rifle_workflow_v2.sql |
| fleet_vehicles.in_service_date, .inspection_due_date, .registration_expiration_date, .insurance_expiration_date, .last_service_date, .next_service_date | 202608242100_fleet_v1.sql |
| fleet_vehicle_documents.effective_date, .expiration_date | fleet_v1 |
| fleet_vehicle_equipment.warranty_expiration_date | fleet_v1 |
| fleet_work_orders.due_date, .scheduled_for | fleet_v1 |
| platform_agency_accounts.pilot_start_date, .production_start_date | 202608210003 + database/aws/014 (RPC `list_platform_agencies()` returns both as `date`) |

Agency training (`agency_training_*`) has **no** date columns (timestamptz + integer fixed_month/fixed_day) → not affected by this bug.

## 2. Consumer classification (server reads via PostgresDataClient)

Legend: **A** = server string helper → BROKEN; **B** = passed to browser JSON as ISO then parsed; **C** = string compare/sort; **D** = write-back; **OK** = tolerant.

### Training certifications (`training_certifications.issue_date/expiration_date`)
- **A – Readiness API** `GET /api/readiness/certifications` → `src/lib/readiness/read-repository-supabase.ts:14` → `src/lib/readiness/read-repository-core.ts:23` (`nullableString = String(value)`), `:64` → `src/lib/tracepoint/certification-readiness.ts:88` `Date.parse(\`${value}T00:00:00Z\`)` = NaN → `:352-380`. **Every held credential of an `expiration_required` type is `status:"expired"`, reason "Certification requires an expiration date, but no valid expiration can be determined."**, `expirationDate:null`; `issueDate` returned as `"Wed Mar 01 2028 00:00:00 GMT+0000 (Coordinated Universal Time)"`. If type is not expiration_required → "current" (no due-soon). Consumers: Command Dashboard (`src/app/command-dashboard/page.tsx:328`) readiness counts/percent (expired inflated, ready deflated), training readiness views.
- **A – My Home alerts** `GET /api/notifications` → `src/lib/notifications/read-repository-query.ts:10` → `src/app/api/notifications/route.ts:449-450` (raw Date) → `evaluateCertificationReadiness` → `:484-494` pushes `kind:"required_certification_expired"`, Critical, key `certification-readiness-<userId>-<typeId>`, detail = reason above, `createdAt:null`. **Persisted** via `route.ts:1127` `eventWriter.upsertEvent` into `notification_events`; **queued** via `route.ts:1142` `upsertEmail` → `tracepoint_auth.enqueue_notification_email` into `notification_email_queue` (status `Pending`) when the user's `notification_preferences.email_enabled` and (not critical_email_only or Critical — it is Critical). Only for the user loading My Home (`row.userId !== context.user.id` filter, `:466`).
- **B – Certifications page** `/training/certifications` ← `/api/training/certifications` (`src/lib/training/read-repository-supabase.ts:7`, `select("*")`). `src/app/training/certifications/page.tsx:143` `new Date(\`${date}T00:00:00\`)` → Invalid → `daysUntil` NaN → `getStatus` (`:273-300`) falls through all `<`/`<=` tests ⇒ **every dated cert labeled current; real expired/due-soon certs NOT flagged** (contradicts My Home "Expired"). `:824` shows raw `2028-03-01T00:00:00.000Z`. Edit form `:329-330` seeds `<input type=date>` with ISO string → field renders blank.
- **D – Edit round trip**: `src/app/api/training/certifications/[certificationId]/route.ts:14-17,204-233` `dateOrNull` = trimmed text, no validation → `'2028-03-01T00:00:00.000Z'` into `date` → PostgreSQL date input discards the time and zone → `2028-03-01`. **Safe** (no concatenation). Risk only if the user, seeing a blank date field, clears/changes it.
- **C – Onboarding/CSV import dedupe** `src/app/api/settings/onboarding/certifications/route.ts:169-173` `row.issue_date === issueDate` / `row.expiration_date === expirationDate` (Date vs string → always false) when no credential number ⇒ **re-import inserts duplicate certification rows** instead of enriching (data integrity). `src/lib/ai-importer/server/reference-data.ts:39` loads same columns for AI-importer matching (likely same class; not traced in full).
- **B – Exports** `src/app/settings/import-export/page.tsx:2779-2782` CSV cells carry `2028-03-01T00:00:00.000Z`; PDF `dateText` `:4124-4136` parses ISO and `toLocaleDateString` ⇒ **one day early for US time zones**; report date filter `:5384` `.slice(0,10)` OK.

### Qualifications (`qualification_results.qualification_date/expires_on`)
- **A – My Home qualification alerts**: `src/lib/notifications/read-repository-query.ts:15` → `route.ts:981` → `collectQualificationReadiness` → `src/lib/tracepoint/qualification-readiness.ts:221` `text(get(result,"qualification_date"))` where `text()` (`:77-79`) returns `""` for non-strings ⇒ **all stored qualification_results are dropped**. Readiness then relies only on the jsonb range workspace; officers whose qualifications exist only in `qualification_results` (imported history, `record_origin` ≠ range workspace) get **"Qualification Record Missing" / "Day/Night Qualification Missing" (Critical)**, persisted to notification_events; emails gated by `qualificationEmailReady` (range activity) `route.ts:1098,1136-1139`.
- **B – Qualifications page** `/qualifications` ← `/api/qualifications` (`src/lib/qualifications/history-repository-core.ts:36` passes Date). `src/app/qualifications/page.tsx:248` formatDate → **"Invalid Date"**, `:258` getDateValue → 0 (history ordering lost). Shared `qualification-readiness.ts:110` slices to 10 → works on ISO; `:126` formatDate → "Invalid Date" in status reasons.
- **A – Performance summary** `src/app/api/pilot/performance-summary/route.ts:97` (`dateValue` → 0), `:104` (Invalid Date), `:635` `String(day.range_date) >= today` → "Wed…" > "2026…" always true ⇒ past range days listed as upcoming; `:641` sort by weekday text. Feeds Command Dashboard (`command-dashboard/page.tsx:330`).

### Equipment (`equipment_assets.*`)
- **A – Equipment readiness** `GET /api/readiness/equipment` → `read-repository-core.ts:49` (String(Date)) → `src/lib/tracepoint/equipment-readiness.ts:163` `new Date(\`${value}T00:00:00Z\`)` Invalid → `daysRemaining` NaN → `:250-253` `NaN<0` false and due-soon `NaN<=n` false ⇒ **every asset with an explicit expiration/next-inspection date shows "current"/ready — genuinely expired or overdue equipment is hidden (false-ready)**. If `expiration_date` is NULL but `issue_date` set and valid_days configured, or `next_inspection_date` NULL but `last_inspection_date` set and interval configured: `addDays` `:182-186` → `dateOnly` `:167` `toISOString()` on Invalid Date ⇒ **RangeError ⇒ whole route 500** (`src/app/api/readiness/equipment/route.ts:42-43`) ⇒ Equipment page readiness blank and My Home "Equipment" source error (existing equipment events not resolved).
- **B – Equipment page** `src/app/equipment/page.tsx:225` formatDate → returns raw ISO string on Invalid. Edit `:970` seeds ISO; write `src/app/api/settings/onboarding/equipment/route.ts:158,209` / `src/app/api/equipment/assets/route.ts:173,348-350` (cleanText / passthrough of existing Date) ⇒ **D safe** (PostgreSQL casts).

### Off-duty firearms (`off_duty_firearm_requests.approval_*`, `off_duty_firearm_inspections.inspection_date`)
- **A – List** `GET /api/off-duty-firearms`: `src/app/api/off-duty-firearms/route.ts:129-130` inspection date NaN → `:143-148` **inspectionStatus "Overdue" for every passed inspection** ⇒ compliance **"Non-Compliant"** for every approved request; `:213-220` effective/expiration NaN ⇒ expired approvals no longer detected (masked by Non-Compliant). `:294-295` approvalDate/approvalExpires → ISO to browser (`off-duty-firearms/page.tsx:185` handles `T` → **one day early** in US TZ).
- **A – Approval BLOCKED** `src/app/api/off-duty-firearms/[requestId]/route.ts:132-142` → "The most recent firearm inspection date is invalid." (Overdue) → `:596-614` **409 "cannot be approved because the firearm does not have a current passing inspection."** Command staff cannot approve any off-duty request.

### Personal rifles (`personal_rifles.*`)
- **A – Inbox** `src/app/api/armory/personal-rifles/inbox/route.ts:127-131` Invalid Date ⇒ **"Personal Rifle Approval Expiring" (60-day) alerts never generated**; `:138` would print long Date string.
- **B** `src/app/firearms/personal-rifles/page.tsx:196-199` handles `T` → **one day early** US display. **D** `[rifleId]/route.ts:191,294` writes existing Date back → safe.

### Fleet (`fleet_vehicles.*`, `fleet_work_orders.due_date`, `fleet_vehicle_equipment.warranty_expiration_date`, documents)
- **OK (timing) / cosmetic – Fleet alerts** `src/lib/tracepoint/fleet-notifications.ts:75` uses `notificationDateValue` (Date-tolerant) ⇒ due/overdue timing correct; `detail: "Configured date: Wed Mar 01 2028 00:00:00 GMT+0000 (Coordinated Universal Time)"`, `:56` "Due Wed Mar 01…".
- **A – Command Dashboard operations** `GET /api/command-dashboard/operations` → `src/lib/operations/read-repository-supabase.ts` → `src/lib/tracepoint/command-operations.ts:36-40` `typeof value !== "string"` → 0, `.filter(Boolean)` ⇒ `:101-112` **no fleet "attention" from due dates**, `:116-119` never "overdue", `:164-178` **fleetUpcoming always empty**. (Status-based attention still appears.)
- **B – Fleet list page** `src/lib/fleet/inventory-state.ts:157` regex `/^(\d{4})-(\d{2})-(\d{2})$/` fails on ISO ⇒ **every vehicle "not-scheduled"** for inspection/service; date sort broken (`:298-320`), "not scheduled" filters wrong (`:376-378`). `src/app/fleet-management/page.tsx:188` shows raw ISO. Vehicle detail `fleet-management/[vehicleId]/page.tsx:29` handles `T` → one day early.
- **D – Writes** `src/lib/tracepoint/fleet-server.ts:11-14` / `src/app/api/fleet/vehicles/route.ts:69-72` `text(value,10)` truncates ISO to `YYYY-MM-DD` then regex ⇒ **round trip safe**.

### Other
- Platform admin: `list_platform_agencies()` RPC → `src/lib/platform/admin-access.ts:91-92` `String(Date)` ⇒ super-admin sees long date strings for pilot/production start; no write-back found.
- Firearms / firearm_inspections dates: armory list (`src/lib/armory/read-repository-supabase.ts`) does not select date columns; `firearm_inspections.firearms(...)` embedded relation is row_to_json (strings). Low impact.
- range_days.range_date: Range Days page uses jsonb workspace (unaffected); only performance-summary path broken (above).

## 3. Highest-impact symptoms (ranked)

1. **False "Expired" certifications** for every held credential of an expiration-required type: readiness API, Command Dashboard counts, My Home Critical alerts — `certification-readiness.ts:88`, `read-repository-core.ts:23,64`, `notifications/route.ts:449-494`. Persisted to `notification_events` and queued to `notification_email_queue`.
2. **Off-duty approvals blocked (409)** and all approved requests "Non-Compliant" — `off-duty-firearms/[requestId]/route.ts:132-142,596-614`; `off-duty-firearms/route.ts:129-148`.
3. **Equipment false-ready** (real expired/overdue gear shown current) or **500** — `equipment-readiness.ts:163,167,182-186,250-253`.
4. **False qualification-missing alerts** for officers with stored qualification_results — `qualification-readiness.ts:77-79,221`.
5. Certifications page shows real expired certs as current (`training/certifications/page.tsx:143,281`) — opposite of My Home.
6. Fleet: Command Dashboard fleet due-date attention/upcoming empty (`command-operations.ts:36-40`); Fleet page every vehicle "not scheduled" (`inventory-state.ts:157`).
7. Personal rifle expiring alerts suppressed (`personal-rifles/inbox/route.ts:127`).
8. Duplicate certification rows on re-import without credential number (`onboarding/certifications/route.ts:169-173`).
9. Display: "Invalid Date" (qualifications, performance summary), raw ISO strings, one-day-early dates in US browsers; CSV exports carry ISO timestamps.

**Email dispatch**: `src/app/api/notifications/email-dispatch/route.ts:198-205` is POST with `NOTIFICATION_DISPATCH_SECRET|CRON_SECRET` bearer; no EventBridge/scheduler in `infra/lib`, no cron in `.github/workflows` ⇒ queued rows should still be `Pending` (verify). Dispatcher cancels a queued row if its event is resolved or fingerprint changed (`email-dispatch/route.ts` ~`:311-365`), so a later dispatcher run after the fix would cancel rows for users who have since reloaded My Home — but rows for users who never return stay `Pending` and would be **sent** as false "Expired" emails if the dispatcher is ever invoked. Recommend: do not invoke the dispatcher until queue is reviewed.

## 4. Read-only owner checks

### UI checks (no changes made)
- **My Home** (`/`) as any officer with a current, future-dated certification of a required, expiration-required type → expect Critical "<Cert> Expired" with detail "Certification requires an expiration date, but no valid expiration can be determined."
- **Training → Certifications** (`/training/certifications`) same user → cert shows as current/"Due in…" missing; expiration column shows `2028-03-01T00:00:00.000Z`; edit dialog date fields blank (do **not** save).
- **Command Dashboard** (`/command-dashboard`) as command staff → certification readiness % sharply lower / expired count ≈ number of held credentials; fleet "upcoming" empty despite vehicles with due dates in window.
- **Off-Duty Firearms** (`/off-duty-firearms`) as reviewer → approved requests "Non-Compliant", inspection "Overdue"; attempting approval would 409 (do not attempt if you want zero writes — the 409 path writes nothing, but avoid).
- **Equipment** (`/equipment`) → assets with past expiration show as Current; or readiness panel errors (500).
- **Qualifications** (`/qualifications`) → dates "Invalid Date".
- **Fleet Management** (`/fleet-management`) → all vehicles "Not scheduled"; dates as ISO strings.
- Note: loading My Home **writes** (upserts notification_events, may enqueue emails). For a strictly read-only check, prefer SQL below or a user with email disabled.

### Read-only SQL (all `SELECT`; run in a `BEGIN READ ONLY; … ROLLBACK;` transaction)

```sql
BEGIN TRANSACTION READ ONLY;

-- Q1: users who would see false "Expired" (held active credential of a required, expiration-required type)
select tc.department_id, d.name,
       count(*)                                         as affected_credentials,
       count(distinct tc.user_id)                       as affected_users,
       count(*) filter (where tc.expiration_date >= current_date) as truly_unexpired,
       count(*) filter (where tc.expiration_date <  current_date) as truly_expired
from public.training_certifications tc
join public.certification_types ct on ct.id = tc.certification_type_id
join public.department_certification_requirements r
  on r.department_id = tc.department_id and r.certification_type_id = tc.certification_type_id
 and r.is_active is not false and r.is_required is not false
join public.departments d on d.id = tc.department_id
join public.department_memberships m on m.department_id = tc.department_id and m.user_id = tc.user_id and m.is_active
where tc.is_active and ct.expiration_required is not false
  and (tc.expiration_date is not null or tc.issue_date is not null)
group by 1,2 order by 3 desc;

-- Q2: persisted false-expired events since cutover
select ne.department_id, count(*) as events, count(distinct ne.user_id) as users,
       count(*) filter (where ne.resolved_at is null) as open_events,
       min(ne.first_seen_at), max(ne.last_seen_at)
from public.notification_events ne
where ne.kind = 'required_certification_expired'
  and ne.detail = 'Certification requires an expiration date, but no valid expiration can be determined.'
  and ne.last_seen_at >= '2026-09-29'
group by 1;

-- Q2b: of those, how many have a credential that is actually in the future
select count(distinct ne.id)
from public.notification_events ne
join public.training_certifications tc
  on ne.notification_key = 'certification-readiness-' || tc.user_id || '-' || tc.certification_type_id
 and tc.department_id = ne.department_id and tc.is_active
where ne.kind = 'required_certification_expired'
  and ne.last_seen_at >= '2026-09-29'
  and tc.expiration_date >= current_date;

-- Q3: emails queued/sent for those alerts
select q.status, count(*), min(q.created_at), max(q.created_at), max(q.sent_at)
from public.notification_email_queue q
join public.notification_events ne
  on ne.department_id = q.department_id and ne.user_id = q.user_id and ne.notification_key = q.notification_key
where ne.kind in ('required_certification_expired','qualification_no_record',
                  'qualification_missing_day','qualification_missing_night')
  and q.created_at >= '2026-09-29'
group by 1;
-- also: any email ever sent post-cutover at all?
select status, count(*), max(sent_at) from public.notification_email_queue
where created_at >= '2026-09-29' group by 1;

-- Q4: false qualification-missing alerts where stored results exist
select count(distinct ne.user_id)
from public.notification_events ne
where ne.kind in ('qualification_no_record','qualification_missing_day','qualification_missing_night')
  and ne.last_seen_at >= '2026-09-29' and ne.resolved_at is null
  and exists (select 1 from public.qualification_results qr
              where qr.department_id = ne.department_id and qr.officer_user_id = ne.user_id
                and qr.passed is true and qr.qualification_date >= current_date - 365);

-- Q5: equipment hidden as "current" (truly expired/overdue) and 500-trigger candidates
select ea.department_id,
  count(*) filter (where ea.expiration_date < current_date)        as truly_expired_shown_current,
  count(*) filter (where ea.next_inspection_date < current_date)   as truly_overdue_shown_current,
  count(*) filter (where ea.expiration_date is null and ea.issue_date is not null
                     and et.default_valid_days is not null)        as derive_expiration_500_risk,
  count(*) filter (where ea.next_inspection_date is null and ea.last_inspection_date is not null
                     and et.default_inspection_interval_days is not null) as derive_inspection_500_risk
from public.equipment_assets ea
join public.equipment_types et on et.id = ea.equipment_type_id
where ea.lifecycle_status <> 'removed'
group by 1;
-- (requirement-level valid_days / inspection_interval_days in department_equipment_requirements can also trigger the 500)

-- Q6: off-duty requests that now show Non-Compliant / cannot be approved
select r.department_id, r.request_status, count(*)
from public.off_duty_firearm_requests r
where exists (select 1 from public.off_duty_firearm_inspections i
              where i.request_id = r.id and i.result = 'Pass')
group by 1,2;

-- Q7: personal rifle expiry alerts suppressed
select department_id, count(*) from public.personal_rifles
where status = 'Approved' and expiration_date between current_date and current_date + 60
group by 1;

-- Q8: duplicate certifications created since cutover (import dedupe failure)
select department_id, user_id, certification_type_id, issue_date, expiration_date, count(*)
from public.training_certifications
where is_active and created_at >= '2026-09-29'
group by 1,2,3,4,5 having count(*) > 1;

-- Q9: fleet vehicles with due dates in window (missing from dashboard/fleet page states)
select department_id, count(*) from public.fleet_vehicles
where status <> 'Retired'
  and least(coalesce(next_service_date,'infinity'), coalesce(inspection_due_date,'infinity'),
            coalesce(registration_expiration_date,'infinity')) <= current_date + 30
group by 1;

ROLLBACK;
```

## 5. Hotfix safety (parser returns date text unchanged for OID 1082)

Searched all non-test `src/**/*.ts(x)` for Date-only usage on date-column values:
- `instanceof Date`: only `src/lib/notifications/date-value.ts:3`, which also handles strings (`:8-10`, no-`T` → `${value}T00:00:00` local; container UTC ⇒ identical to current Date value). **Safe.**
- `.toISOString()/.getTime()/.getFullYear()/.getUTC*()/.toLocale*()` directly on a date-column value: **none found**. All `toISOString`/`getTime` hits are on `new Date()`, timestamptz (`postgres-refresh-sessions.ts:13,97` – `authenticated_at`/`expires_at`, unaffected), or freshly constructed Dates.
- Relational compare of a date column against `new Date()/now/Date.now()`, `Number(col)`, unary `+col`, `new Date(col)`, `Date.parse(col)`: **none found**.
- Writes: pg serializes Date params as local ISO with offset and strings as-is; both cast to the same `date`. Write-backs of previously-read values (`equipment/assets/route.ts:350`, `personal-rifles/[rifleId]/route.ts:191,294`) become `"YYYY-MM-DD"` — **no behavioral change**. Filters (`.eq/.lt` etc.) take caller values; unaffected.
- **Side effects to expect (benign but real)**:
  - `notificationFingerprint = JSON.stringify(item)` (`src/lib/notifications/event-reconciliation.ts:23-27`). Fleet alerts embed the date in `detail`/`createdAt` (`fleet-notifications.ts:56,75`) ⇒ after the fix their fingerprint changes once ⇒ event marked changed (ack/snooze may reset per reconciliation rules) and a **new Pending email row** may be enqueued for each fleet due alert on the user's next My Home load.
  - False certification "Expired"/qualification-missing events will revert (kind/fingerprint change or resolve) only when each affected user next loads My Home; stale `Pending` queue rows for non-returning users persist (dispatcher would cancel only if event resolved/fingerprint changed).
  - `source_created_at` receives `"YYYY-MM-DD"` instead of a Date for fleet alerts → timestamptz cast at session TZ (UTC on RDS default) → same instant.
- Fix does **not** address timestamptz Dates (see §6).

## 6. Adjacent finding (not fixed by the date hotfix)

`src/lib/tracepoint/command-operations.ts:36-40` `dateValue` rejects non-strings; `agency_training_events.starts_at` (timestamptz) is a top-level column in `src/lib/operations/read-repository-supabase.ts` `listTrainingEvents` ⇒ Date ⇒ 0 ⇒ Command Dashboard **upcoming training / training attention lists empty** (`:58-62`, `:75-90`). Same class of bug for timestamptz; needs its own fix (e.g. accept Date in `dateValue`).
