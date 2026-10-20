# TracePoint audit: administration, onboarding, permissions, navigation and oversight

**Method.** This is a read-only audit based on reading the code. Nothing was run: no app, no tests, no database, no email delivery. Every "Confirmed defect" below comes from code I actually read (file:line given). Runtime behaviour such as email templates, Supabase project settings or deployed environment variables was **not** observed. Where a finding depends on that kind of behaviour, it is classified as a potential gap.

Repos: `/home/user/tracepoint` (app) and `/home/user/tracepoint-landing` (marketing site). There is no git metadata in the working copy, so I could not tell which leftover files are actually committed.

---

## 1. Workflow inventory

| Workflow | Route(s) / API | Operational purpose | Primary roles |
|---|---|---|---|
| Create agency (tenant) | `/platform` → `CreateAgencyForm` → `POST /api/platform/agencies` → RPC `platform_create_agency` | Provision a new department and platform account record | TracePoint platform admin |
| Agency detail / first admin | `/platform/[departmentId]` (Send Activation, Make Administrator, Access Agency) → `/api/settings/users/activation`, `/api/platform/agency-user-administrator`, `/api/platform/support-mode` | List members, promote an Administrator, send activation, enter support mode | Platform admin |
| Module entitlements | `/super-admin` → `GET/PATCH /api/super-admin` | Turn feature modules on or off per agency | Platform admin (needs a membership or support mode) |
| Support mode | `/api/platform/support-mode` (POST/DELETE), `SupportModeBanner` | Audited impersonation-style access to an agency | Platform admin |
| Self-created department | `/auth/setup` → RPC `create_department_with_owner` | "Establish your TracePoint department" for a signed-in user with no membership | Any authenticated user with no active membership |
| Sign in | `/login` (password, or magic link via `/auth/callback`) | Authentication | All |
| Account activation | Email → `/activate?token=` → `completeActivation` | First password for an invited user | New users |
| Password reset (admin-initiated) | Settings → `POST /api/settings/users/password-reset` → Supabase email → `/auth/confirm` → `/auth/setup` | Recover access | Admin / manage_users |
| Assign password | Settings → `AssignPasswordModal` → `POST /api/settings/users/assign-password` | Admin sets a password directly | Admin / manage_users |
| Invite user | Settings › Users & Roles → `POST /api/settings/users/invite` | Add one person, roles and groups; email activation | Admin / manage_users |
| Edit member / deactivate / transfer | Settings › Edit Access → RPCs `update_department_member`, `set_department_member_roles`, `set_department_group_members` | Badge, rank, unit, employee number, active flag, roles, groups | Admin / manage_users |
| Role permission matrix | Settings › Users & Roles › Role Permission Matrix → `POST /api/settings/role-permissions` | Grant permissions to the (global) roles for this department | Administrator |
| Organization lists | Settings › Organization (titles, units, groups) | Pick-lists for rank, unit and group | Administrator |
| Agency profile / branding / patch | Settings › Agency Profile, Branding; `/api/settings/department-patch` | Identity, timezone, contact, appearance | Administrator |
| Rules engine | Settings › Rules Engine (Armory, Range & Qual, Certifications, Equipment, Off-Duty, Agency Training, Fleet panels); `/api/settings/current-rules`, `/api/settings/off-duty-rules`, `/api/settings/certification-capabilities`; also `/settings/fleet` | Department policy intervals and thresholds | Administrator (Fleet: manage_fleet_rules) |
| Security policy | Settings › Audit & Security | MFA flag, session timeout, export logging, retention | Administrator |
| Audit log view and export | Settings › Audit & Security → `/api/settings/audit-log`; Import/Export → `/api/settings/audit-log/export` | Who changed what | view_audit_log / Administrator |
| Classic import | `/settings/import-export` (also `/import` redirect) → `/api/settings/onboarding/{personnel,firearms,qualification-history,certifications,equipment,off-duty-firearms}` | Bulk onboarding from CSV/XLSX | Administrator (API also accepts manage_users / platform admin) |
| AI-assisted import (beta) | `/settings/import-export/ai-importer` → `/api/settings/ai-importer/*` | Interpret, map, validate and execute a spreadsheet | Administrator |
| Multi-file migration | `/settings/import-export/migration` → `/api/settings/ai-importer/workspaces/*` | Resumable multi-file migration plan | Administrator |
| Report builder (CSV/PDF) | `/settings/import-export` "Branded Reports" (`src/lib/reports/report-definitions.ts`); `/api/settings/data-exports` | Printable or exportable command reports | Administrator only, in practice (see ADM-09) |
| Command dashboard | `/command-dashboard` (+ `?customize=dashboard`), `/api/command-dashboard/operations`, `CommandOperationsPanel` | Department-wide readiness and queues | view_command_dashboard |
| Analytics | `/analytics` (+ `?customize=analytics`) → `/api/pilot/performance-summary` | Trends | view_analytics |
| Dashboard customisation | Settings › Dashboard Views; orphan `/settings/command-dashboard-analytics` | Arrange cards | Administrator |
| Personal notification prefs | Settings › My Notifications (`NotificationPreferencesPanel`) | Email digest settings | Intended for all users (unreachable for officers, see ADM-06) |
| Department switch | Shell → `/api/active-department` | Multi-agency members | Members of more than one agency |
| Help center | `/help` (`help-content.ts`) | Self-service guidance | All |
| Unauthorized | `/unauthorized` | Denied-route landing | All |

### 1a. Navigation map (`src/app/components/TracePointShell.tsx:73-260`)

`administer_department` satisfies every requirement (`permissions.ts:85`). "Feature" means a `department_features` entitlement; super admins skip the feature check in the nav (`TracePointShell.tsx:273-277`).

| Nav label | Route | Requirement |
|---|---|---|
| My Home | `/` | none |
| Command › Command Dashboard | `/command-dashboard` | view_command_dashboard + feature `command_dashboard` |
| Command › Analytics | `/analytics` | view_analytics + feature `analytics` (the layout also requires `range_training`) |
| Armory (group) | — | manage_firearms or manage_inspections or view_command_dashboard |
| › Department Firearms | `/firearms` | feature `firearms` |
| › Personally Owned Rifles | `/firearms/personal-rifles` | feature `firearms` |
| › Maintenance & Inspections | `/firearms/inspections` | manage_inspections / manage_firearms / view_command_dashboard |
| › Ammunition / Reconciliation | `/firearms/ammunition[/reconciliation]` | manage_firearms / view_command_dashboard + feature `ammunition` |
| Training › Range Days / Agency Training | `/range-days`, `/agency-training` | feature `range_training` |
| Training › Training Alerts | `/training-alerts` | manage_training or view_analytics + `range_training` |
| Readiness › Qualifications / Certifications | `/qualifications`, `/training/certifications` | features `qualifications` / `certifications` |
| Assets & Fleet › Equipment | `/equipment` | feature `equipment_readiness` |
| Assets & Fleet › Fleet Management | `/fleet-management` | any fleet permission (no feature entitlement exists) |
| Off-Duty Firearms › Requests & Approvals | `/off-duty-firearms` | submit_ or review_off_duty_requests + `off_duty` |
| Super Admin | `/super-admin` | platform admin only |
| Administration › Settings | `/settings` | manage_users / view_audit_log / administer_department |
| Administration › Import / Export | `/settings/import-export` | administer_department |
| Help Center | `/help` | none |
| (header patch icon) | `/settings` | shown to **all** users (`TracePointShell.tsx:~595`) |

### 1b. Routes not reachable from the nav

- `/platform` and `/platform/[departmentId]`: reached only by typing the URL or via the `/auth/setup` redirect. There is no link from `/super-admin`, and these pages don't use the shell.
- `/settings/command-dashboard-analytics`: orphaned. Nothing links to it, and it duplicates the Settings "Dashboard Views" tab.
- `/settings/fleet`: reached from the fleet vehicle header gear icon only. It is also embedded in the Rules Engine.
- `/settings/import-export/ai-importer` and `/migration`: reached from cards on the Import page.
- `/notifications`: reached from Home and email links.
- `/training`: a hub page. The only link to it is the "back" link on Certifications.
- `/personal-rifle-review/[id]`, `/firearms/[id]`, `/firearms/inspections/new`, `/fleet-management/[id]`: detail pages.
- `/import` → redirects to `/settings/import-export`. `/inspections` → redirects to `/firearms/inspections`. Both are legacy duplicates.
- `/activate`, `/auth/setup`, `/unauthorized`, `/landing`, `/login`: auth flow pages.

---

## 2. End-to-end assessments by role

### 2a. Platform owner provisions a new agency (about 20+ steps; one step is broken)

1. Type `/platform` (there is no nav link) and fill in the Create Agency form: 11 fields, defaults "pilot/pilot", Eastern time, and placeholder text naming a real agency ("Montville Township Police Department", `CreateAgencyForm.tsx:138`).
2. **Enable modules.** The agency is created with **no modules enabled**. The migration says "No tenant is enabled automatically" (`202609050003_feature_entitlements_and_rules.sql:2`). Entitlements can only be set in `/super-admin`. Its API calls `resolveServerAccess()`, which needs a membership or support mode (`api/super-admin/route.ts:11-21`). So the platform admin must:
   - go to Manage Agency → Access Agency (support mode), which lands on `/firearms`;
   - open Super Admin from the nav, pick the agency and toggle up to 9 modules.
3. **Create the first administrator.** `/platform/[id]` has no "add person" action. Settings › Invite rejects a platform admin who isn't a member, because the invite route only checks `has_department_permission` (`api/settings/users/invite/route.ts`, permission block). The only path is: Import / Onboard Data → classic import wizard → a personnel CSV. A badge number is mandatory (`onboarding/personnel/route.ts:81`). Then back in `/platform/[id]`, click Make Administrator, then Send Activation.
4. **The activation email fails for this user.** Imported accounts are created with `email_confirm: true` (`onboarding/personnel/route.ts:141`), but `validateActivationToken` rejects any confirmed account (`activation.ts:326-333`) with "This account no longer requires activation." The workaround is support mode → Settings → Users & Roles → Assign Password, then giving the password to the chief out-of-band. Alternatively the chief can use the magic-link login. Neither workaround is documented.
5. The "Onboarding" column on `/platform` stays at `agency_created` forever. No code ever updates `platform_agency_accounts`.

### 2b. Agency administrator configures the department (about 15–30 steps, depending on modules)

- Settings tabs: Agency Profile → Organization (titles, units, groups) → Users & Roles → Rules Engine (7 sub-panels, each with its own Save, plus a global "Save Rules Engine" header button) → Branding → Dashboard Views → Import/Export → Audit & Security.
- Personnel can be added:
  - manually (Invite: about 8 fields and roles);
  - by classic import (upload → map → preview → import);
  - by AI importer (7 steps, `ai-importer/page.tsx:14`);
  - by multi-file migration.
- These three importers behave differently on existing people (ADM-04, ADM-24).
- Roles are a fixed global list: Officer, Instructor, Range Master, Armorer, Supervisor, Command Staff, Chief, Administrator, plus Fleet roles. The administrator edits a 21-permission matrix per role. Permission descriptions are good (`permissions.ts:32-54`). However, the role names promise scopes that don't exist (e.g. Supervisor = "Supervisory review", with no subordinate concept).
- The "Configuration Status" panel always reports Users and Operational Rules as "Configured" (ADM-17), so it gives no real onboarding guidance.

### 2c. User invite, activation and lockout

- **Invited user:** receives a 14-day link → `/activate` → sets password → signed in. About 3 steps; this path works on reading.
- **Imported user:** the activation link fails (ADM-01).
- **User who forgets their password:** the login page has no "Forgot password" link (`LoginForm.tsx`). Only "Email me a secure sign-in link" exists. The Help Center tells users to "select Forgot password" (`help-content.ts:91`). In practice the user has to call an admin, who sends a reset or assigns a password.
- **Account lockout:** there is no lockout policy or unlock UI. Supabase rate-limiting is the only control.

### 2d. Officer separation (deactivation)

- An administrator opens Edit Access and unticks Active. That's 3 clicks.
- `update_department_member` only flips `is_active` and `deactivated_at` (`202606260003_settings_administration.sql:643-655`). It does not:
  - return or reassign firearms, equipment or vehicles;
  - cancel or reassign open off-duty requests, personal-rifle requests or remediation items;
  - revoke sessions or disable the auth account.
- The UI gives no warning listing what the officer still has (ADM-05).
- Worse, the separated officer can still sign in. The proxy sends them to `/auth/setup`, which offers to **create a new department with them as Administrator** (ADM-03).

### 2e. Transfer (rank, unit or supervisor change)

- An admin edits the Rank and Unit pick-lists. The new value overwrites the old one. There is no effective date, no history view, and no supervisor field: no supervisor, team, shift or squad concept exists in the schema.
- Groups exist (`department_groups`) but are not used for authorisation or scoped views.
- Renaming a unit doesn't update members, who hold the unit name as a free-text copy (ADM-18).

### 2f. Command staff

- **Command Dashboard:** module cards drill down only to the module root (e.g. `/qualifications`, `/firearms`), not to the officer or record (ADM-11).
- If a data endpoint fails, the card shows "No requirements configured" or empty data, not an error (ADM-10).
- There is no export or print on the Dashboard or Analytics.
- The report builder (CSV/PDF) lives inside the admin-only Import/Export page. Command staff without `administer_department` cannot open it, even though report definitions grant them access (ADM-09).

### 2g. Supervisors

There is no team or subordinate scoping anywhere. A supervisor either receives department-wide permissions such as `view_command_dashboard`, or sees only their own records. The landing page claim that "Supervisors see exceptions that need follow-up" (for their people) is not implemented as a distinct view.

### 2h. Officers

- **Nav:** My Home, Training, Readiness, Equipment, Off-Duty (if granted) and Help.
- They cannot reach their own email notification settings (ADM-06).
- The Armory group is hidden, so they cannot find the personally-owned-rifle submission page from the nav (ADM-34).
- The patch icon links them to `/settings`, which leads to `/unauthorized`.

### 2i. Verdict: can an unfamiliar department onboard itself?

**No.**

- A new agency cannot be created without a TracePoint platform administrator. The `/auth/setup` self-create path is an unintended side door (ADM-03), not a supported flow, and it creates a tenant with zero modules enabled.
- Even with a platform admin, the first-admin path relies on bulk import, whose activation links are broken (ADM-01). Recovery needs undocumented support-mode steps.
- Once the agency admin is in, Settings is broadly usable. But the admin will run into:
  - contradictory import guidance (ADM-24);
  - a readiness checklist that always shows green (ADM-17);
  - security controls that are not enforced (ADM-13);
  - a Help Center that marks two live modules "Coming soon" and points to a non-existent Forgot Password link;
  - roster re-imports that silently strip supervisory and admin roles (ADM-04).

**Realistic estimate:** a department needs TracePoint staff for provisioning, module entitlement and first-admin activation. It needs guidance (or a developer-aware support contact) for imports and offboarding.

---

## 3. Findings

### ADM-01: Bulk-imported personnel can never complete email activation
- **Classification:** Confirmed defect · **Priority:** Critical · **Module:** Onboarding / activation (classic and AI importers)
- **Scenario:** A department imports 60 officers. The admin clicks "Send Activation" for each one. Every officer opens the email and sees "This account no longer requires activation." Nobody can set a password.
- **Evidence:**
  - Classic importer: `src/app/api/settings/onboarding/personnel/route.ts:139-145` creates users with `createUser({ email, email_confirm: true, ... onboarding_status: "pending_activation" })`.
  - AI importer: `src/lib/ai-importer/server/execution.ts:45` does the same (`email_confirm: true`).
  - `src/lib/tracepoint/activation.ts:326-333` rejects confirmed accounts: `if (userData.user.email_confirmed_at || onboardingStatus === "activated") { throw new Error("This account no longer requires activation.") }`.
  - The Settings and Platform "Send Activation" buttons are still shown, because membership is `pending_activation`.
- **Fix:** Pick one rule. Either create imported users with `email_confirm: false` (as `invite/route.ts:179` does), or base activation eligibility on the membership's `activation_status` and the `onboarding_status` metadata rather than `email_confirmed_at`. Add a regression test that covers import followed by activation.
- **Benefit:** Bulk onboarding works end to end. **Complexity:** S

### ADM-02: The platform owner has no supported way to create a new agency's first administrator
- **Classification:** Confirmed defect · **Priority:** High · **Module:** Platform / Settings
- **Scenario:** A TracePoint staff member creates a new agency and wants to invite the chief.
- **Evidence:**
  - `/platform/[departmentId]/page.tsx` only lists existing members. It has no Add or Invite button.
  - `api/settings/users/invite/route.ts` authorises only through `has_department_permission(manage_users|administer_department)` and has no `is_platform_admin` branch. In support mode the platform admin is not a member, so the call returns 403.
  - `update_department_member` (`202606260003_settings_administration.sql:586-596`) is also membership-only, so a platform admin cannot edit or deactivate members in support mode either.
  - The only remaining path is the bulk personnel import, which leads into ADM-01.
- **Fix:** Add an "Invite first administrator" action on `/platform/[id]` that invites and assigns the Administrator role in one step. Let the platform admin pass the invite and member RPC checks, with an audit record.
- **Benefit:** Repeatable provisioning without workarounds. **Complexity:** M

### ADM-03: A deactivated (separated) user can create a new department with themselves as Administrator
- **Classification:** Confirmed defect · **Priority:** High · **Module:** Auth / tenant governance
- **Scenario:** An officer is terminated and deactivated. Their auth account still works, so they sign in and are offered "Establish your TracePoint department". This creates an unmanaged tenant outside platform provisioning. Any existing user with no membership can do the same.
- **Evidence:**
  - The proxy sends users with zero memberships to `/auth/setup` (`src/lib/supabase/proxy.ts:279-293`).
  - `/auth/setup/page.tsx:597-616` renders `InitialDepartmentSetupView` when there is no active membership.
  - The `createInitialDepartment` action calls RPC `create_department_with_owner` (`page.tsx:~150`).
  - That RPC inserts the department and gives the caller the `'administrator'` role (`202606220001_tracepoint_foundation.sql:1194-1257`). It is granted `to authenticated` (`:1984-1991`).
  - Deactivation never disables the auth user (ADM-05).
- **Fix:** Revoke `create_department_with_owner` from `authenticated`, or restrict it to platform admins. Replace the setup view with "Your access has ended — contact your administrator." Ban or disable the auth user when their last membership is deactivated.
- **Benefit:** Closes a tenant-sprawl and accountability hole. **Complexity:** S

### ADM-04: Classic personnel re-import strips every matched member's roles and can reactivate separated officers
- **Classification:** Confirmed defect · **Priority:** High · **Module:** Import / Export
- **Scenario:** An admin re-imports the roster to correct badge numbers. Every sergeant, range master and other administrator is reduced to plain "Officer". If the file has no "Active" column, everyone in it, including separated officers, becomes active again.
- **Evidence:**
  - `onboarding/personnel/route.ts:193-198` calls `set_department_member_roles` with `p_role_codes: ["officer"]` for every row, new or existing.
  - The membership upsert sets `is_active: active` (`:~176`), and `isActiveValue("")` returns `true` (`:~22`).
  - The profile `full_name` is overwritten (`:~160`).
  - The RPC replaces the whole role set (`202609060003_reconcile_granular_permission_authority.sql:224-231`). Only the last Administrator is protected (`:216-222`).
  - By contrast, the AI importer's UPDATE path preserves roles (`execution.ts:35-40`).
- **Fix:** For existing members, add the `officer` role only if they have no roles, and never remove roles. Treat a missing Active column as "no change". Show a diff preview of role and status changes before execution.
- **Benefit:** Prevents silent loss of supervisory and admin access. **Complexity:** S

### ADM-05: Separation (deactivation) has no offboarding workflow
- **Classification:** Verified usability problem · **Priority:** High · **Module:** Settings › Users / cross-module
- **Scenario:** An officer retires. Their department firearm, radio, vehicle assignment and pending off-duty request all stay attached to an inactive person. There is no prompt to recover them, and command staff are not told.
- **Evidence:**
  - `update_department_member` only sets `is_active` and `deactivated_at` (`202606260003_settings_administration.sql:643-655`).
  - The member modal toggle has nothing else attached (`settings/page.tsx:~4947-4956`).
  - No query anywhere checks open assignments on deactivation. Inactive members are only excluded from *new* assignments (`api/armory/firearms/[firearmId]/assignments/route.ts:102-106`).
  - The auth account is not disabled.
- **Fix:** Add a "Separate member" flow. It should list open firearms, equipment, fleet, off-duty, personal-rifle and remediation items. It should require each item to be resolved or reassigned, record the separation reason and date, disable login, and generate a separation checklist PDF.
- **Benefit:** Keeps the property chain of custody intact. **Complexity:** L

### ADM-06: Officers cannot reach "My Notifications", although Help sends every role there
- **Classification:** Confirmed defect · **Priority:** High · **Module:** Settings / Navigation
- **Scenario:** An officer wants a daily digest instead of immediate emails. They follow Help → "Open Notification Settings" and land on `/unauthorized`.
- **Evidence:**
  - The panel exists only as a Settings tab (`settings/page.tsx:868-872`, `4344-4345`).
  - The `/settings` route requires `manage_users|view_audit_log|administer_department` (`permissions.ts:75`). The nav Administration group uses the same requirement (`TracePointShell.tsx:240-245`).
  - The help article `email-notifications` targets `roles: allRoles` with `route: "/settings"` (`help-content.ts:154-171`).
- **Fix:** Move personal preferences to a "My Account" page (`/account`) reachable by every member. That page could also hold password change and profile.
- **Benefit:** Officers control their own reminder noise. **Complexity:** S

### ADM-07: "Forgot password" is documented but doesn't exist
- **Classification:** Confirmed defect · **Priority:** High · **Module:** Login / Help
- **Scenario:** An officer is locked out at shift start. Help tells them to click "Forgot password", but there is no such link, so they call a supervisor, who may not have `manage_users`.
- **Evidence:**
  - `help-content.ts:84-98`: "Open the TracePoint sign-in page and select Forgot password."
  - `LoginForm.tsx:90-176` contains only the password sign-in and "Email me a secure sign-in link". There is no `resetPasswordForEmail` call on the client.
  - There is no self-service change-password page either. `/auth/setup` acts as one, but nothing links to it.
- **Fix:** Add a Forgot Password flow that uses the TracePoint-branded email channel, plus a "Change password" item in My Account. Rewrite the help article to match.
- **Benefit:** Fewer lockout calls. **Complexity:** S

### ADM-08: The Help Center is stale and incomplete
- **Classification:** Verified usability problem · **Priority:** Medium · **Module:** Help
- **Scenario:** A new admin reads that Agency Training and Fleet are "a preview of a planned module… not yet an active recordkeeping workflow", so they keep paper records even though both modules are live.
- **Evidence:**
  - `help-content.ts:414-430` and `673-689` mark both modules `status: "Coming soon"`. Yet `agency-training/page.tsx` (908 lines) and `fleet-management/page.tsx` (1094 lines) are fully implemented and backed by `agency_training_v1` and `fleet_v1` migrations.
  - Vendor names leak into keywords: `"brevo"` (`:160`, `:745`), although email moved to SES.
  - "Filter or review events … when available" (`:643`): the audit viewer has no filters.
  - There are no articles on separation, transfer, role meanings, or the multi-agency switcher. There is no support contact or escalation path anywhere in `help/page.tsx`.
- **Fix:** Have a Help review in the release checklist. Remove the "Coming soon" articles. Add articles on offboarding, transfers and the role matrix. Add a support contact.
- **Benefit:** Help that matches the product. **Complexity:** S

### ADM-09: Command staff cannot use the report builder; per-report permissions are dead code
- **Classification:** Confirmed defect · **Priority:** High · **Module:** Reports / Import-Export
- **Scenario:** A captain with Command Staff permissions needs a printable Certification Readiness report for a council meeting. The report builder is reachable only by Administrators.
- **Evidence:**
  - `src/lib/reports/report-definitions.ts:12-31` grants reports to `view_command_dashboard`, `view_analytics`, `manage_*` and others.
  - The builder lives in `/settings/import-export/page.tsx` ("Branded Reports", around line 6690).
  - The proxy rule `{ prefix: "/settings/import-export", requirement: { anyOf: ["administer_department"] } }` (`permissions.ts:72`) and the nav (`TracePointShell.tsx:251-256`) both restrict it to `administer_department`, which satisfies every report definition by itself.
- **Fix:** Move Reports to its own route, e.g. `/reports` under Command, gated per definition. Keep Import/Export admin-only.
- **Benefit:** Command staff can self-serve reports. **Complexity:** M

### ADM-10: The Command Dashboard hides data-load failures as "not configured" or empty
- **Classification:** Confirmed defect · **Priority:** High · **Module:** Command Dashboard
- **Scenario:** The certification readiness API returns 500 or 403. The chief sees "Certification Readiness — / No requirements configured" and empty firearm and personnel lists, and concludes nothing needs attention.
- **Evidence:**
  - `command-dashboard/page.tsx:324-398` replaces each non-OK response with an empty payload: `certificationReadinessResponse.ok ? … : { summary: { totalRequiredChecks: 0, …, readinessPercent: 100 }, rows: [] }`.
  - The card then reads `totalRequiredChecks === 0` as "No requirements configured" (`:1219-1233`).
  - `loadError` is set only on thrown exceptions (`:732-736`).
  - By contrast, `CommandOperationsPanel.tsx:297-299` and `analytics/page.tsx:202-230` do surface errors.
- **Fix:** Track per-source load status. Show "Data unavailable — retry" on affected cards, and add a banner listing the failed sources.
- **Benefit:** Command decisions aren't made on silently missing data. **Complexity:** S

### ADM-11: Dashboard drill-downs are shallow, and Dashboard and Analytics have no export or print
- **Classification:** Verified usability problem · **Priority:** Medium · **Module:** Command Dashboard / Analytics
- **Scenario:** The dashboard lists "Ofc. Smith · Expired". Clicking it opens the generic `/qualifications` page, and the user has to search for Smith again.
- **Evidence:**
  - `command-dashboard/page.tsx:874` (`href: "/qualifications"`), `:893` (`"/training/certifications"`), `:948` (`"/equipment"`), `:961` (`"/firearms"`, although `/firearms/[firearmId]` exists).
  - Neither `command-dashboard/page.tsx` nor `analytics/page.tsx` contains any export, CSV or print control.
- **Fix:** Deep-link with record or officer query parameters (e.g. `/qualifications?officer=<id>`, `/firearms/<id>`). Add "Export / Print" on the dashboard.
- **Benefit:** One-click action from the dashboard. **Complexity:** M

### ADM-12: The audit log viewer is too thin for oversight, and its CSV export bypasses export auditing
- **Classification:** Confirmed defect · **Priority:** Medium · **Module:** Settings › Audit & Security
- **Scenario:** An Internal Affairs lieutenant needs "every change to Ofc. Doe's firearm assignments in March".
- **Evidence:**
  - The viewer shows a fixed 100 events (`settings/page.tsx:1215`) with no filter, search or pagination (`:4410-4535`).
  - The actor is resolved only from current members, so platform admins and removed users appear as raw UUIDs: `actor?.full_name || event.changed_by_user_id` (`:~4443`).
  - The tab's "Export CSV" calls `/api/settings/audit-log?limit=5000` (`:2271`). That route never calls `recordDataExport`, so the export itself is not audited. Output silently stops at 5000 rows.
  - CSV cells are not protected against formula injection (`:2290-2320`). The separate `/api/settings/audit-log/export` route *does* audit.
  - The help text promises filters (`help-content.ts:643`).
- **Fix:** Add a server-side filtered and paginated audit query (actor, entity, action, date, record). Resolve actor names, including platform staff. Route every export through the audited endpoint and escape leading `= + - @`.
- **Benefit:** A real "who changed what" capability. **Complexity:** M

### ADM-13: The Security Policy controls are stored but not enforced
- **Classification:** Verified usability problem · **Priority:** Medium · **Module:** Settings › Audit & Security
- **Scenario:** An admin sets "MFA required" and a 15-minute session timeout for CJIS alignment and believes both are in force.
- **Evidence:**
  - The card admits "stored now … Authentication enforcement will be connected" (`settings/page.tsx:4352`).
  - `require_mfa_policy`, `session_timeout_minutes` and `data_retention_days` are referenced only in `settings/page.tsx` (grep).
  - `IdleSessionGuard.tsx:5-6` hard-codes 25 and 30 minutes.
  - Export logging *is* honoured (`export-audit-server.ts:15-28`). However, an administrator can switch it off and export unaudited.
- **Fix:** Enforce the timeout from department settings and MFA through the auth provider. Implement retention, or hide these controls behind a "Not yet enforced" badge. Make the export-logging toggle platform-only.
- **Benefit:** Admins aren't misled about their security posture. **Complexity:** M

### ADM-14: The department timezone has no effect
- **Classification:** Confirmed defect · **Priority:** Medium · **Module:** Agency Profile / all date displays
- **Scenario:** A Central-time agency's audit timestamps and due dates render in each viewer's browser timezone, so a laptop on Eastern time shows different dates for "due today".
- **Evidence:**
  - The timezone is stored and edited (`settings/page.tsx:1041`, `2676`) and defaults to `America/New_York` (`api/platform/agencies/route.ts:153-155`).
  - There are 0 occurrences of `timeZone:` in `src/app`.
  - `formatDateTime` uses only `Intl.DateTimeFormat("en-US", …)` (`settings/page.tsx:299-311`).
- **Fix:** Pass the department timezone through the access payload. Use it in one shared formatter and label timestamps with the zone.
- **Benefit:** Due and expired calculations are consistent across devices. **Complexity:** M

### ADM-15: No supervisor-to-subordinate, team, shift or unit scoping
- **Classification:** Potential gap requiring operational validation · **Priority:** Medium · **Module:** Permissions model
- **Scenario:** A patrol sergeant should see readiness exceptions for their squad only. Today the department must give them department-wide `view_command_dashboard` or nothing.
- **Evidence:**
  - Memberships hold only `rank_title` and `unit_name` text (`server-access.ts:58-63`).
  - grep finds no `supervisor_id`, `reports_to` or shift columns.
  - Groups exist (`202608190004_department_organization.sql:65-106`) but are used only for membership lists.
  - The Supervisor role description is "Supervisory review and operational visibility" (`202606220001_tracepoint_foundation.sql:273`).
  - The landing page markets supervisor-specific views.
- **Fix:** Validate the need with pilot agencies. If confirmed, add a `supervisor_user_id` on membership and/or group-scoped permissions, plus a "My Team" readiness view.
- **Benefit:** Least-privilege oversight at the first-line level. **Complexity:** L

### ADM-16: Roles are a fixed global list; agencies cannot define their own
- **Classification:** Optional improvement · **Priority:** Medium · **Module:** Permissions
- **Scenario:** An agency wants a "Quartermaster" (equipment only) or a "Training Coordinator" role. It has to repurpose "Armorer" or "Instructor", which confuses everyone.
- **Evidence:**
  - Roles are seeded globally (`202606220001_tracepoint_foundation.sql:269-276`). The matrix only edits grants per existing role (`settings/page.tsx:3270-3340`).
  - `server-access.ts:80-104` still lists legacy aliases (`department_admin`, `admin`) that no longer grant anything.
  - The Users list shows "N effective permissions" as a bare count (`:~3186`).
- **Fix:** Add department-scoped custom roles (clone from a template). Show effective permissions in plain language, and remove the dead aliases.
- **Benefit:** The model matches the real org chart. **Complexity:** M

### ADM-17: The "Configuration Status" panel always shows green for users and rules
- **Classification:** Confirmed defect · **Priority:** Medium · **Module:** Settings › Agency Profile
- **Scenario:** A new admin sees "User administration: Configured" and "Operational rules: Configured" on day one, with no personnel imported and no rules reviewed.
- **Evidence:**
  - `settings/page.tsx:2735-2746`: `ready: members.length > 0` is always true because the admin is a member.
  - `ready: Boolean(rules.inspection_interval_days)` is always true because of the column default `180` (`202606260003_settings_administration.sql:65`).
  - The panel doesn't cover enabled modules, certification types, qualification standards, pending activations or imported records.
- **Fix:** Replace it with a real onboarding checklist that has deep links and is computed from actual data.
- **Benefit:** Self-guided setup. **Complexity:** M

### ADM-18: Renaming a unit or rank doesn't update members or scoped requirements
- **Classification:** Confirmed defect · **Priority:** Medium · **Module:** Settings › Organization
- **Scenario:** "Patrol" is renamed "Patrol Division". Members keep "Patrol", unit-scoped equipment requirements stop matching, and the edit dialog cannot show their current unit.
- **Evidence:**
  - `renameOrganizationItem` uses `window.prompt` and only runs `.update({ name })` on the list table (`settings/page.tsx:1806-1833`).
  - Memberships store `unit_name` and `rank_title` as text (`202608190004_department_organization.sql:3`: "Existing … unit_name remain").
  - Equipment requirement `scope_value` is text (`readiness/read-repository-core.ts:48`).
  - There is no propagation trigger.
- **Fix:** Store unit and title IDs, or cascade renames in one transaction after a confirmation that shows the affected counts. Replace `window.prompt` with a proper modal.
- **Benefit:** Organizational changes don't corrupt readiness. **Complexity:** M

### ADM-19: Inviting can fail at scale, and re-inviting overwrites data
- **Classification:** Confirmed defect · **Priority:** Medium · **Module:** Settings › Invite
- **Scenario:** Once the platform has more than 2000 auth users, inviting an existing user from another agency fails with a raw "already registered" 500. Re-inviting a member to resend their email blanks their badge, rank and unit and reactivates them.
- **Evidence:**
  - `invite/route.ts:50-71` (`findUserByEmail`) scans `page <= 20` × 100 users. The same pattern is in `onboarding/personnel/route.ts`.
  - The upsert writes `badge_number: badgeNumber || null`, `is_active: true`, `deactivated_at: null` (`invite/route.ts:232-237`).
  - Errors are returned raw: `NextResponse.json({ error: message }, { status: 500 })`.
- **Fix:** Look users up by email directly (an indexed `profiles.email` or the admin API filter). Don't overwrite fields that weren't supplied. Block or confirm reactivation.
- **Benefit:** Reliable invites; no silent data loss. **Complexity:** S

### ADM-20: Saving a member runs three separate, non-atomic RPCs
- **Classification:** Confirmed defect · **Priority:** Low · **Module:** Settings › Edit Access
- **Scenario:** The role update fails after deactivation has already been saved. The admin sees an error, but the member is half-updated.
- **Evidence:** `settings/page.tsx:1900-1935` calls `update_department_member`, then `set_department_member_roles`, then `set_department_group_members`, each separately from the browser.
- **Fix:** Use a single server RPC or API route with one transaction.
- **Benefit:** Predictable saves. **Complexity:** S

### ADM-21: Support mode behaves inconsistently and its exit isn't reliably audited
- **Classification:** Confirmed defect · **Priority:** Medium · **Module:** Platform / Support mode
- **Scenario:** A support engineer enters an agency to help. They can assign a password, but they can't invite or edit a member. Their session ends by idle timeout, and no exit event is recorded.
- **Evidence:**
  - Support mode context grants `administer_department` and uses the service-role client (`server-access.ts:239-270`). Assign-password honours it (`assign-password/route.ts:46-80`).
  - The invite route and `update_department_member` use `auth.uid()`-based checks (ADM-02).
  - Entry lands on `/firearms` (`AccessAgencyButton.tsx:~33`).
  - The cookie expires after 8 hours (`support-mode/route.ts:157`). Idle sign-out and manual sign-out clear the cookies (`auth/signout/route.ts:6-20`) without writing `support_mode_exited`.
  - Support and platform routes call `supabase.auth.getUser()` directly instead of `getServerAuthenticatedUser` (`support-mode/route.ts:9-14`, `platform/agencies/route.ts:22-27`).
  - No reason or ticket is captured on entry.
- **Fix:** Use one authorisation path that honours support mode everywhere. Require a reason on entry. Audit exit on sign-out and expiry. Land on Settings or Home.
- **Benefit:** Support that is both effective and auditable. **Complexity:** M

### ADM-22: The platform console is fragmented and partly dead
- **Classification:** Confirmed defect · **Priority:** Medium · **Module:** Platform / Super Admin
- **Scenario:** Staff use `/platform` to create agencies and must separately discover `/super-admin` to enable modules. The "Onboarding" column never changes.
- **Evidence:**
  - `/platform` is not in the nav, and `/super-admin` doesn't link to it.
  - Nothing ever updates `platform_agency_accounts`: the only reads are at `platform/page.tsx:28` and in the read repository.
  - There is no edit for agency name, status or plan after creation.
  - "Make Administrator" has no confirmation and is shown for every member, including existing admins (`AdministratorButton.tsx`).
  - The first-time enablement of a feature is not written to `department_feature_events`, because a missing row defaults to `previousEnabled = true` (`api/super-admin/route.ts:168-169, 197`).
- **Fix:** Build one Platform console with tabs for Agencies, Modules, Members and Support. Make onboarding status editable or derived. Default `previousEnabled` to `false`. Add confirmations.
- **Benefit:** A coherent provisioning tool with an accurate entitlement history. **Complexity:** M

### ADM-23: Feature-gate handling is inconsistent between nav, layouts and support mode
- **Classification:** Confirmed defect · **Priority:** Medium · **Module:** Navigation / Entitlements
- **Scenario:** An agency has Analytics enabled but not Range & Training. The Analytics nav item shows, but clicking it silently bounces the user to Home. A platform admin who is also a member sees nav items for disabled modules, and they bounce too.
- **Evidence:**
  - The nav checks only `featureCode: "analytics"` (`TracePointShell.tsx:87-91`). `analytics/layout.tsx` also requires `range_training` and `redirect("/")` with no message.
  - The nav skips feature checks for super admins (`TracePointShell.tsx:273-277`). Layouts don't (`command-dashboard/layout.tsx:26-33`).
  - Fleet has no entitlement code at all: there is no `fleet` row in `feature_catalog`.
- **Fix:** Use one shared gate function for nav and layouts. Redirect to `/unauthorized?reason=feature` with a message. Add Fleet and Agency Training to the feature catalog.
- **Benefit:** Predictable navigation. **Complexity:** S

### ADM-24: Three importers with contradictory guidance and divergent behaviour
- **Classification:** Confirmed defect · **Priority:** Medium · **Module:** Import / Export
- **Scenario:** An admin reads in Settings that personnel import is "preview and validation" only. The import page says it imports directly. They pick one of three tools and get different results.
- **Evidence:**
  - Settings tab: "Personnel and qualification history currently support preview and validation… until the final normalized import targets are completed" (`settings/page.tsx:2561-2567`).
  - The import page says the opposite: "personnel, and qualification history import directly into normalized TracePoint records" (`import-export/page.tsx:~6545`).
  - The links render a literal "?" where an arrow glyph should be: `Open Import Wizard ?` (`settings/page.tsx:2515`, `2538`).
  - Classic import resets roles (ADM-04). The AI importer preserves them.
  - The AI importer's UPDATE path changes `profiles.email` but not the auth login email (`execution.ts:36`), so the displayed email and the login email diverge.
  - Personnel import is allowed for `manage_users` at the API but the UI is `administer_department` only. AI importer APIs require `administer_department`.
  - "AI-Assisted" runs in deterministic mode by default (`configuration.ts:12`).
- **Fix:** Pick one recommended importer, delete the stale Settings card and align the rules for existing members. Sync or forbid email changes. Label the deterministic mode honestly.
- **Benefit:** Less confusion during onboarding. **Complexity:** M

### ADM-25: The classic CSV parser breaks on multi-line cells, and exports allow formula injection
- **Classification:** Confirmed defect · **Priority:** Medium · **Module:** Import / Export
- **Scenario:** A firearms CSV has a quoted multi-line "Notes" field. Rows split mid-record and import into the wrong columns. An exported note beginning with "=" executes as a formula in Excel.
- **Evidence:**
  - `parseCsv` splits on newlines *before* handling quotes: `normalized.split("\n").filter(...)` (`import-export/page.tsx:583-584`).
  - The `splitCsvLine` stub is dead and returns `[]` (`:574-580`).
  - `csvEscape` doesn't neutralise `= + - @` (`:1240-1252`). The AI importer does (`ai-importer/page.tsx:50-53`).
- **Fix:** Use one RFC-4180 parser (or SheetJS, already a dependency) and one shared formula-safe CSV writer.
- **Benefit:** Data integrity and export safety. **Complexity:** S

### ADM-26: Personnel import requires a badge number
- **Classification:** Verified usability problem · **Priority:** Low · **Module:** Import
- **Scenario:** Civilian armorers, dispatchers and recruits without badges can't be imported.
- **Evidence:** `onboarding/personnel/route.ts:81`: `if (!departmentId || !firstName || !lastName || !email || !badgeNumber)`. Invite does not require a badge (`invite/route.ts`).
- **Fix:** Make badge optional and use employee number or email as the identifier.
- **Benefit:** The whole roster can be onboarded. **Complexity:** S

### ADM-27: Admin-assigned passwords are permanent and known to the admin
- **Classification:** Potential gap requiring operational validation · **Priority:** Medium · **Module:** Users / Security
- **Scenario:** An admin assigns "Welcome123" to 20 officers. Nothing forces a change, so actions logged under those accounts are weakly attributable.
- **Evidence:** `assign-password/route.ts:166-186` sets the password, marks the account `email_confirm: true` and `activation_status: "activated"`, and records no forced-change flag. The modal requires only 8 characters (`AssignPasswordModal.tsx`).
- **Fix:** Set a "must change password" flag that is enforced by the proxy and redirects to a change-password screen. Check this against the agency's CJIS policy.
- **Benefit:** Each credential is known only to its owner. **Complexity:** S

### ADM-28: The admin-initiated reset depends on an unverified email template; platform admins can't complete it
- **Classification:** Potential gap requiring operational validation · **Priority:** Medium · **Module:** Auth
- **Scenario:** An officer clicks the reset email and lands on "Authentication link is incomplete or invalid."
- **Evidence:**
  - Reset uses Supabase's `resetPasswordForEmail(email, { redirectTo: …/auth/confirm?next=/auth/setup })` (`password-reset/route.ts:145-149`).
  - `/auth/confirm` requires `token_hash` and `type` parameters (`auth/confirm/route.ts:22-30`). Those appear only if the Supabase email template has been customised (not verifiable in the repo).
  - The reset email goes through Supabase SMTP, while activation emails use TracePoint's provider. That's two branding and deliverability paths.
  - A platform admin following a reset is redirected to `/platform` before the password form renders (`auth/setup/page.tsx:586-590`).
- **Fix:** Send resets through TracePoint's token flow (the same one used by `/activate`). Render the password form before the platform-admin redirect.
- **Benefit:** Reliable recovery. **Complexity:** M

### ADM-29: Admin UX gaps in the Users list and access-denied pages
- **Classification:** Verified usability problem · **Priority:** Low · **Module:** Settings / Unauthorized / Shell
- **Scenario:**
  - A 150-officer department has to scroll an unsorted card list to find one person.
  - An admin can't fix a typo in an officer's login email.
  - An officer clicks the patch icon and lands on "Your TracePoint role does not permit this page."
- **Evidence:**
  - The members list has no search, filter or sort (`settings/page.tsx:3080-3260`).
  - The email field is disabled with the hint "Authentication email changes are managed through Supabase Auth." (`:4896`). That hint names the vendor and offers no workflow.
  - The patch icon links to `/settings` for every user (`TracePointShell.tsx:~595`).
  - `unauthorized/page.tsx` doesn't name the required permission, the module or whom to contact.
  - The restricted-access state shows "Loaded permissions: N" (`settings/page.tsx:4551`).
- **Fix:**
  - Add search and filters (status, role, unit, activation).
  - Add an admin "change login email" action, audited.
  - Link the patch to Home or Account.
  - Make the unauthorized page explain what's missing and name the agency's administrators.
- **Benefit:** Faster day-to-day administration. **Complexity:** M

### ADM-30: Leftover backups, page copies, boilerplate and demo data
- **Classification:** Optional improvement · **Priority:** Low · **Module:** Repo hygiene
- **Scenario:** Developers and auditors can't tell which file is authoritative, and stale code risks being restored by mistake.
- **Evidence:**
  - 48 backup files, 35 of them `*.backup-*` under `src/`. Examples: `src/app/components/ArmoryWorkspaceNav.tsx.backup-20260714-203357`, `src/app/settings/page.tsx.bak`, and 12 copies of `src/app/settings/import-export/page.tsx.before-*`.
  - `.gitignore` ignores `*.backup-*` and `*.bak-*` but **not** `*.bak` or `*.before-*`.
  - There are 11 root-level `*.txt` page copies, from `current-user.txt` (which imports `./mock-data` with hard-coded roles) up to `range-days-page.txt` at 207 KB. `.dockerignore` excludes them from the image, but they still mislead.
  - `docs/AUTH_SETUP.md` is 0 bytes. `README.md` is the create-next-app boilerplate.
  - `public/` contains create-next-app assets (`next.svg`, `vercel.svg`, `globe.svg`, `file.svg`, `window.svg`).
  - Unused demo data remains: "Officer C. Reynolds", "Patrol Squad 3" (`lib/tracepoint/training-alerts.ts:156-185`).
  - The orphan `/settings/command-dashboard-analytics` page duplicates the "Dashboard Views" tab.
  - `docs/readington-pilot-checklist.md` still targets Vercel and Readington.
- **Fix:** Delete the backups and txt copies, extend `.gitignore`, and write a real README and AUTH_SETUP. Remove the orphan route and demo data.
- **Benefit:** A clearer codebase. **Complexity:** S

### ADM-31: Landing-site claims that the code doesn't back
- **Classification:** Verified usability problem · **Priority:** Medium · **Module:** Marketing (`tracepoint-landing/src/app/page.tsx`)
- **Scenario:** A prospective agency buys expecting unit-level readiness and supervisor views.
- **Evidence:**
  - "See current, due-soon, expired, and missing requirements by officer, **unit**, or department": the certifications page has 0 references to unit, and the dashboard and analytics have no unit filter. Unit appears only as an equipment requirement scope.
  - "Supervisors see exceptions that need follow-up": there is no supervisor scoping (ADM-15).
  - "One permission model, and one accountability trail": Fleet is not entitlement-gated (ADM-23), and the audit viewer is limited (ADM-12).
  - "Produce useful operational reports": reports are admin-only (ADM-09).
  - "Sign in" links to `https://tracepoint-amber.vercel.app/login`, while the app's auth targets `tracepointhq.com` (`lib/authentication/cognito-transport.ts:30`).
  - The integrations roadmap disclaimer is accurate.
- **Fix:** Implement unit and supervisor views, or soften the copy. Point Sign in at the production domain.
- **Benefit:** Marketing matches capability. **Complexity:** S for copy, L for features

### ADM-32: Raw database and provider errors are shown to users
- **Classification:** Confirmed defect · **Priority:** Low · **Module:** Admin APIs
- **Scenario:** A failed invite shows a Postgres or Supabase message to a lieutenant.
- **Evidence:**
  - `invite/route.ts` catch block: `NextResponse.json({ error: message }, { status: 500 })` where `message` is the raw `error.message`. The same pattern is in `activation/route.ts:166-172`, `agency-user-administrator/route.ts:97-103`, `platform/agencies/route.ts:184-190` and `super-admin/route.ts:131-133`.
  - By contrast, `accessFailureResponse` sanitises 5xx responses (`server-access.ts:~520`).
- **Fix:** Use a shared error mapper (user message plus correlation ID) and log the details server-side.
- **Benefit:** Clear messages and no internal detail leaked. **Complexity:** S

### ADM-33: Development conveniences left in the production request path
- **Classification:** Optional improvement · **Priority:** Low · **Module:** Proxy / Auth
- **Evidence:**
  - `src/proxy.ts` sends credentialed CORS headers to any `http://localhost:*` origin on all APIs ("local mobile preview").
  - `GET /auth/signout` performs a sign-out, which makes cross-site logout possible (`auth/signout/route.ts:33-41`). The idle guard uses this GET.
- **Fix:** Gate the localhost CORS behind a development-only environment flag. Make sign-out POST-only and switch the idle guard to a form POST.
- **Complexity:** S

### ADM-34: Officer self-service pages are hidden from the nav
- **Classification:** Potential gap requiring operational validation · **Priority:** Low · **Module:** Navigation
- **Scenario:** An officer wants to submit a personally owned rifle for approval and can't find it.
- **Evidence:**
  - The Armory group requires `manage_firearms|manage_inspections|view_command_dashboard` (`TracePointShell.tsx:98-104`). The proxy has no rule for `/firearms/personal-rifles`, and the page supports submission (`canSubmit`, `firearms/personal-rifles/page.tsx:98, 437`).
  - Home has no link to it.
  - `/notifications` is reachable only from Home.
- **Fix:** Add a "My Items" or "My Requests" nav group for officers (personal rifles, off-duty, my equipment, notifications).
- **Complexity:** S

### ADM-35: No transfer history (rank, unit or assignment)
- **Classification:** Verified usability problem · **Priority:** Medium · **Module:** Personnel
- **Scenario:** An auditor asks, "When did Sgt. Lee move from Patrol to Investigations?" The only source is a JSON diff inside a `membership_updated` audit row.
- **Evidence:** `update_department_member` overwrites the values and writes previous and new JSON to `audit_events` (`202606260003_settings_administration.sql:643-679`). There is no history table, effective date or personnel timeline UI.
- **Fix:** Add a personnel profile page with an assignment, rank and status timeline and effective dates.
- **Complexity:** M

### ADM-36: Admin and onboarding flows have no tests
- **Classification:** Optional improvement · **Priority:** Medium · **Module:** Tests
- **Evidence:**
  - 79 tests exist, all under `src/lib/**`. They run in CI via `scripts/run-application-tests.mjs` (`.github/workflows/aws-staging-runtime.yml:29`).
  - There are no tests for `api/settings/users/*`, `api/settings/onboarding/*`, `api/platform/*`, `auth/setup` or `/activate`.
  - The permission tests largely assert migration *text* with regexes (`granular-permissions.test.ts:38-41`).
  - There is no `test` script in the root `package.json`.
  - ADM-01, ADM-03 and ADM-04 would each be caught by a single integration test.
- **Fix:** Add route-level tests for invite, import, activation, deactivation and setup. Add `"test"` to `package.json`.
- **Complexity:** M

---

## 4. Cross-module consistency issues

- **Terminology:**
  - "Agency", "Department" and "tenant" are used interchangeably: Settings says "Agency Profile", the RPCs say "department", the setup page says "first secure tenant".
  - Five names for staff roles: "Super Admin" (nav), "Platform Admin" (Help), "TracePoint Platform Administrator" (support context rank), "Platform Support" (role label) and "PLATFORM ADMIN" (badge).
  - "Administrator" (a role) vs "Administer Department" (a permission) vs "Administration" (a nav group).
  - The Settings nav child is labelled "Settings" inside an "Administration" group, while the page header says "Department settings".
  - "Import / Export", "Import Wizard", "Classic Import Mapper", "AI-Assisted Importer" and "Multi-File Migration" all name overlapping tools.
- **Status vocabularies differ by module:**
  - Activation: `pending_activation`, `activation_sent`, `activated`.
  - Agency account: `pilot`, `onboarding`, `active`, `legacy`. The "legacy" value is synthesised in the UI (`platform/page.tsx:159-161`).
  - `onboarding_status`: `agency_created` and never anything else.
  - Membership: Active/Inactive.
  - Features: enabled/disabled, where a missing row means disabled in access checks but "previously enabled" in the event log.
- **"Pilot" leaking into production:**
  - API names `/api/pilot/personnel`, `/api/pilot/range-workspace`, `/api/pilot/performance-summary` and `/api/pilot/remediations` are used by the dashboard and reports.
  - Agency defaults are `pilot/pilot`, and the pilot-era Readington checklist is still in `docs/`.
- **Save patterns:**
  - Settings has a global header Save, while the Rules sub-panels have their own Save buttons.
  - Renames use `window.prompt`.
  - Members save through browser RPCs, while invites and role matrix changes go through server APIs.
  - There is no unsaved-changes warning anywhere in Settings.
- **Authorization patterns:**
  - Some admin APIs use `resolveServerAccess()` (Cognito-ready, support-mode-aware, sanitised errors). Others call `supabase.auth.getUser()` and `has_department_permission` RPCs directly (not support-aware, raw errors).
  - Examples: `invite`, `activation`, `password-reset`, `onboarding/*`, `platform/*`, `active-department`.
  - The proxy uses Supabase `getClaims`.
- **UI gate vs API vs RLS (sample):**
  - The Import UI requires `administer_department`; the classic personnel API accepts `manage_users` and platform admin; the AI importer API requires `administer_department`.
  - Report definitions grant `view_command_dashboard`, but the route is admin-only.
  - The Settings audit tab and API agree (`view_audit_log`). RLS has a select policy and no update or delete for authenticated users (good).
  - The Command Dashboard nav, proxy and layout agree on permission but disagree on the feature gate for super admins.
- **Date and time:**
  - There are 19 separate `formatDate`/`formatDateTime` helpers in `src/app`.
  - All use the browser timezone with an `en-US` locale, or `toLocaleDateString()` with no options.
  - The department timezone is never applied.
  - The activation page shows "valid through {Month D, YYYY}" with no time or zone.
- **Empty states and errors:**
  - Analytics and CommandOperationsPanel show load errors; the main Command Dashboard converts failures into "No requirements configured".
  - Empty-state wording varies ("No department memberships were returned.", "No immutable audit records are available yet.", "No shooters yet").
  - Error responses vary between sanitised (`TracePoint access could not be verified.`) and raw DB text.
- **CSV handling:**
  - Three CSV writers with different escaping: the import-export `csvEscape` (no formula guard), the Settings audit export (quote-all, no formula guard), and the AI importer `csvCell` (formula guard).
  - Two parsers: a naive line-split parser and SheetJS.
- **Feature gating:**
  - The nav bypasses features for super admins; layouts don't.
  - Analytics needs two features; the nav checks one.
  - Fleet and Agency Training have no separate entitlement, despite being sold as modules.
- **Help vs product:**
  - Help references "Forgot password", audit filters, Agency Training and Fleet as "Coming soon", "Brevo", and "Settings > My Notifications" for all roles. None of these match the code.
