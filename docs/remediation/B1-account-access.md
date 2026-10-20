# Remediation batch B1 — account access

Base: `claude/fix-b0-proof-foundation` (stacked on `codex/staging-mobile-api-release-20261007` @ `555f061`). Findings and evidence come from `docs/operational-audit-20261020/reconciliation-20261020/` (R6 admin/onboarding, R7 T5 and T9).

All changes apply to AWS-native (Cognito) mode only. Bridge (Supabase) behaviour is unchanged: every new branch is gated on `TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native"` or lives in Cognito-only modules and `database/aws`.

## Defects addressed

| ID | Defect | Status | Change |
|---|---|---|---|
| NEW-ADM-A (Critical) | Invites, imports and migrations write a `'pending'` Cognito identity link. Sign-in maps only `'active'` links, and nothing generic promoted them. Every invited user was rejected at `/api/auth/cognito/callback` after completing Cognito's password and MFA steps; only admin Assign Password worked around it. | **Fixed** | New `tracepoint_auth.activate_cognito_identity_on_first_login(issuer, subject, user)` in `database/aws/039`. It is executable only by `tracepoint_runtime` (not `authenticated`) and refuses any other session user. It activates the link only when the link for that issuer and subject is still `pending`, belongs to that user, and the user has at least one active membership. Otherwise it returns null and changes nothing. It marks pending memberships `activated` and writes one `activated` identity event plus an `account_activated` audit row per activated membership. `PostgresCognitoSessionStore.registerVerified` calls it only when the store is built for the initial PKCE callback (new third constructor flag). It calls it after ID-token signature, client, nonce and access-token verification, inside the access-session transaction, so a later failure rolls the activation back. `FirstLoginIdentityMappingStore` lets that callback see a pending link. Refresh rotation, bearer validation and mobile keep the active-only store. The legacy `finalize_cognito_activation` was not used: it needs a Supabase-era activation token that aws-native never issues. |
| NEW-ADM-D (High) | The Cognito personnel writer called the Supabase `issueActivationEmail`, which throws in aws-native, after the membership had already been re-enabled. | **Fixed** | Both call sites now call `resendPendingCognitoActivation`. That is the Cognito temporary-password re-send the Send Activation route already uses, and it is tenant-authorized in the database (`025`). The bridge writer is untouched. |
| NEW-ADM-E (Medium) | Settings → Edit Access → Active=false only flipped `is_active`. The Cognito user stayed enabled and no session was revoked. | **Fixed** | In aws-native (normal notification mode), `/api/settings/data` handles an `update_department_member` that changes `is_active` for a user with a pending or active Cognito link through `setCognitoMembershipActive`. That is the lifecycle the import path uses. `update_department_member` (with its guards: no self-deactivation, only Administrators may change Administrators, keep one active Administrator) now runs **inside the lifecycle's preparation transaction**, so a guard failure rolls back the preparation and nothing is sent to Cognito. Deactivation then does the global sign-out and disable (when no other agency membership is active) and revokes access and refresh sessions. Reactivation re-enables the Cognito user. Saves that do not change `is_active`, users without a Cognito link, shadow environments and bridge mode keep the previous plain RPC. `setCognitoMembershipActive` gained an optional Support Mode flag and the in-transaction hook; the import path's behaviour is unchanged. |
| NEW-ADM-E prerequisite (found in this batch, Critical for E and import) | `database/aws/009`'s `prepare_cognito_membership_operation` declares an OUT column `user_id` and uses `user_id` unqualified, so **every call raised 42702 "column reference user_id is ambiguous"**. The import's re-enable and deactivate path has never worked on the AWS schema. | **Fixed** | `039` re-creates the function with an identical body plus `#variable_conflict use_column` (the body never reads its OUT parameters as variables). Grants are restated identically. |
| Send Activation lookup (found in this batch, High) | In aws-native, `/api/settings/users/activation` read `authentication_identity_links` through the request-role data client. `authenticated` has no privilege on that table, so the route always failed with "Activation account lookup failed." (500), from Settings and from Platform alike. | **Fixed** | The identity state is read from the runtime pool **after** the tenant-scoped membership lookup has confirmed that the target belongs to the actor's active agency. Re-send and migration keep their own database authorization. |
| NEW-ADM-F (Medium) | Platform "Send Activation" only works while the platform admin is in Support Mode for that agency. | **Not fixed (owner decision)** | Making it work outside Support Mode means either running the agency-scoped resend with a synthesized Support-Mode database context, which bypasses the audited Support Mode entry (`support-mode/route.ts`), or adding a new platform-scoped resend function with its own audit trail. Both change the permission model, so neither is a minimal defect fix. With the lookup fix above, the button **does** work once the admin has used Access Agency (Support Mode) for that agency. Recommendation: either show "Access Agency first" on the Platform page, or add a platform-scoped resend in a later batch. |
| NEW-ADM-B (Medium) | The app accepts passwords of 10 or more characters. The staging pool (`infra/lib/cognito-foundation-stack.ts`) and the rehearsal pool require 14. Production was patched to 10 by changeset `production-cognito-password-20260929`. Assign Password with 10–13 characters on a 14-character pool failed as a generic 500. | **Partially fixed (owner decision on the number)** | Assign Password now returns 400 with a clear message ("rejected … under its own password policy … The password was not changed") when Cognito returns `InvalidPasswordException`. The app minimum and the infra were **not** changed. See Owner decisions. |
| ADM-03 (Low, defence in depth) | `create_department_with_owner` was executable by `authenticated` (and therefore by `tracepoint_runtime`) on the AWS schema. Any membership-less subject could create a department and become its Administrator (R7 T5). | **Fixed** | `039` revokes EXECUTE from `public`, `anon` and `authenticated`, guarded by `to_regprocedure`. Before the revoke I checked that no aws-native caller exists: the only caller is the Supabase setup page (`auth/setup/page.tsx`, which redirects to `/login` in aws-native), and the RPC is not in the `/api/settings/data` allow-list. The bridge Supabase project is unaffected (`database/aws` is not applied there). |
| ADM-01 (Supabase `email_confirm`) | Out of scope (bridge only). | Not changed | — |

## Files

- `database/aws/039_account_access_remediation.sql`: the first-login activation function, the corrected `prepare_cognito_membership_operation`, and the ADM-03 revoke. Idempotent (`create or replace`, re-runnable revoke and grant), wrapped in `begin; … commit;`.
- `src/lib/authentication/postgres-mapping.ts`, `postgres-sessions.ts`, `cognito-runtime-transport.ts`: NEW-ADM-A.
- `src/lib/ai-importer/server/cognito-personnel-writer.ts`: NEW-ADM-D.
- `src/app/api/settings/data/route.ts`, `src/lib/authentication/cognito-membership-lifecycle.ts`: NEW-ADM-E.
- `src/app/api/settings/users/activation/route.ts`: the Send Activation lookup.
- `src/lib/authentication/cognito-admin-core.ts`, `src/app/api/settings/users/assign-password/route.ts`: NEW-ADM-B.
- `scripts/validate-clean-bootstrap.mjs`: AWS-stage assertions `department_self_creation_not_executable` and `first_login_activation_runtime_only`.
- Tests:
  - `src/lib/authentication/first-login-activation.test.ts` (embedded PostgreSQL, 8 tests);
  - `cognito-membership-lifecycle-sql.test.ts` (embedded PostgreSQL, 4 tests);
  - `account-access-routes.test.ts` (5 source-contract tests, in the style of `proxy-authorization.test.ts`, because route and `server-only` modules cannot be imported under `node:test`);
  - `cognito-admin-core.test.ts` (+1).

## Verification (local, synthetic; no remote systems)

PostgreSQL 16 ran as user `ubuntu` on 127.0.0.1:55611. Embedded PostgreSQL cannot run as root in this sandbox, so the embedded-PostgreSQL test files were also run against that server through a shim that only replaces the server start-up. In the repository runner they report "ran no tests" here, as B0 documents.

| Check | Before | After |
|---|---|---|
| `first-login-activation.test.ts` | 4/8 fail (`FirstLoginIdentityMappingStore is not a constructor`; pending invitee cannot register a session). The 4 negative cases already passed | **8/8** |
| `cognito-membership-lifecycle-sql.test.ts` (009 alone versus 009+039) | 4/4 fail: `column reference "user_id" is ambiguous` | **4/4** |
| `account-access-routes.test.ts` + `cognito-admin-core.test.ts` | 6 of 9 fail | **9/9** |
| Existing related DB tests via shim (`postgres-mapping`, `postgres-session-state`, `rehearsal-first-login`, `cognito-establish`, `postgres-refresh-sessions`) | — | 2, 8, 12, 5 and 11 pass; 0 fail (active-user and rehearsal paths unchanged) |
| Full AWS schema (79 Supabase + 39 AWS migrations, R7 seed): T9 replay | Invitee link `pending`; `findActive` 0 rows (R7 `db-t9.out`) | After the real invite flow, `activate…` as `tracepoint_runtime` returns the invitee. Link `active`, membership `activated`, events `linked,activated`, 1 audit row, `findActive` 1 row. A second call returns null with no extra audit. Request role: `permission denied`. Wrong user, deactivated membership and revoked link each return null, with the link unchanged |
| Full AWS schema: ADM-03 | Membership-less subject creates "Rogue Agency" (R7 T5) | `permission denied for function create_department_with_owner`; 0 departments created |
| Full AWS schema: Settings deactivation composition (prepare + `update_department_member` in one transaction, then finish) | `prepare_cognito_membership_operation` raises 42702 | Membership inactive, 1 revocation row, 0 open access sessions, operation `committed`, audit `membership_updated,department_membership_deactivated`. Self-deactivation inside the same transaction → error and full rollback (membership active, 0 revocations, 0 operation rows). Re-enable → active, `committed` |
| Full AWS schema: Send Activation lookup | Request-role `select … authentication_identity_links` → `permission denied` | Pool read returns the state |
| `db:validate-bootstrap` (B0 shim, port 55611) | — | **Passes**: "79 ordered migrations and 39 AWS-native migrations". Control: the ADM-03 revoke removed → fails with `AWS-native schema checks failed: department_self_creation_not_executable` |
| `npx tsc --noEmit` | — | 0 errors |
| `npx eslint` on changed files | — | clean |
| `node scripts/run-application-tests.mjs` | — | 564 tests, 560 pass. The 4 failures are the xlsx stub (importer parse and inference). 13 embedded-PostgreSQL files "ran no tests" (the 11 from B0 plus the 2 new ones), which is the environment limitation |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | — | 348/349. The one failure is the SheetJS round trip |

## Owner decisions

1. **ADM-04 interaction (important).** Fixing the 42702 bug in `prepare_cognito_membership_operation` makes the personnel-import lifecycle run for the first time on AWS.
   - The classic import route (`/api/settings/onboarding/personnel`, aws-native branch) maps a missing Active column to `active=true` and calls `setCognitoMembershipActive(active:true)` for an existing identity.
   - It can therefore **re-enable a separated officer's membership and Cognito account**. Until now this path failed with a 500, so it failed closed by accident.
   - Ship B1 together with the B11 ADM-04 fix ("re-import never reactivates without confirmation"), or accept this window explicitly.
2. **NEW-ADM-B password minimum.**
   - CDK still declares `minLength:14` for the foundation pool. Production was hand-patched to 10 on 09-29 (changeset `production-cognito-password-20260929`). A future CDK deploy of that stack may restore 14.
   - Decide one number. Then align `infra/lib/cognito-foundation-stack.ts` and `phase3c-rehearsal-app-stack.ts` with `COGNITO_PASSWORD_MIN_LENGTH` in `src/lib/authentication/password-policy.ts`, or the other way round.
   - Until then, Assign Password shows Cognito's rejection clearly instead of a generic failure.
3. **NEW-ADM-F.** Choose between "Access Agency first" guidance on the Platform page and a platform-scoped, audited resend function. See above.
4. **Mobile first sign-in.** Activation happens on the web PKCE callback only. A pending user whose first sign-in is through the native app's `/api/mobile/session` is still refused until they sign in once on the web. The mobile establish path validates the access token and only then checks Cognito `GetUser`, so activating there would happen before the live revocation check. Extending it needs a decision and the native client owner.
5. **Platform admins without a membership** whose link is still pending are not activated, because there is no active membership. This is unchanged.
6. **Re-enable on provider failure.** If Cognito `AdminEnableUser` fails after the Settings save, the membership is already active (the guards ran in the same transaction). The lifecycle operation is recorded as `compensation_required` and the admin sees an error, but the Cognito user stays disabled, so this fails closed. To retry, toggle inactive and then active.

## Staging runbook (README §8)

1. Apply `039` to staging **before** deploying the image: run `scripts/migrate-db.ps1 staging -Action status` (expect one pending entry, 039), then `apply`. An image without 039 behaves as before for first sign-in (the function call fails, so sign-in is refused, as today).
2. **S1 (NEW-ADM-A):** invite an `acceptance-<UUID>` user. Complete Cognito's temporary-password change and TOTP enrolment. Expected: you land in the app. The member list shows the user as Activated, and the audit log has `account_activated`. Also run S1 for a user invited earlier and still pending: their next sign-in should activate them.
3. **Regression:** an already-active user signs in and refreshes normally. In rehearsal mode the Readington and Montville promoters are unchanged.
4. **NEW-ADM-E:** deactivate the S1 user in Settings. Expected: their open browser session is rejected on the next request or refresh, Cognito shows the user Disabled, and the audit log has `department_membership_deactivated`. Reactivate: Cognito shows Enabled and the user can sign in.
5. **Send Activation:** for a pending user, Settings → Send Activation returns 200 and Cognito re-sends the temporary password. On the Platform page it works while in Support Mode for that agency (NEW-ADM-F remains open outside Support Mode).
6. **NEW-ADM-D:** import a roster row for an existing pending identity. Expected: no 500, and the invitation is re-sent.
7. **ADM-03:** `select has_function_privilege('tracepoint_runtime','public.create_department_with_owner(text,text,text,text,text,text)','execute')` → `false`.
8. **NEW-ADM-B:** on staging (pool minimum 14), Assign Password with an 11-character compliant password → 400 with the policy message.
9. Run S10 (the tenant-negative suite).

Production application of 039 needs separate authorization. It is safe on the imported schema: `create or replace` of two `tracepoint_auth` functions, plus a guarded revoke.

## Rollback

- Revert the image. The app then stops calling the activation function and the Settings lifecycle branch.
- The 039 objects can stay. Note that reverting the image does not restore the broken 009 function body: it stays corrected, which affects the import path (see Owner decision 1). To undo the ADM-03 revoke: `grant execute on function public.create_department_with_owner(text,text,text,text,text,text) to authenticated;`. To remove the activation function: `drop function tracepoint_auth.activate_cognito_identity_on_first_login(text,text,uuid);`.
- Identity links that were activated stay active. That is correct: they belong to users who completed Cognito sign-in.
