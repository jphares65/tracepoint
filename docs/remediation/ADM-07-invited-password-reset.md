# Follow-up ADM-07: invited-user password reset and email verification

Base: `claude/integration-defects-20261020` (`e19e84c`). Branch: `claude/fix-adm07-invited-reset`. Earlier records: B11 (ADM-07 "verified; no code change" with a staging caveat, S23 step 3), B1 (first-login activation, NEW-ADM-A), F1 (14-character minimum, Support Mode Send Activation).

Owner directive: "Validate the invited-user password-reset flow. Do not automatically mark an email verified merely because the user signed in; require appropriate verification."

Scope: defects only. There is **no SQL** (055 was not needed) and **no infra change**. No AWS or network call was made. The analysis is from code, CDK and the Cognito SDK documentation shipped in `node_modules/@aws-sdk/client-cognito-identity-provider` (3.1127.0).

## Trace

**Pool** (`infra/lib/cognito-foundation-stack.ts`, used for staging and production):
- The email address is the sign-in name (`signInAliases:{email:true}`). An unverified email can still sign in.
- `autoVerify:{email:true}` and `accountRecovery: EMAIL_ONLY` (recovery through a verified email only).
- MFA is required (TOTP only). Passwords need 14 characters. Temporary passwords are valid for 1 day.
- Self sign-up is off.
- The web client has `preventUserExistenceErrors` and the OAuth scopes `openid` and `email`. It does **not** have `aws.cognito.signin.user.admin`.
- The staging mobile client also has `aws.cognito.signin.user.admin`.
- The domain is created without `managedLoginVersion`. CloudFormation's default is believed to be the classic hosted UI. Confirm this in the console (step 0 below).

**Invite.** Settings invite, personnel import and the AI importer all use `inviteCognitoUser`. Send Activation for an identity that is not yet migrated uses `migrateExistingUserToCognito`.
- `createPending` calls `AdminCreateUser` with `MessageAction: SUPPRESS` and the attributes `email` and `name`. The temporary password is 32+ random characters generated on the server and shown to nobody.
- `resendInvitation` then calls `AdminCreateUser` with `MessageAction: RESEND`, `DesiredDeliveryMediums: ["EMAIL"]`. Cognito emails the temporary password to that address.
- `email_verified` is **never set at invite time**. The user is in `FORCE_CHANGE_PASSWORD`.

**First sign-in.** LoginForm → `/api/auth/cognito/login` → managed login (`/oauth2/authorize`).
- Cognito runs the NEW_PASSWORD_REQUIRED and TOTP set-up steps itself. The app has no code for those steps.
- `/api/auth/cognito/callback` verifies the tokens and calls `activate_cognito_identity_on_first_login` (039). This is a database-only change: link `pending` → `active`, membership `activated`.
- **No sign-in path touches Cognito attributes.** This is guarded by a test.
- After this step the user is `CONFIRMED`, and `email_verified` is unchanged. The one exception would be managed login asking for and accepting an email code by itself, which staging records.

**Forgot password.** The app has no forgot-password route. Users select "Forgot your password?" in managed login, which calls Cognito `ForgotPassword`. From the SDK documentation: "If neither a verified phone number nor a verified email exists, Amazon Cognito responds with an `InvalidParameterException`". A user in `FORCE_CHANGE_PASSWORD` cannot reset and must be re-invited with `AdminCreateUser` `RESEND`.

**Administrator actions (Settings → Users & Roles):**
- **Password reset** calls `AdminResetUserPassword`. The app checks first (`assertCognitoPasswordResetReady`):
  - `FORCE_CHANGE_PASSWORD` → 409 "requires its initial password change. Use Send Activation or Assign Password".
  - Not `CONFIRMED` + verified → 409 `recovery_unavailable`.
- **Send Activation** sends a `RESEND`, and only while the link is `pending` and Cognito still says `FORCE_CHANGE_PASSWORD`.
- **Assign Password** calls `AdminSetUserPassword` with `Permanent` and then signs the user out globally.

### States

| State | Cognito status / `email_verified` | "Forgot your password?" (managed login) | Admin Password reset | Send Activation | Assign Password |
|---|---|---|---|---|---|
| 1. Invited, never signed in (also: temporary password expired) | `FORCE_CHANGE_PASSWORD` / absent (false) | Refused by Cognito: the password cannot be reset in this state, and no code is sent. Record the exact text on staging | 409 "…initial password change. Use Send Activation or Assign Password; no reset email was sent." No Cognito call | **Works**: a new temporary password is emailed and the old one stops working. This is the documented remedy | Works → `CONFIRMED` |
| 2. Invited, first sign-in completed | `CONFIRMED` / false, unless managed login itself verified the email with a code (staging records this) | If false: refused (`InvalidParameterException`, no verified email), and no code is sent. With existence-error prevention the screen may be generic. If true (code verified): works | If false: 409 `recovery_unavailable`, **now with the remedy** "Use Assign Password instead" | 400 "This account does not require activation." | **Works** (the remedy) |
| 3. Pending user given Assign Password (before first sign-in) | **Before:** `CONFIRMED` / **true, set by the app with no proof**. **After:** `CONFIRMED` / unchanged (false) | Before: works, and the code goes to an address nobody proved. After: as state 2 | Before: allowed. After: 409 with the remedy | The link is still `pending`, but Cognito is not `FORCE_CHANGE_PASSWORD` → 500 "Activation email could not be sent." (unchanged; see Deferred) | Works |
| 4. Normal user: email verified with proof (production users linked from Supabase with a confirmed email, see `production-final-cognito-stage-link.cjs`; or a code-verified email) | `CONFIRMED` / true | Works. MFA is still required after the reset | 200; Cognito emails a code, and the status is `RESET_REQUIRED` until the user completes it | 400 "does not require activation" | Works |

## Defects addressed

| ID | Status | Defect (verified on the base) | Change |
|---|---|---|---|
| ADM-07a | **Fixed** | Assign Password marked a pending user's email verified without any proof of mailbox control. `assignCognitoPassword` called `markEmailVerified`, which sends `AdminUpdateUserAttributes email_verified=true`, whenever the identity was `pending`. This is the only place in the application that set `email_verified`. Assign Password is typically used when the invitation did not reach the mailbox, so it marked unproven addresses as verified. The consequence: Cognito then sends recovery codes to an address nobody confirmed. On a pending account that has no TOTP enrolled yet, whoever controls that mailbox can reset the password and enrol MFA first. | `cognito-password-lifecycle.ts` no longer marks the email. `markEmailVerified` is removed from `CognitoAdminDirectory` and `AwsCognitoAdminDirectory` (no other caller), and the unused `AdminUpdateUserAttributesCommand` import goes with it. Assign Password still sets the permanent password and signs the user out globally, and its response is unchanged. |
| ADM-07b | **Fixed (messages)** | (1) The admin Password reset refusal said "Cognito email recovery is unavailable for this account." without saying why or what to do. (2) The Help tip told users to ask for "send activation or assign a password" whether or not they had completed first sign-in. After first sign-in, Send Activation is refused ("does not require activation"). | `password-reset/route.ts`: the 409 now says "Cognito cannot send a reset code to this account: its email address has not been verified, or the account is not in a state that allows a reset. Use Assign Password instead. No reset email was sent." The status is still 409 and the body is still `{ error }`. `help-content.ts`, Reset tip: before first sign-in, "Forgot your password?" cannot be used, so ask for **Send Activation**. If the reset is refused or no code arrives after first sign-in, ask for **Assign Password**. |
| ADM-07c | **Not fixed: owner decision** | No application path verifies an invited user's email. After first sign-in, an invited user (state 2) cannot use "Forgot your password?" unless managed login verified the email with a code by itself (staging S23-3 revised, step 2, records this). | See Owner decisions. Nothing marks the email verified on sign-in, and a test guards this. |

**Not a defect, verified:**
- Users in `FORCE_CHANGE_PASSWORD` cannot reset. This is Cognito's rule, and Send Activation (`RESEND`) is the remedy. The admin route already refuses them with a 409 naming Send Activation, and the Help article now says so.
- Invite delivery uses `RESEND` with `EMAIL`, so the invitation reaches the address regardless of verification.

## Files

- `src/lib/authentication/cognito-password-lifecycle.ts`: Assign Password does not mark the email verified.
- `src/lib/authentication/cognito-admin.ts`, `cognito-admin-core.ts`: `markEmailVerified` removed.
- `src/lib/authentication/cognito-existing-user-migration-core.test.ts`: the stub drops the removed method.
- `src/app/api/settings/users/password-reset/route.ts`: the `recovery_unavailable` message.
- `src/app/help/help-content.ts` and `.test.ts`: the Reset tip and its test.
- `src/lib/authentication/cognito-email-verification.test.ts` (new).

## Tests added

| Test | What it proves |
|---|---|
| `cognito-email-verification.test.ts` (5) | Runs the real `AwsCognitoAdminDirectory` in a child process (`--conditions=react-server`, because the module is server-only) against a **mocked Cognito client** that applies Cognito's state rules. These rules are: no implicit `email_verified`; `RESEND` only in `FORCE_CHANGE_PASSWORD`; a reset needs `CONFIRMED` and a verified email. AWS credentials are removed from the child's environment, and no network call is made. (1) The invite sends `SUPPRESS` with `email` and `name` only, then `RESEND` with `EMAIL`. (2) Every directory method, called on every state, sends no `email_verified`. Assign Password's sequence is Get → SetUserPassword → GlobalSignOut. (3) The state matrix: never signed in → `initial_password_required` and Send Activation works; signed in → `CONFIRMED`/false, `recovery_unavailable`, Send Activation refused; assigned password → `CONFIRMED`/false; normal → reset sent. (4) Guard: the sign-in and first-login files (`postgres-sessions`, `postgres-mapping`, the Cognito transports, the initial-session and establish code, PKCE, the mobile session, the callback and `/api/mobile/session` routes) never reference `email_verified`, `UpdateUserAttributes`, `VerifyUserAttribute`, `markEmailVerified` or the admin directory. Assign Password has no `email_verified`. (5) Both refusal messages name the remedy. |
| `help-content.test.ts` (+1) | The Reset tip maps "before first sign-in" to Send Activation and "after first sign-in" to Assign Password. |

## Verification (local, synthetic; no remote systems)

### Fail before, pass after

The fix files were saved as a patch (`git diff -- <files>`), restored to `e19e84c` with `git checkout`, and the tests were run. The patch was then re-applied and checked to be byte-identical. `git stash` was not used.

| Test | Before (`e19e84c`) | After |
|---|---|---|
| No directory operation marks an email verified | **fail**: 12 `AdminUpdateUserAttributesCommand` writes of `email_verified` | pass |
| Sign-in and Assign Password never touch attributes (source guard) | **fail**: `markEmailVerified` in `cognito-password-lifecycle.ts` | pass |
| Refusals name the remedy | **fail**: old `recovery_unavailable` text | pass |
| Help names the remedy per state | **fail**: old tip | pass |
| Invite attributes and delivery; state matrix | pass (they document existing behaviour) | pass |
| Existing `cognito-admin-core`, `cognito-existing-user-migration-core`, other `help-content` tests | pass | pass |

Totals for those four files: before 15/19 pass (4 fail), after 19/19.

### Required checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `node scripts/run-application-tests.mjs` | 734 tests: 730 pass, 4 fail. The 4 failures are the xlsx stub (`ai-importer/workbook.test.ts`). 19 embedded-PostgreSQL files "ran no tests", which is the environment limitation; it is the same list as B11. No SQL or database code changed |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 351 tests: 350 pass. The 1 failure is the SheetJS round trip |
| `npx eslint` on the 8 changed or new files | clean |
| SQL / bootstrap / validator / CDK synth | Not applicable: no SQL and no infra change |

## Native client contract (code not available)

- No `/api/mobile/**` route and no response shape changed.
- `POST /api/settings/users/password-reset`: the 409 `recovery_unavailable` `error` text changed. The status and the `{ error }` shape are unchanged.
- `POST /api/settings/users/assign-password`: the response is unchanged. **Cognito side effect:** from now on, users given a password while pending are **not** email-verified. If the native app offers Cognito `ForgotPassword`, those users get the same refusal as invited users (state 2/3) until their email is verified with a code. The staging mobile client already has the `aws.cognito.signin.user.admin` scope, so the native app could run Cognito's own code verification (`GetUserAttributeVerificationCode` / `VerifyUserAttribute`) without a server change (option B below).

## Staging: S23-3 (revised)

This replaces B11's S23 step 3. Use an `acceptance-<UUID>` agency on staging after this image is deployed, and three or four mailboxes you control. There is no migration. Production needs separate authorization.

**Step 0. What to record for every account, before and after each step.** In the Cognito console (user pool `tracepoint-staging` → Users → the user), record:
- **Status**: `FORCE_CHANGE_PASSWORD`, `CONFIRMED` or `RESET_REQUIRED`.
- The **`email_verified`** attribute: absent, false or true.
- The exact on-screen message and whether a code email arrived (and after how many minutes).

Record once: the user pool's App client → Login pages / Domain "Branding version" (Hosted UI classic or Managed login).

| Step | Do | Expected | Record |
|---|---|---|---|
| 1. Invited, never signed in (I1) | Settings → Users & Roles → invite I1. Do **not** sign in. Sign out of the admin session, open `/login` → Continue with secure sign-in → **Forgot your password?** → I1's email. Back as admin: **Reset password** for I1, then **Send Activation** for I1. | Console: `FORCE_CHANGE_PASSWORD`, `email_verified` absent/false. Forgot password: no code email (Cognito refuses resets in this state). Reset password: 409 "…requires its initial password change. Use Send Activation or Assign Password; no reset email was sent." Send Activation: 200, a new invitation arrives, and the previous temporary password no longer works. | Status, `email_verified`, the Forgot-password screen text, and whether any code arrived. |
| 2. Invited, signed in (I2) | Invite I2. Sign in with the emailed temporary password, choose a 14-character password and enrol TOTP. **Note any "verify your email" or code screen managed login shows**, and complete it if shown. Reach TracePoint (first-login activation). Sign out → Forgot your password? → I2. As admin: Reset password for I2, Send Activation for I2, then **Assign Password** for I2. Sign in as I2 with the assigned password and TOTP. | Console after sign-in: `CONFIRMED`. **`email_verified` is false**, unless managed login verified the email with a code you entered; in that case true, and the forgot-password code arrives, reset works and TOTP is still required. If false: no code (record the message); Reset password → 409 "…email address has not been verified… Use Assign Password instead. No reset email was sent."; Send Activation → 400 "This account does not require activation."; Assign Password → 200, `email_verified` **unchanged**; sign-in with TOTP works. | Whether managed login offered email verification; `email_verified` after sign-in and after Assign Password; the Forgot-password result. **This result drives the owner decision below.** |
| 3. Assign Password before first sign-in (A) | Invite A. Without signing in, use Assign Password for A. Sign in as A (enrol TOTP), sign out, then Forgot your password? → A. | Console after Assign Password: `CONFIRMED`, **`email_verified` absent/false**. Before this change it was set to true. Forgot password behaves as in step 2 (refused if still unverified). | `email_verified` after Assign Password. |
| 4. Normal user (N) | Use an account whose console shows `email_verified` true and that you control (for example an existing staging user verified before this change). Forgot your password? → N; enter the code; set a 14-character password; sign in. As admin: Reset password for N. | A code arrives; the reset succeeds; TOTP is still required. Admin reset → 200 "Password reset sent to …"; status `RESET_REQUIRED` until completed. | Status and `email_verified` before and after. |

Pass: no step changes `email_verified` to true except a code the user entered in a Cognito screen. Steps 1, 3 and 4 match the expected results. Step 2's result is reported for the owner decision.

## Rollback

- Revert the commit and redeploy the image. There is no database or infra change.
- Users given Assign Password while this change was live remain unverified. That is safe; they recover through Assign Password. After a rollback, Assign Password marks pending users verified again.

## Owner decisions

1. **ADM-07c: how an invited user's email becomes verified.** Decide after S23-3 (revised) step 2.
   - If managed login already offers and accepts an email code at first sign-in, Cognito's own attribute verification is in place. **No change is needed.**
   - Otherwise choose one:
     - **A. The invitation is the verification** (Cognito's documented pattern). Send `email_verified=true` in the invite-time `AdminCreateUser`, **and** have Assign Password set `email_verified=false` for a pending identity.
       - This does not mark a user verified because they signed in. While the user is `FORCE_CHANGE_PASSWORD`, Cognito refuses resets anyway. The flag only takes effect once the user has redeemed the random temporary password that was delivered only to that mailbox, which proves control of the mailbox.
       - The Assign Password reset keeps the flag false when no mailbox proof exists.
       - Size: two small server changes plus tests.
       - Existing invited users would need a separate, explicit backfill decision. A blanket backfill is not recommended.
     - **B. Code verification after first sign-in** (Cognito `GetUserAttributeVerificationCode` + `VerifyUserAttribute`).
       - Web: the web client must gain the `aws.cognito.signin.user.admin` scope (CDK deploy), plus a server route and a UI step ("Verify your email" with a code). This is a new capability, not a defect fix, so it was not built here.
       - Native: the mobile client already has the scope.
     - **C. Keep as is.** Invited users who forget their password ask an administrator for Assign Password. The Help article and the admin message now say so.
   - Recommendation: **A** if the owner accepts invitation redemption as mailbox proof; otherwise **B**.
2. **Assign Password no longer verifies the email** (ADM-07a). This follows the directive. If the owner prefers the earlier behaviour for administrator-issued passwords, the revert is the single removed line, but the risk described above returns with it.

## Deferred

- **Send Activation after Assign Password, before first sign-in** (state 3) returns 500 "Activation email could not be sent." The link is still `pending`, but Cognito is `CONFIRMED`, so `RESEND` is refused. Nothing is changed or sent. A clearer 409 would be a small separate fix.
- The task role still has `cognito-idp:AdminUpdateUserAttributes`, which is now unused. Removing it is a least-privilege infra change that needs a CDK deploy, and option A would need it again. It was not changed.
- Production's pool and domain settings could not be inspected (no AWS access). The infra code declares the same recovery settings as staging.
