# Production reviewer access — runbook for approval (prepared 2026-10-17)

Status: **not executed.** Every step changes production and needs explicit approval.
Basis: the staging test (`tracepoint-release-evidence/staging-reviewer-test-20261017/RESULTS.md`)
and read-only checks of production on 2026-10-17.

## Production facts (read-only, 2026-10-17)
- Pool `us-east-1_diFmWDMe9` (`tracepoint-production`): MFA ON (TOTP), 99 users, no identity
  providers, classic hosted sign-in (`ManagedLoginVersion` 1) on domain
  `tracepoint-production-193644343389`.
- Mobile client `7ndi959ot7k9cja0a0tvugbipo` (`tracepoint-production-mobile`): public, code flow,
  callback `tracepoint://auth`, scopes `aws.cognito.signin.user.admin email openid profile`,
  providers `COGNITO` only, token revocation on. The web client is not touched by this runbook.
- In AWS-native mode the legacy activation page is disabled. **Invite** creates the Cognito user;
  **Assign password** sets a permanent password, marks the email verified, and activates the
  identity link and membership — the user becomes `CONFIRMED` without signing in or enrolling MFA.

## Owner inputs before starting
1. Reviewer email: an address you control, used in both pools, for example an alias
   `appreview@tracepointhq.com` on Microsoft 365. Cognito sends its invitation (temporary
   password) email there at step B3; nothing else is sent.
2. Fictional agency name, for example "Cedar Hollow Demonstration Police Department" (not a real
   municipality).
3. Your password manager entry for the review account password (generated there, 24+ characters).

Who does what: **Owner** = you, signed in to the web app as platform administrator (with MFA) or
entering a password. **Claude** = AWS CLI commands with the `tracepoint-production` profile; no
secret is ever displayed.

## A. Read-only precheck (Claude)
A1. Confirm the service is on the expected revision, healthy, and that the pool and mobile
    client still match the facts above.
A2. Save the mobile client configuration:
    `aws cognito-idp describe-user-pool-client --user-pool-id us-east-1_diFmWDMe9 --client-id 7ndi959ot7k9cja0a0tvugbipo`
    → `mobile-client-before.json` and its hash (evidence folder). This file is the rollback.
A3. Owner: open `/super-admin` and confirm `fleet` and `inventory` appear in the feature list
    (production's feature catalog is not provable from migrations). If either is missing, stop:
    Fleet or Inventory would show "not available" to reviewers.

## B. Fictional agency and reviewer (Owner, in the web app; audited)
B1. `/platform` → Create agency: the fictional name, plan type `internal`.
B2. `/super-admin` → that agency's features: enable `fleet`, `equipment_readiness`, `firearms`,
    `firearm_custody`, `inventory`, `range_training`, `qualifications`; disable every other
    feature (in staging the insert trigger enabled all of them).
B3. Enter the agency in Support Mode → Settings → Role permissions → **officer** role only:
    `view_fleet`, `perform_fleet_inspections`, `view_inventory`, `firearm_custody.check_in`,
    `firearm_custody.check_out`, `firearm_custody.view_history`, `score_range_days`,
    `submit_off_duty_requests`. Nothing else.
B4. Settings → Users → Invite: the reviewer email, name "App Reviewer (Demo)", role **officer**
    only, no groups, active.
B5. Settings → Users → the reviewer → **Assign password**: paste a random password and discard it
    (it is never used; the reviewer signs in through the review provider). This activates the
    account without MFA enrollment.
B6. Seed fictional records in Support Mode: 2 fleet vehicles, 3 equipment assets, an inventory
    location with 3 items, 2 firearms assigned to the reviewer, 1 range day with the reviewer on
    the roster and a drill in the scoring workspace. Print or export the QR codes of one vehicle,
    one equipment asset, one inventory item and one firearm for the review notes.

## C. Review identity provider (Claude, Cognito CLI)
C1. Check the reviewer's local user: `admin-get-user` on the pool by email → `UserStatus`
    must be `CONFIRMED`, MFA list empty; record its username/`sub`.
C2. Create pool `tracepoint-production-app-review` (MFA OFF, admin-create only, email username,
    20-character minimum password policy, admin-only recovery, tags Purpose=app-review), domain
    `tracepoint-production-app-review-193644343389`, and a confidential client
    `production-pool-federation` (secret, code flow, scopes `openid email profile`, only
    callback `https://tracepoint-production-193644343389.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`,
    token revocation on, prevent-user-existence-errors on).
C3. Create the review user with the reviewer email (`email_verified=true`, message suppressed).
    Owner sets its permanent password from the password manager (Claude runs
    `admin-set-user-password --permanent` from a file the owner fills, deleted immediately after).
C4. Production pool: `create-identity-provider` OIDC `TracePointAppReview` — issuer
    `https://cognito-idp.us-east-1.amazonaws.com/<review pool id>`, the review client id and
    secret (read into a local file, used once, overwritten and deleted), `authorize_scopes`
    `openid email profile`, `attributes_request_method` GET, mapping
    `email`→`email` and `email_verified`→`email_verified`.
C5. Mobile client only: `update-user-pool-client` resending the saved configuration with
    `SupportedIdentityProviders = [COGNITO, TracePointAppReview]` and nothing else changed;
    diff against A2 must show only that field and `LastModifiedDate`. Confirm the web client
    still lists only `COGNITO`.
C6. `admin-link-provider-for-user`: destination `Cognito`/<reviewer username>; source
    `TracePointAppReview`/`Cognito_Subject`/<review-pool user sub>.

## D. Verification (Owner on a device + Claude read-only)
D1. Owner: on a phone with the current production build (TestFlight build 6 or the Android
    draft), tap Continue with TracePoint → **TracePointAppReview** → reviewer email and password.
    Expected: no verification-code prompt; the app opens the fictional agency without asking to
    choose one.
D2. Owner: open Inbox, Fleet (one vehicle, start and cancel an inspection), Equipment (check an
    asset out and back in), Inventory, Firearms (the two assigned), Range Days (the range day and
    its scoring workspace), and scan one printed QR code. Expected: all load; no other agency
    visible; no admin, user or password functions.
D3. Owner: sign out from the lock screen's "Sign in again" link, or let the session expire.
D4. Claude (read-only): the reviewer's local user is `CONFIRMED`, enabled, has the
    `identities` attribute, and `email_verified` is still true; no new `TracePointAppReview_*`
    user exists; the pool still has 100 users (99 + reviewer); MFA is still ON; the web client is
    unchanged; `/privacy`, `/api/health` and the public 401 suite still pass.

## E. Store consoles (Owner)
- App Store Connect → App Review Information: sign-in required; username = reviewer email;
  password from the password manager; notes from `store-review-readiness-20261017.md` section 6,
  with the QR codes attached.
- Play Console → App content → App access: "All or some functionality is restricted", the same
  credentials and the reviewer sign-in instructions (section 5 of the readiness document).

## F. Revocation (verified procedure)
1. Settings → Users → deactivate the reviewer (Support Mode). Production's deactivation also
   signs the user out of Cognito and disables the local user. Membership deactivation is the
   verified kill switch: it refused even tokens minted from a remembered session in staging.
2. Claude: `admin-user-global-sign-out` on the reviewer's local user (ends existing tokens on
   the next request).
3. Housekeeping (not counted as kill switches): disable the user in the review pool; remove
   `TracePointAppReview` from the mobile client by resending A2; unlink.
Do not rely on unlinking: in staging a remembered hosted sign-in kept issuing tokens after it.

Between review cycles, keep the reviewer active only while a submission is in review, and rotate
the review password after each cycle.

## G. Rollback of the whole setup
Resend A2 to the mobile client; `delete-identity-provider`; deactivate the reviewer; delete the
review pool domain, then the review pool; disable the fictional agency's features or leave it
inactive. Verify the mobile client matches A2 except `LastModifiedDate`.

## Cost and risk
- Cost: about $0 (Cognito lists 50 free federated monthly active users; no per-pool fee).
- The review account has no second factor; its reach is one fictional agency with officer
  permissions. Long random password, rotation per review cycle, deactivation when not in review.
- Every agency user keeps mandatory MFA; no backend or mobile code changes.
- Not yet observed in production: a federated sign-in into a user activated by Assign password
  (staging used a database fixture). D1 is the check; if it fails, roll back with G.
