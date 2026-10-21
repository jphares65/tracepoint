# Follow-up batch F1: owner decisions for account access (B1) and personnel import (B1a)

Base: `claude/integration-defects-20261020` (B0–B5). This batch applies the owner's decisions on the open items in `B1-account-access.md` (Owner decisions 2–4) and `B1a-reimport-safety.md` (Owner decisions 1, 2 and 4). It corrects defects only and adds no features.

## Defects addressed

| ID | Defect | Status | Change |
|---|---|---|---|
| NEW-ADM-B (B1) | The application accepted 10-character passwords. The Cognito pools declared in infra code require 14. The Supabase-bridge pages used a separate minimum of 8. | **Fixed (application)**. Infra code was already at 14. | `COGNITO_PASSWORD_MIN_LENGTH` is now 14 and the requirement text says 14. The Assign Password form, the route and the Cognito directory already use this shared validator. The bridge activation page, the bridge setup page and the bridge Assign Password branch now use the shared constant instead of 8. Both pools in infra code already declare 14 (`cognito-foundation-stack.ts`, which also defines the production pool `<env>-cognito`, and `phase3c-rehearsal-app-stack.ts`). Infra code was not changed. The production pool was set to 10 by hand through `infra/changesets/production-cognito-password-20260929` (`newMinimumLength: 10`). That changeset was **not edited or applied**. See "Production compatibility" below. |
| No forced reset (B1 decision 2) | — | Verified | The validator runs only when a new password is set: Assign Password, completing a reset, and the bridge activation/setup pages. Sign-in never runs it. `AdminResetUserPassword` is called only by the explicit administrator action "send password reset". No code forces a reset because of the policy. |
| Native first-time activation (B1 decision 4) | A pending user whose first sign-in is through `/api/mobile/session` is refused. | **Deferred (owner: "once the native client is available")** | Not implemented. The design is below. |
| NEW-ADM-F (B1) | The Platform page offered Send Activation, but in aws-native it works only in Support Mode for that agency. Outside Support Mode it failed with "The active agency does not match this request." | **Fixed (guidance only; Support Mode kept)** | `platform/[departmentId]/page.tsx` works out in aws-native whether both the `tracepoint_support_department_id` and `tracepoint_department_id` cookies name this agency. These are the same cookies `resolveServerAccess` uses. When they do not, `ActivationButton` shows "Use Access Agency to enter Support Mode for this agency, then send the activation." in place of the button. The activation route's authorization did not change. Bridge mode is unchanged: there, platform administrators can send activations without Support Mode. |
| ADM-04 blank fields (B1a decision 2) | Re-import wrote NULL over badge, rank, unit and employee number when a field was blank. Affected paths: the classic bridge route (rank, unit, employee number), `attach_existing_cognito_personnel_import` (`010`, all four fields) and `update_cognito_personnel_import` (`010`, the four fields and phone; used by the AI importer's Cognito UPDATE). | **Fixed** | Bridge route: blank rank, unit and employee number are left out of the upsert, so PostgREST leaves them unchanged. The badge number is already required there. `044`: `attach_…` keeps the stored value with `coalesce(excluded.x, m.x)`, and `update_…` keeps it with `coalesce(nullif(btrim(p_x),''), x)`. The AI importer's bridge UPDATE already used `compact()` and was safe. It is now covered by a test. The Cognito writer passes blanks through to these functions, so the database fix covers it, for CREATE rows matching an existing identity and for UPDATE rows. A non-blank value still overwrites. |
| ADM-04 roles (B1a decision 1) | `attach_existing_cognito_personnel_import` added `officer` to an existing member who did not have it. | **Fixed** | `044` adds the default `officer` role only when the upsert inserted the membership (`returning (xmax=0)`). An existing member's roles are never changed. New memberships still get Officer. |
| Active=No and administrator protections (B1a decision 4) | Must hold on the import path. | **Verified; one gap fixed** | On the real AWS schema: self-deactivation is refused by the `010` trigger (`self deactivation is not permitted`). Deactivating the final active Administrator is refused by `protect_final_administrator_membership` ("must retain at least one active Administrator"). Nothing is revoked in either case. **Gap:** `update_department_member`'s rule "Only a department Administrator may modify an Administrator account" was not applied on the import path. A non-Administrator who has `manage_users` could deactivate one of several Administrators, disabling the Cognito user and revoking their sessions, through an import row with `Active=No`. `044` adds that check to `prepare_cognito_membership_operation` (039's body plus one `if`). The Settings path already enforced the rule, inside the same transaction, and behaves as before. |

## Files

- `database/aws/044_personnel_import_preservation.sql` (new; `begin; … commit;`, `create or replace` with unchanged signatures, grants restated, re-runnable).
- `src/lib/authentication/password-policy.ts`, `src/app/activate/page.tsx`, `src/app/auth/setup/page.tsx`, `src/app/api/settings/users/assign-password/route.ts`.
- `src/app/platform/[departmentId]/page.tsx`, `ActivationButton.tsx`.
- `src/app/api/settings/onboarding/personnel/route.ts`.
- `scripts/validate-clean-bootstrap.mjs`: AWS-stage assertion `personnel_reimport_preserves_existing_members`.
- Tests:
  - `src/lib/onboarding/personnel-import-native.test.ts` (new; embedded PostgreSQL with the full Supabase lineage plus every `database/aws` migration; 9 tests; runs as `tracepoint_runtime` with `set local role authenticated` and the subject, agency and Support Mode settings);
  - `password-policy.test.ts` (1 updated, 2 new: the infra pools must declare the application minimum, and the password pages must use the shared constant);
  - `account-access-routes.test.ts` (+1, NEW-ADM-F);
  - `personnel-reimport.test.ts` (+2).

## Verification (local, synthetic; no remote systems)

PostgreSQL 16 ran as user `ubuntu` on 127.0.0.1:55621. Embedded PostgreSQL cannot run as root in this sandbox, so the new embedded test was also run against that server through a shim that only replaces the server start-up and the database name. The fail-before runs restored the pre-fix sources from a patch, or set `044` aside, and did not use `git stash`.

| Check | Before | After |
|---|---|---|
| `personnel-import-native.test.ts` (shim; "before" = `044` absent) | 5/9 fail: blank fields nulled; `officer` added to a Supervisor; AI-importer update nulled fields; a `manage_users` Supervisor deactivated an Administrator; no 044. The self-deactivation, final-Administrator, new-membership and officer-deactivation tests pass, which confirms the existing protections | **9/9** |
| `password-policy`, `account-access-routes`, `personnel-reimport` (+ `cognito-admin-core`) | 5 fail (minimum 10; infra mismatch; bridge pages at 8; no Platform guidance; bridge route nulls fields) | **25/25** |
| Full AWS schema probes (122 migrations, R7 seed, `ctx.sh` session shape) | Admin self-deactivation → refused. Platform admin in Support Mode deactivating the sole Administrator → refused. Supervisor with `manage_users` deactivating one of two Administrators → **succeeded** (membership inactive, provider change true) | The same two refusals. The Supervisor case is refused with "Only a department Administrator may modify an Administrator account."; deactivating an officer still succeeds |
| `bootstrap.mjs --aws` | — | 123/123 applied. Re-applying `044` succeeds |
| `db:validate-bootstrap` (shim, 55621) | Control without `044`: `AWS-native schema checks failed: personnel_reimport_preserves_existing_members` | **Passes**: "79 ordered migrations and 44 AWS-native migrations" |
| `npm test --prefix infra` (dependencies installed offline from the npm cache) | — | 38/38 across the 8 files. Infra code unchanged |
| `npx tsc --noEmit` | — | 0 errors |
| `npx eslint` on changed files | — | clean |
| `node scripts/run-application-tests.mjs` | — | 619 tests, 615 pass. The 4 failures are the xlsx stub. 15 embedded-PostgreSQL files "ran no tests" (B1's 13 + `fleet-audit-outbox-native` + the new file), which is the environment limitation |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | — | 348/349. The one failure is the SheetJS round trip |

## Production compatibility: password minimum 14 (operator note; separate authorization required)

The application now refuses new passwords shorter than 14 characters. The production pool is currently 10 (hand-patched on 2026-09-29). The infra code still declares 14, so a future CDK deploy of the production Cognito stack would restore 14. Until then, the application is stricter than the pool, which is safe: the pool accepts everything the application sends. Raising the production pool to 14 is an infrastructure change and needs separate authorization. Nothing in this batch applies it.

- A Cognito password-policy change applies only when a password is next set (sign-up, administrator set, reset, or the forced change of a temporary password). Existing valid passwords are not invalidated, users with 10–13-character passwords keep signing in, and no forced reset occurs.
- Before changing production, an operator must verify:
  1. **Temporary-password policy.** `TemporaryPasswordValidityDays` stays 1. Cognito-generated temporary passwords follow the pool policy. Confirm that invitations sent after the change contain a compliant temporary password, and that the "change temporary password" step enforces 14.
  2. **Invitation flow.** Invite an `acceptance-<UUID>` user. Complete the temporary-password change with a 14-character password and enrol TOTP. Then confirm first-login activation (B1, `039`). Also confirm that a 13-character choice is refused with Cognito's message.
  3. **Pending invitees.** Users invited before the change whose temporary passwords are still unused can still complete the change step, but must choose 14 or more characters.
  4. **Assign Password and reset.** These already validate at 14 in the application. After the change, they and the pool agree.
  5. The changeset guard (`scripts/prepare-production-cognito-password-change.ps1`) checks `expectedMinimumLength` against the live pool. Moving production back to 14 needs a new reviewed changeset, or a CDK diff that shows only the `MinimumLength` change. Do not reuse `production-cognito-password-20260929`.

## Deferred: native first-time activation (owner: once the native client is available)

Design, for the batch that implements it:

- **Where:** `POST /api/mobile/session`, in establish mode only (`resolveRuntimeCognitoMobileBearer(token, env, { establish: true })`). Never on restore, refresh, ordinary `/api/mobile/*` bearer calls or browser routes.
- **Order:**
  1. Verify the access token in full: signature, issuer, `token_use`, the mobile `client_id`, expiry and subject.
  2. Run the live Cognito revocation check (`GetUser` with the access token).
  3. Only if both succeed, call `tracepoint_auth.activate_cognito_identity_on_first_login(issuer, subject, user)` (`039`) through the runtime pool. It is executable only by `tracepoint_runtime`. It activates only a `pending` link that belongs to that user while an active membership exists, and otherwise returns null without changing anything.
  4. Make the call inside the same transaction as `registerVerified` for the durable mobile session, so a later failure rolls the activation back. The call should go in a mobile counterpart of `FirstLoginIdentityMappingStore` that can see a pending link. Today the mobile path uses the active-only `PostgresIdentityMappingStore`, and its `GetUser` check runs after mapping, so the order has to change.
- **Unchanged:** Platform administrators without a membership are not activated, as on the web. The response contract is unchanged, so the client sees an ordinary establish.
- **Tests:** activation only after verification and `GetUser`; a revoked token (failed `GetUser`) leaves the link pending; restore and refresh never activate; one audit row per activated membership.

## Owner decisions / assumptions

1. The bridge password pages also moved to 14, because the owner asked for 14 "across the application". They are reachable only in bridge mode. Existing bridge passwords are unaffected.
2. `update_cognito_personnel_import` now also keeps the stored **phone** number for a blank value. This is the same defect, and it matches the bridge AI importer. A blank import cell can no longer clear a field. Clearing a field is done in Settings.
3. The Platform guidance relies on the Support Mode cookies. A platform administrator who is also a manager-level member of the agency, with it selected but not in Support Mode, sees the guidance, although the route would accept them. The guidance is still correct for them, because entering Support Mode works.
4. The Administrator-only check added to `prepare_cognito_membership_operation` also applies to enabling. A non-Administrator cannot reactivate a deactivated Administrator through import, which matches `update_department_member`.

## Staging runbook (README §8)

1. Apply `044` to staging **before** deploying the image: run `scripts/migrate-db.ps1 staging -Action status` (expect one pending entry, 044), then `apply`. `044` does not depend on the image.
2. Seed: Administrator A, a second Administrator A2, a Supervisor S with `manage_users`, and officer O (roles Supervisor only; badge, rank, unit and employee number set).
3. Classic import (Settings → Import/Export) of O with rank, unit and employee number blank. Expected: the stored values remain and O's roles are still Supervisor only. Import a new person. Expected: role Officer, as before.
4. AI importer: an UPDATE row for O with blank rank and unit. Expected: the preview shows no change for them and the stored values remain.
5. As A, import A's own row with `Active=No`. Expected: refused, and A stays active. With A as the only active Administrator (A2 inactive), import A with `Active=No` as a platform administrator in Support Mode. Expected: refused ("must retain at least one active Administrator").
6. As S, import A2 with `Active=No`. Expected: refused ("Only a department Administrator…"), and Cognito A2 stays enabled. As A, the same row deactivates A2, disables Cognito and revokes A2's sessions.
7. Platform page outside Support Mode: pending users show the Access Agency guidance and no button. After Access Agency, Send Activation works (B1 step 5).
8. Assign Password with a 13-character compliant password. Expected: refused by the application with the 14-character requirement text.
9. Run S10 (the tenant-negative suite).

Production application of `044` needs separate authorization. It is safe on the imported schema: `create or replace` of three functions with the same signatures and restated grants.

## Rollback

- Revert the image. The Platform guidance and the 14-character application minimum go away, and the bridge route writes blanks again.
- To undo `044`, re-run the function definitions from `010` (`attach_…`, `update_…`) and `039` (`prepare_cognito_membership_operation`) as `create or replace`. Do not edit the `010` or `039` files: they are part of the hash-checked ledger. Data written while `044` was active (values that were kept, Officer not added) is correct and needs no reversal.
