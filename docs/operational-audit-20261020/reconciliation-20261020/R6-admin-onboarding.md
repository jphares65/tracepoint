# ADM reconciliation: Appendix E (admin, onboarding) against the latest branch

**Scope.** This is a read-only reconciliation of ADM-01 to ADM-36 from `docs/operational-audit-20261020/appendix-e-admin-onboarding.md`. That audit was written against origin/main @ a3677a6 (Oct 7).

**What I checked against.** The latest line is `origin/codex/staging-mobile-api-release-20261007` @ 555f061 (Oct 9). It is checked out at `/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/current`. All paths below are relative to that checkout unless I name another repo.

**Branch topology.**
- main is not an ancestor of 555f061. The merge-base is 6588576.
- main has 15 commits that 555f061 lacks. All are staging DB-lease and image-tag infra fixes (workflows, scripts, infra). None touches `src/`, `database/` or `supabase/`, so main is the same as or older than 555f061 for every ADM item.
- 555f061 has 404 commits that main lacks.
- The landing repo has a single line: `main` = `origin/main` = `claude/...` @ 32ad5d6.

**Runtime modes.** The code has two runtime modes:
- **bridge**: Supabase Auth and Supabase DB.
- **aws-native** (`TRACEPOINT_RUNTIME_PROVIDER_MODE=aws-native`): Cognito plus RDS, with `database/aws/*.sql` layered on the Supabase schema.

Staging runs aws-native, per the release workflow `-AuthenticationProvider cognito`. The latest production record I could find says the source authority is still Supabase and the cutover was in progress: `docs/production-cutover-execution-20260928-retry4.md:3-5`. The landing site still links to the Vercel bridge host. So bridge-only defects stay relevant until production cutover is confirmed, which needs runtime verification. Each row below notes both modes where they differ.

## Counts (36 findings)

| Classification | Count | IDs |
|---|---|---|
| Confirmed applicable defect | 19 | 01, 05, 06, 08, 09, 10, 12, 14, 17, 18, 20, 22, 23, 25, 26, 29, 30, 31, 34 |
| Partially resolved | 11 | 02, 03, 04, 13, 19, 21, 24, 27, 32, 33, 36 |
| Not applicable to the current architecture | 1 | 28 |
| Enhancement rather than defect | 4 | 11, 15, 16, 35 |
| Requires runtime verification | 1 | 07 |
| Already resolved | 0 | — |

New findings that the original audit did not have: NEW-ADM-A to NEW-ADM-G (section 3).

Fixed on another branch but not in the latest one:
- A wired `/api/super-admin` that uses `resolvePlatformAdminAccess` and the platform repository. It exists on `origin/codex/production-tls-20260919` and 9 other Sep 8–19 branches, none of which is an ancestor of 555f061. In the latest branch the route is unwired again (see ADM-22).
- I scanned every remote branch for other fixes and found none: no `email_confirm: false` in personnel import, no platform invite action, no Forgot-password link in `LoginForm`, no `previousEnabled` defaulting to false, and no use of `session_timeout_minutes`.

---

## 1. Reconciliation table

| ID | Title | New classification | Revised priority | Current evidence (555f061) | Note |
|---|---|---|---|---|---|
| ADM-01 | Bulk-imported personnel can't complete activation | **Confirmed applicable defect** (different mechanism under Cognito) | Critical (unchanged) | **Bridge:** `src/app/api/settings/onboarding/personnel/route.ts:204-211` `createUser({ email, email_confirm: true, … onboarding_status: "pending_activation" })`; `src/lib/tracepoint/activation.ts:327-333` `if (userData.user.email_confirmed_at \|\| onboardingStatus === "activated") throw "This account no longer requires activation."`. **Cognito:** import → `writeCognitoPersonnel` → `inviteCognitoUser` (`cognito-personnel-writer.ts:74-92`) → `AdminCreateUser` + `RESEND` (`cognito-invite.ts:40,68`), link committed as `'pending'` (`database/aws/006…sql:172-173`). The first-sign-in mapping only accepts `state='active'` (`src/lib/authentication/postgres-mapping.ts:5-8`; `postgres-sessions.ts:24`). Writer also calls the legacy `issueActivationEmail` (`cognito-personnel-writer.ts:57,124`), which throws in aws-native (`activation.ts:202`). | Bridge: original defect reproduced by test T2. Cognito: no email_confirm problem, but see NEW-ADM-A (pending identities can't sign in) and NEW-ADM-D (legacy-activation throw). Cognito temporary password is valid 1 day (`infra/lib/cognito-foundation-stack.ts:28`). Re-send via Send Activation works only from inside the agency context (NEW-ADM-F). |
| ADM-02 | No supported first-admin path for platform owner | **Partially resolved** | High → Medium | `016_platform_support_mode.sql:45-71`: `has_department_permission` is true in Support Mode. The invite route's AWS branch passes `supportMode:resolved.context.isSupportMode` (`src/app/api/settings/users/invite/route.ts` AWS branch). `prepare_cognito_invite` checks permission through that function (`010…sql:36-42`). `/platform/[departmentId]/page.tsx:85-94` still has only Activation and Administrator buttons. | Cognito path: Access Agency → Settings → Invite (Administrator role) now works but isn't documented. 014 only adds `list_platform_agencies`. There is still no one-step "Invite first administrator". The invited chief then hits NEW-ADM-A. Bridge unchanged. |
| ADM-03 | Separated user can self-create a department | **Partially resolved** (N/A in aws-native; unchanged in bridge) | High → Medium (bridge); Low (AWS defence in depth) | aws-native: `src/app/auth/setup/page.tsx:39,129,571` `if (…=== "aws-native") redirect("/login")`. `create_department_with_owner` is not in the settings RPC allow-list (`src/app/api/settings/data/route.ts:10`). Bridge: `src/lib/supabase/proxy.ts:266,285` still routes to `/auth/setup`, and `page.tsx:161-170` still calls the RPC. The schema still has `grant execute … create_department_with_owner … to authenticated` (`supabase/migrations/202606220001…sql:1984`), and the runtime role inherits `authenticated` (`database/aws/003…sql:32`). | Supabase-specific path. Under Cognito no UI or API path reaches the RPC, but the grant survives into RDS. Revoke it. |
| ADM-04 | Classic re-import strips roles and reactivates separated officers | **Partially resolved** | High (bridge) / Medium (Cognito) | Cognito: `attach_existing_cognito_personnel_import` adds `officer` with `on conflict do nothing` (`010…sql:112-114`), so roles are preserved. But a missing Active column still means true (`personnel/route.ts:31`). The writer then calls `setCognitoMembershipActive({active:true})` (`cognito-personnel-writer.ts:49-55`), which re-enables the Cognito user (`009…sql:50-51,80-82`). Blank badge, rank, unit and employee number overwrite with NULL (`010…sql:109-111`); `full_name` is overwritten (`:115`). Bridge: `personnel/route.ts:257-264` still `p_role_codes: ["officer"]`. | Role stripping is fixed only in aws-native. Reactivation now also re-enables Cognito login (test T3). |
| ADM-05 | No offboarding workflow on deactivation | **Confirmed applicable defect** | High | `settings/page.tsx:1891-1902` → `update_department_member` (`supabase/migrations/202606260003…sql:567-679`) only sets `is_active`/`deactivated_at`. It does not call `setCognitoMembershipActive`, which is used only by the import writer (grep). | No asset or assignment recovery. Cognito: per-request access re-checks active membership (`server-access-postgres.ts:102-103`), so data access stops. But the Cognito account stays enabled and sessions are not revoked, unlike the import path, which does `globalSignOut` + `disable` (`009…sql:36-49`). See NEW-ADM-E. |
| ADM-06 | Officers can't reach My Notifications | **Confirmed applicable defect** | High → Medium | `settings/page.tsx:857` (tab "My Notifications"); `src/lib/tracepoint/permissions.ts:95` `/settings` needs `manage_users\|view_audit_log\|administer_department`; `help-content.ts:155-171` `roles: allRoles, route: "/settings"`. | Unchanged. |
| ADM-07 | "Forgot password" documented but missing | **Requires runtime verification** (Cognito); defect unchanged in bridge | High → Medium | aws-native `LoginForm.tsx:92-101` shows only "Continue with secure sign-in" → Cognito managed login (`cognito-pkce.ts:35` `/oauth2/authorize`), pool `accountRecovery: EMAIL_ONLY` (`infra/lib/cognito-foundation-stack.ts:27`). Invited users are created without `email_verified` (`cognito-pending-user-core.ts:11-16`). Only Assign Password marks it verified (`cognito-password-lifecycle.ts:87`). Admin reset refuses unverified (`cognito-admin-core.ts:13`). Bridge `LoginForm.tsx:104-190` has no reset; `help-content.ts:91` unchanged. | Managed login supplies a "Forgot your password?" link, but recovery needs a verified email. Confirm on staging whether first login verifies the email. Help text still names a TracePoint link. |
| ADM-08 | Help Center stale | **Confirmed applicable defect** | Medium | `help-content.ts:426,685` `status: "Coming soon"` for Agency Training and Fleet; `:160,745` `"brevo"`; `:646` "…when available"; `:91` Forgot password. `activation.ts:97-98` still says "Brevo". | Unchanged. |
| ADM-09 | Report builder admin-only | **Confirmed applicable defect** | High → Medium | `permissions.ts:92` `/settings/import-export` → `administer_department`; `report-definitions.ts:12-18` grant `view_command_dashboard` etc.; `import-export/page.tsx:6640` "Branded Reports". | Unchanged. |
| ADM-10 | Dashboard hides load failures | **Confirmed applicable defect** | High | `command-dashboard/page.tsx:355-370` non-OK → `{ totalRequiredChecks: 0, … readinessPercent: 100 }`; `:1219,1247` "No requirements configured"; `loadError` only on throw (`:726`). | Unchanged. |
| ADM-11 | Shallow drill-downs, no export or print | **Enhancement rather than defect** | Medium → Low | `command-dashboard/page.tsx:865,884,939,952` hrefs to module roots. | Unchanged UX gap. |
| ADM-12 | Audit viewer thin; CSV export unaudited | **Confirmed applicable defect** | Medium | `settings/page.tsx:1204` `?limit=100`; `:2262` `?limit=5000`; `:4463` `actor?.full_name \|\| event.changed_by_user_id`; `/api/settings/audit-log/route.ts` has no `recordDataExport`; `/audit-log/export/route.ts:41` does. | 023 and 032 restore read grants only. |
| ADM-13 | Security policy stored but not enforced | **Partially resolved** (Cognito) | Medium → Low | Cognito pool `mfa: REQUIRED`, TOTP (`infra/lib/cognito-foundation-stack.ts:27`). Server-side 30-minute idle on refresh sessions (`002…sql:24`; `postgres-refresh-sessions.ts:56,90`). Access token 5 min, refresh 1 day (`infra…:39`). The department card still says "stored now… enforcement will be connected" (`settings/page.tsx:4350`); `session_timeout_minutes`, `require_mfa_policy` and `data_retention_days` are referenced only in `settings/page.tsx`; `IdleSessionGuard.tsx:21-22` is hard-coded. | Platform-wide MFA and idle timeout are enforced in aws-native. Department-level values are still decorative, and retention is not implemented. The export-logging toggle is still admin-controlled (`export-audit-server.ts:27`). Bridge: nothing enforced. |
| ADM-14 | Department timezone ignored | **Confirmed applicable defect** | Medium | New shared `src/lib/format/date.ts:14-28` uses `Intl.DateTimeFormat("en-US", …)` with no `timeZone`. `timeZone` appears only as `"UTC"` in 2 files. | Formatter consolidation started, but the timezone is still not applied. |
| ADM-15 | No supervisor or team scoping | **Enhancement rather than defect** | Medium | `grep supervisor_user_id\|supervisor_id\|reports_to` returns 0 hits in src, supabase and database. | Product decision. |
| ADM-16 | Fixed global roles | **Enhancement rather than defect** | Low | `server-access.ts:96-97,109` legacy aliases remain. | Landing copy claims "Agency-defined … roles" (ADM-31). |
| ADM-17 | Configuration Status always green | **Confirmed applicable defect** | Medium | `settings/page.tsx:2729` `ready: members.length > 0`; `:2737` `ready: Boolean(rules.inspection_interval_days)`. | Unchanged. |
| ADM-18 | Unit or rank rename doesn't propagate | **Confirmed applicable defect** | Medium | `settings/page.tsx:1803` `window.prompt`; `:1818` `.update({ name })` only. | Unchanged. |
| ADM-19 | Invite fails at scale; re-invite overwrites | **Partially resolved** (Cognito) | Medium | Cognito: no `listUsers` scan. `prepare_cognito_invite` raises `23505 'explicit existing identity selection required'` when the email exists (`010…sql:43-45`), so there is no overwrite or reactivation. Bridge: `invite/route.ts:56` `page <= 20` and the upsert `is_active: true, deactivated_at: null` (`:237-251`) are unchanged. | New Cognito gap: inviting a person who already belongs to another agency now fails with a raw 500 (`invite/route.ts` final catch). The only attach path is the personnel import. |
| ADM-20 | Member save = 3 non-atomic RPCs | **Confirmed applicable defect** | Low | `settings/page.tsx:1891-1925` three sequential `dataClient.rpc` calls (via `/api/settings/data`). | Unchanged. |
| ADM-21 | Support mode inconsistent; exit not audited | **Partially resolved** | Medium | `016…sql:21-71` makes `is_department_member`/`has_department_permission` support-aware, so invite, edit and password ops now work in Support Mode on AWS. Entry is audited (`support-mode/route.ts:119`). Still: no reason or ticket captured, the cookie lasts 8 hours (`:121`), Cognito logout only clears the cookie (`cognito-transport.ts:149`) with no `support_mode_exited`, and entry lands on `/firearms` (`AccessAgencyButton.tsx:34`). | Bridge invite/member RPCs are still membership-only. |
| ADM-22 | Platform console fragmented and partly dead | **Confirmed applicable defect** (worse in AWS) | Medium → **High** | `/api/super-admin` PATCH upserts `department_features` through the tenant-scoped client (`super-admin/route.ts:169-189`). `authenticated` has only `SELECT` on that table (`supabase/migrations/202609050003…sql:40`; `database/aws/004…sql:68-70`). 015's `set_platform_entitlement` is defined in `src/lib/platform/admin-access.ts:156-159` but never called. Both default the previous value to true: `super-admin/route.ts:169` `?? true`; `015…sql:57` `coalesce(v_previous, true)`. `platform_agency_accounts` is never updated. Make Administrator replaces the role set with `["officer","administrator"]` (`admin-access.ts:134`). | On AWS, toggling modules from `/super-admin` should fail (needs runtime confirmation; see NEW-ADM-C). A new agency then can't get modules. A wired route exists on `production-tls-20260919` and others but not in latest. The first-enable event is still not logged on any branch. |
| ADM-23 | Feature-gate inconsistency | **Confirmed applicable defect** | Medium | `TracePointShell.tsx:83` nav checks `analytics` only; `analytics/layout.tsx` also requires `range_training` → `redirect("/")`; `TracePointShell.tsx:274-276,303-305` super-admin bypass. Feature catalog (`202609050003…sql:42-45`) has no fleet, agency_training or inventory. | The new Inventory module (`TracePointShell.tsx:200-202`, `permissions.ts:91`) also has no entitlement. 015 does not change gating. |
| ADM-24 | Three importers, contradictory guidance | **Partially resolved** | Medium | Cognito: email changes are blocked (`cognito-personnel-writer.ts:96-98`; `010…sql:143-145`) and roles are preserved. Still present: `settings/page.tsx:2506` "Open Import Wizard ?" and `:2551-2553` "preview and validation" text; deterministic-mode default (`ai-importer/configuration.ts:2`). | The divergence is narrower on AWS. Guidance is unchanged. |
| ADM-25 | CSV parser breaks on multi-line cells; formula injection | **Confirmed applicable defect** | Medium | `import-export/page.tsx:575-581` dead `splitCsvLine` returns `[]`; `:585` `normalized.split("\n")`; `:1241-1254` `csvEscape` has no `= + - @` guard. | Unchanged. |
| ADM-26 | Badge required for personnel import | **Confirmed applicable defect** | Low | `personnel/route.ts:85` `if (!departmentId \|\| … \|\| !badgeNumber)`, ahead of both provider branches. | Unchanged. |
| ADM-27 | Admin-assigned passwords permanent and known | **Partially resolved** | Medium → Low | Cognito: `AdminSetUserPassword … Permanent:true` (`cognito-admin.ts:48`), complexity enforced (`password-policy.ts:9-15`), `globalSignOut` (`cognito-password-lifecycle.ts:88`). Pool MFA REQUIRED. | MFA mitigates for already-enrolled users. For a pending identity the admin can sign in first and enrol their own TOTP. There is still no forced-change flag. App minimum is 10 characters versus the pool's 14 (NEW-ADM-B). |
| ADM-28 | Admin reset depends on Supabase email template | **Not applicable to the current architecture** (Cognito); unchanged in bridge | Medium → Low | AWS: `beginCognitoPasswordReset` → `AdminResetUserPassword` (`cognito-password-lifecycle.ts:97-113`; `cognito-admin.ts:50`). Cognito sends the code and there is no `/auth/confirm` template dependency. Bridge `password-reset/route.ts` (non-AWS branch) unchanged. | Supabase-specific. The Cognito reset requires `CONFIRMED` + `email_verified` (`cognito-admin-core.ts:12-13`), which links to ADM-07 and NEW-ADM-A. |
| ADM-29 | Users list and access-denied UX | **Confirmed applicable defect** | Low | No member search (grep "search" in `settings/page.tsx`: 0); `TracePointShell.tsx:595` patch → `/settings`; `settings/page.tsx:4549` "Loaded permissions"; `unauthorized/page.tsx` names no permission or contact. | The vendor-name hint was neutralised (`settings/page.tsx:4894`). |
| ADM-30 | Leftover backups and boilerplate | **Confirmed applicable defect** | Low | `git ls-tree 555f061`: 48 `*.backup-*/*.bak/*.before-*` and 11 root `*.txt` are **tracked**. `.gitignore:47-53` lacks `*.bak` and `*.before-*`. `docs/AUTH_SETUP.md` is 0 bytes; README is boilerplate. | Worse than the audit thought: the files are committed. |
| ADM-31 | Landing claims not backed | **Confirmed applicable defect** | Medium | `tracepoint-landing@origin/main:src/app/page.tsx:62` "by officer, unit…"; `:217` "Supervisors see exceptions…" / "Agency-defined … roles"; `:199` "one permission model"; `:156,233` Sign-in → `tracepoint-amber.vercel.app`. | The landing repo has only branch 32ad5d6. |
| ADM-32 | Raw DB and provider errors shown | **Partially resolved** | Low | Sanitised: `platform/agencies/route.ts:94-101`, `settings/data/route.ts:18-24`. Still raw: `invite/route.ts` final catch, `activation/route.ts:205-210`, `personnel/route.ts:302-307`, `super-admin/route.ts:54,132,146,163`, `agency-user-administrator/route.ts:38-40`. | On AWS, pg exception text (e.g. "explicit existing identity selection required") reaches the UI. |
| ADM-33 | Dev conveniences in production path | **Partially resolved** | Low | Cognito: `GET /auth/signout` is POST-only (`auth/signout/route.ts:38-42`); idle guard submits a POST form (`idle-session-core.ts:7-13`). Still: unconditional credentialed localhost CORS (`src/proxy.ts:7-14,25-29`). Bridge GET signout unchanged (`:43-49`). | — |
| ADM-34 | Officer self-service pages hidden | **Confirmed applicable defect** | Low | `TracePointShell.tsx:86-104` Armory group requires `manage_firearms\|manage_inspections\|view_command_dashboard`; personal rifles is under it (`:107-108`). | Unchanged. |
| ADM-35 | No transfer history | **Enhancement rather than defect** | Medium → Low | `202606260003…sql:670` `membership_updated` JSON diff is the only record. | Unchanged. |
| ADM-36 | Admin and onboarding flows untested | **Partially resolved** | Medium | 139 `src/**/*.test.ts(x)`, 98 `scripts/*.test.mjs`. Lifecycle cores are tested (`cognito-membership-lifecycle-core.test.ts`, `cognito-invite-retry-core.test.ts`, `cognito-existing-user-migration-core.test.ts`). No route tests for invite, import, activation, platform or setup. No `"test"` script (`package.json:5-15`). `src/lib/tracepoint/mobile-session-route.test.mjs` and `mobile-support-workflow.test.mjs` match neither runner (`scripts/run-application-tests.mjs:4` regex `\.test\.tsx?$`). | CI runs tests only on release dispatch or pushes of `.github/staging-release.json` (`.github/workflows/aws-staging-runtime.yml:2-6`). There is no `pull_request` trigger for app code. A single route test would have caught NEW-ADM-A, C and D. |

---

## 2. Priority deep-dives

### ADM-01: How imported users are created now, and whether activation rejects them

**Bridge (Supabase).** Unchanged.
- Both the classic import (`personnel/route.ts:204-211`) and the AI importer's Supabase writer create users with `email_confirm: true`.
- `validateActivationToken` rejects confirmed accounts (`activation.ts:327-333`).
- Reproduced in isolation by test T2: imported is rejected, invited passes.

**aws-native (Cognito).** Users are created through `inviteCognitoUser`. Step by step:
1. `prepare_cognito_invite` inserts the profile, membership (`pending_activation`) and roles.
2. `AdminCreateUser` runs with `MessageAction:"SUPPRESS"` (`cognito-pending-user-core.ts:12-16`).
3. `commit_cognito_invite` writes the identity link with **state `'pending'`** (`006…sql:172-173`).
4. `AdminCreateUser … MessageAction:"RESEND"` sends Cognito's temporary-password email (`cognito-admin.ts:44`). The temporary password is valid 1 day (`infra/lib/cognito-foundation-stack.ts:28`).

The legacy `/activate` token flow is disabled in aws-native (`activation.ts:202,268,351`; `activate/page.tsx` server action `redirect("/login")`).

So the original email_confirm mismatch does **not** apply. Two different defects replace it:

- **NEW-ADM-A (Critical, needs a staging confirmation).**
  - The ordinary Cognito callback maps a subject only to `state='active'` links. See `postgres-mapping.ts:5-8` (`PostgresIdentityMappingStore.findActive`) and `postgres-sessions.ts:24` (`registerVerified` … `state='active' for update`).
  - The runtime selects the rehearsal promoter only when the host is `shadow-rehearsal`, the pool is `us-east-1_wZwXHpznS` and the subjects are two hard-coded ones (`cognito-runtime-transport.ts:24-29`; `postgres-mapping.ts:15-31`).
  - In all of `database/aws` the only statements that set a link to `'active'` are `006…sql:119` (legacy `finalize_cognito_activation`, unreachable in aws-native) and `006…sql:272` (`assign_password`).
  - Result: every invited or imported user (and every user migrated by 013/021, which also write `'pending'`) completes Cognito's NEW_PASSWORD and TOTP steps, then is rejected at `/api/auth/cognito/callback` with "Cognito session establishment failed".
  - The only workaround is an admin **Assign Password**, which promotes the link, marks the email verified and sets a permanent admin-known password.
  - `activation_status` stays `activation_sent` and the Settings and Platform "Send Activation" button stays visible.
  - The existence of the Sep 25–26 rehearsal-only promoters (`database/rehearsal/001…,002…`; commits 8a7c1b7, 5dcedfe) is strong evidence that no generic promotion exists.
  - Verified in isolation by tests T7 and T8.

- **NEW-ADM-D (High).**
  - `cognito-personnel-writer.ts:57` covers an existing identity that is pending and active.
  - `cognito-personnel-writer.ts:124` covers a reactivated update with a pending identity.
  - Both call the legacy `issueActivationEmail`, which throws `"Legacy activation is unavailable in AWS-native mode."` (`activation.ts:202`; test T1).
  - This runs after `setCognitoMembershipActive` has committed. The row is left re-enabled, the import returns a raw 500 (`personnel/route.ts:302-307`), and no invitation is sent. It should call `resendPendingCognitoActivation`.

### ADM-02: Platform first-admin invite (014/015 control plane)

- 014 adds only `list_platform_agencies()` (platform-admin gated, `session_user='tracepoint_runtime'`).
- 015 adds `get_platform_entitlements()` and `set_platform_entitlement()`.
- Neither provides an invite or first-admin action.

The working path on AWS, which is undocumented:
1. `/platform/[id]` → **Access Agency**. This sets `tracepoint_support_department_id` and is audited (`support-mode/route.ts:119-121`).
2. Settings → Users & Roles → Invite with the Administrator role. The route passes `supportMode`. `prepare_cognito_invite`'s `has_department_permission(…,'administer_department')` is true through `tracepoint_auth.is_platform_supporting` (`016…sql:3-19,45-51`).

Remaining gaps:
- There is no one-step action on `/platform/[id]`.
- **NEW-ADM-F (Medium):** the Platform page's **Send Activation** posts to `/api/settings/users/activation` (`ActivationButton.tsx:34`). In aws-native that route requires `access.context.departmentId === departmentId` (`activation/route.ts:35-38`). A platform admin who is not in Support Mode for that agency gets 403 or 409.
- The invited chief then hits NEW-ADM-A.
- **Make Administrator** works through `set_department_member_roles`' `or public.is_platform_admin()` branch (`202609060003…sql:17`). It replaces any other roles with `officer` + `administrator` (`admin-access.ts:134`).

### ADM-03: `create_department_with_owner` under AWS-native auth

- **Unreachable in aws-native.** The setup page, both server actions and the view redirect to `/login` first (`auth/setup/page.tsx:39,129,571`). `/api/settings/data` allows only `update_department_member`, `set_department_member_roles` and `set_department_group_members` (`data/route.ts:10`). No other dynamic RPC call exists (grep `.rpc(<variable>`).
- **A user with zero active memberships** under Cognito gets `403 "No active department membership was found."` (`server-access-postgres.ts:102-103`) and is not offered tenant creation. The proxy sends only platform admins to `/platform` (`post-auth-routing-core.ts:1-6`; test T6).
- **Defence-in-depth gap.** The function is still `security definer`, granted to `authenticated` (`202606220001…sql:1984`), and 004 rewrote it to use `tracepoint_auth.subject_id()` (`004…sql:15-30`). `tracepoint_runtime` is a member of `authenticated` (`003…sql:32`). Any future generic RPC passthrough would re-open it. Recommend `revoke execute … from authenticated` in `database/aws`.
- **Bridge:** fully unchanged.

### ADM-05 and ADM-13: MFA and session timeout under Cognito

**MFA.**
- Enforced pool-wide: `mfa: cognito.Mfa.REQUIRED, mfaSecondFactor:{otp:true,sms:false}` (`infra/lib/cognito-foundation-stack.ts:27`). The rehearsal pool uses `enforceTotp`.
- The department toggle `require_mfa_policy` remains cosmetic (`settings/page.tsx:4350-4364`). It can't relax or tighten anything.

**Session timeout.**
- **Server-side:** `002_cognito_application_session_idle.sql` adds `idle_expires_at` with a check `≤ last_seen_at + 30 minutes`. The refresh store sets and extends it by 30 minutes (`postgres-refresh-sessions.ts:56,90`) and refuses expired rows (`:92`).
- **Token lifetimes:** access and ID tokens 5 minutes, refresh 1 day absolute, token revocation enabled (`infra…:38-40`).
- **Client:** `IdleSessionGuard.tsx:21-22` hard-codes 25 and 30 minutes and now POSTs `/auth/signout` (`idle-session-core.ts:7-13`).
- **Result:** a fixed 30-minute server idle and a 24-hour absolute session are enforced. `session_timeout_minutes` from Settings is ignored. An agency that sets 15 minutes gets 30.

**Deactivation (ADM-05).**
- Settings → Edit Access → Active=false runs `update_department_member` through `/api/settings/data`. It does **not** call the Cognito membership lifecycle.
- As a result the Cognito user is not disabled, `globalSignOut` is not called, and no rows are written to `authentication_session_revocations` or `authentication_refresh_sessions`. Compare the import path, `009…sql:36-49`.
- Authorisation is re-resolved per request, so tenant data access ends immediately. But the identity remains usable, which matters for multi-agency members and for audit expectations ("disable login").
- This is **NEW-ADM-E (Medium)**. Asset and assignment recovery is still absent.

### ADM-07: Forgot password under Cognito

- The TracePoint login page in aws-native has a single "Continue with secure sign-in" button (`LoginForm.tsx:92-101`) that goes to Cognito managed login (`cognito-pkce.ts:35`). The pool has `accountRecovery: EMAIL_ONLY`, so managed login renders "Forgot your password?".
- The UI gap is effectively closed, but there are two runtime caveats:
  1. Invited and imported users are created without `email_verified=true` (`cognito-pending-user-core.ts:16`). Cognito can't send a recovery code to an unverified address. Whether managed login verifies the email during the first NEW_PASSWORD step must be checked on staging. TracePoint's own admin reset refuses non-verified users (`cognito-admin-core.ts:13`), and only Assign Password calls `markEmailVerified` (`cognito-password-lifecycle.ts:87`).
  2. Help text `help-content.ts:84-98` still describes a TracePoint "Forgot password" link. It should describe the Cognito screen and say that MFA is still required after a reset.
- Bridge: no Forgot-password path at all. The defect is unchanged.

### Entitlements (015) vs ADM-22 and ADM-23

- 015 introduces `get_platform_entitlements()` and `set_platform_entitlement()`. Both are platform-admin only, security definer and runtime-session bound.
- `PostgresPlatformAdminRepository.listEntitlements` and `setEntitlement` wrap them (`admin-access.ts:141-163`), but **no route calls them**.
- `/api/super-admin` still uses `resolveServerAccess()` and `createPlatformReadRepository(admin,true)` for GET. For PATCH it does a direct `.upsert` on `department_features` (`super-admin/route.ts:53,169-189`).
- In RDS, `authenticated` has only SELECT on `department_features` (`202609050003…sql:40`, unchanged by `database/aws`). RLS on it is member-only (`:34`).

That leads to **NEW-ADM-C (High; needs runtime confirmation)**:
- **(a)** In aws-native, PATCH fails with permission denied → raw 500. Module enablement for a new agency is therefore impossible from the UI.
- **(b)** GET shows only the agencies where the platform admin is a member or in Support Mode.
- **(c)** Both the route (`:169 ?? true`) and the SQL (`015:57 coalesce(v_previous, true)`) still skip the first-enable event (original ADM-22 defect).

On history: a wired route (`resolvePlatformAdminAccess` → `repository.setEntitlement`) exists on `origin/codex/production-tls-20260919` and 9 sibling Sep 8–19 branches, all non-ancestors of 555f061. The fix was lost, and still has the `coalesce(…, true)` bug there.

ADM-23 is unaffected by 015. Analytics still double-gates, the nav super-admin bypass remains, and Fleet, Agency Training and Inventory have no catalog codes.

### Tenant isolation: which tests exist and whether CI runs them

| Test | What it covers | Run in CI? |
|---|---|---|
| `src/lib/tracepoint/tenant-context.test.ts` (6 tests: admin, platform-with-context, platform-without-context denied, ordinary denied, cross-tenant denied, patch upload) | Pure TS authorization helpers | **Yes**, via `node scripts/run-application-tests.mjs` (`aws-staging-runtime.yml:29`). That workflow triggers only on `workflow_dispatch` or a push touching `.github/staging-release.json` on two branches (`:2-6`). There is no PR trigger. The `aws-staging-foundation.yml` PR trigger covers only `infra/**`. |
| `scripts/rehearsal-tenant-negative-contract.test.mjs` | **Regex over the source text** of `src/app/api/internal/rehearsal-tenant-negative/route.ts` | Yes (`scripts/*.test.mjs`, same trigger). It proves the guard strings exist, not isolation. |
| `src/app/api/internal/rehearsal-tenant-negative/route.ts` + `src/app/rehearsal-tenant-negative/route.ts` | Live read-only cross-tenant probe (fleet, firearm, equipment, settings, object) with two synthetic officers | **No.** Runtime only, pinned to `shadow-rehearsal.tracepointhq.com` / pool `us-east-1_wZwXHpznS`. |
| `scripts/phase3c-fixed-tenant-negative.cjs` | Live `set local role authenticated` probes against a fixed rehearsal RDS host | **No.** One-off ECS task. |
| `scripts/validate-local-tenant-isolation.sql` | RLS on range workspace, features, etc., using `request.jwt.claim.sub` (Supabase claims) | **No.** Only `npm run db:validate-bootstrap` and the manual CodeBuild `buildspec.postgres-rehearsal.yml` / `run-aws-postgres-rehearsal.mjs:48,58`. It applies `supabase/migrations` only, **not** `database/aws`, so it never exercises the `tracepoint.subject_id`, `tracepoint.department_id` or `support_department_id` model that production AWS uses. |

**Gap.** No automated test applies `database/aws/*.sql` and asserts cross-tenant denial or Support Mode scoping. That includes `is_platform_supporting`, which grants **every** permission in the supported agency.

---

## 3. New findings (not in the original audit)

| ID | Title | Priority | Evidence |
|---|---|---|---|
| NEW-ADM-A | Pending Cognito identities (all invites, imports and migrations) can't complete first sign-in. Only admin Assign Password promotes them. | Critical (confirm on staging) | `postgres-mapping.ts:5-8`, `postgres-sessions.ts:24`, `cognito-runtime-transport.ts:24-29`, `006…sql:172-173` (writes pending), promotions only at `006…sql:119,272`; tests T7, T8 |
| NEW-ADM-B | App Cognito password policy is min 10; the pool requires min 14. Assign Password accepts values Cognito rejects. | Medium | `src/lib/authentication/password-policy.ts:1,17-18` vs `infra/lib/cognito-foundation-stack.ts:28` (and `phase3c-rehearsal-app-stack.ts:126`); test T4 |
| NEW-ADM-C | `/super-admin` entitlement writes are unwired from 015 and denied by grants in aws-native; the read is tenant-scoped. | High (confirm on staging) | `super-admin/route.ts:11-21,53,169-189`; `202609050003…sql:34,40`; `admin-access.ts:156-159` unused |
| NEW-ADM-D | Cognito personnel writer calls the legacy `issueActivationEmail`, which throws in aws-native after membership re-enable. | High | `cognito-personnel-writer.ts:57,124`; `activation.ts:202`; test T1 |
| NEW-ADM-E | Settings deactivation doesn't disable Cognito or revoke sessions; the import path does. | Medium | `settings/page.tsx:1891-1902`; `data/route.ts:10,36`; `009…sql:36-49` |
| NEW-ADM-F | Platform "Send Activation" fails in aws-native unless the admin is in Support Mode for that agency. | Medium | `platform/[departmentId]/ActivationButton.tsx:34`; `activation/route.ts:35-38` |
| NEW-ADM-G | The tenant-isolation SQL test doesn't apply `database/aws`. CI has no PR trigger for app tests. Two `src/**/*.test.mjs` files are never run. | Medium | `run-aws-postgres-rehearsal.mjs:48,58`; `validate-clean-bootstrap.mjs:163`; `aws-staging-runtime.yml:2-6`; `run-application-tests.mjs:4` |

Minor items:
- `resendPendingCognitoActivation` uses `getCognitoMigrationDirectory()` (target configuration) while invite uses `getCognitoAdminDirectory()` (runtime configuration) (`cognito-activation-resend.ts:30` vs `cognito-invite.ts:17`). Verify they resolve to the same pool in staging.
- `setCognitoMembershipActive({active:true})` on an already-active membership still writes a `department_membership_reactivated` audit event (`009…sql:80-93`).

---

## 4. Isolated tests: reproduction, expected, actual

**Harness.** Location: `/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/recon/work-admin/app/`.
- `src` is a symlink to `scratchpad/current/src`.
- `node_modules` holds symlinks into `scratchpad/runtime/work/node_modules`, plus a local empty `server-only` stub so server modules can be imported outside Next.
- `tsconfig.json` is a copy, used for the `@/*` alias.
- No network or database is used, and nothing is written to the repo or worktree.

Reproduce with:
```
cd /tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/recon/work-admin/app
node --preserve-symlinks --import tsx --test adm.test.ts
node --preserve-symlinks --experimental-test-module-mocks --import tsx --test adm01-bridge.test.ts
```
Node v22.22.0. Full output: `/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/recon/work-admin/test-output.txt`. Result: **13/13 pass**. Each pass confirms the defect or behaviour as stated.

| # | Test | Expected (if the defect exists) | Actual |
|---|---|---|---|
| T1 | `issueActivationEmail` and `validateActivationToken` with `TRACEPOINT_RUNTIME_PROVIDER_MODE=aws-native`; static check that the writer calls it at lines 57 and 124 | Rejects with "Legacy activation is unavailable in AWS-native mode."; malformed token → "This activation link is invalid." | ok: rejects exactly so; call sites at [57,124] |
| T2 | `adm01-bridge.test.ts`: real `validateActivationToken` with only `@/lib/supabase/admin` mocked (node `mock.module`); auth user `email_confirmed_at` set (= `email_confirm:true` import) vs null (= invite) | Imported → "This account no longer requires activation."; invited → passes | ok / ok (ADM-01 bridge reproduced) |
| T3 | `applyCognitoMembershipLifecycle` with fake store and directory, active:true then false; static check that a missing Active column maps to true and the writer enables | enable → `["enable:sub-123","finish:true"]`; disable → `["signout","disable","finish"]` | ok: re-import re-enables Cognito login (ADM-04 Cognito) |
| T4 | `isCognitoCompliantPassword("Abcdefg1!x")` vs pool `minLength` parsed from infra | true vs pool 14 | ok: app accepts a 10-character password the pool rejects (NEW-ADM-B) |
| T5 | `withPostgresAuthorization` with a fake pool: support vs normal, invalid UUIDs; `withPostgresSubjectAuthorization` | `support_department_id` set only when `supportMode===true`; invalid ids rejected before connect; platform context never sets `department_id` | ok (3 tests) |
| T6 | `shouldRouteToPlatformConsole` | Only a platform admin with no active membership goes to `/platform` | ok (ADM-03: no setup offer on AWS) |
| T7 | `PostgresIdentityMappingStore.findActive` / `RehearsalInitialIdentityMappingStore` against an evaluator that honours the SQL `state=` literal; production issuer, `'pending'` link | `null` for pending (both stores); mapped once `'active'` | ok: pending invitee is unmapped (NEW-ADM-A) |
| T8 | Static scan of `database/aws/006,009,010,013,021,025,026,027` for `authentication_identity_links set state='active'` | Only `006:119` (legacy finalize) and `006:272` (assign_password); invite commit inserts `'pending'` | ok |

**Not executed.**
- **SQL behaviour of `015 set_platform_entitlement` and the `department_features` grants.** A local Postgres 16 exists but is stopped. Starting it would need writes outside the allowed scratch directories: initdb refuses root, and `/tmp/claude-0` is mode 700 so the `nobody` user can't reach the scratch directory. These conclusions rest on static reading of `015…sql:55-57` and `202609050003…sql:34,40`.
- **NEW-ADM-A, NEW-ADM-C and ADM-07** need a staging Cognito run to confirm end to end: invite → first login → callback, PATCH `/super-admin`, and managed-login recovery for an unverified email.
