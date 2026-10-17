# TracePoint Public Safety — store review readiness (2026-10-17)

Status: prepared locally for owner review; updated with validated reviewer-access analysis. Nothing here has been published, submitted,
or applied to production. Items marked **CONFIRM** need the owner's decision before use.
This document contains no credentials or secrets.

## 1. Builds

| | Current store builds | Required for review |
|---|---|---|
| iOS | 1.0.0 (5) from `98e6e8a` (old device name); 1.0.0 (6) from `1bec3eb` (name "TracePoint"), both uploaded to App Store Connect | New build from mobile `5b4e160` (adds the in-app Privacy Policy link). Apple 5.1.1(i) requires the policy to be reachable in the app. |
| Android | versionCode 3 from `98e6e8a`; versionCode 4 from `1bec3eb`, uploaded by the owner to Google Play with a production release draft (has no in-app privacy link) | New build from mobile `5b4e160`. Google's User Data policy requires the policy inside the app. |

Order: publish the web `/privacy` page first (the in-app link opens it), then build both apps from
`5b4e160`, then submit. Builds 5/6 and versionCodes 3/4 must not be submitted. In the existing Google Play production draft, replace versionCode 4 with versionCode 5 before sending it for review.

## 2. Verified data practices of the mobile app (basis for both store forms)

Collected and sent to the TracePoint backend by the app (all linked to the signed-in user, all for
app functionality, none used for tracking or advertising, none sold):

- Sign-in identity: Cognito user identifier; the email address and name come from the user's
  agency-provisioned account (sign-in happens on the Cognito page in the system browser).
- Photos and short videos (video includes microphone audio), captured with the camera only when the
  user adds inspection evidence. Maximum 25 MB per file.
- User-entered content: vehicle inspection answers, mileage/hours, notes; equipment custody
  condition notes; range attendance and scoring.
- QR codes scanned with the camera (resolved to agency assets).

Not collected by the app: location, contacts, photo library, advertising ID, device identifiers,
push tokens, analytics, crash reports (no analytics, crash, or tracking SDK is present).
Face ID / biometrics are used only for the local unlock and are never available to TracePoint.
On device: sign-in tokens and selected agency in secure storage (removed at sign-out); unsent
inspection drafts in app storage until submitted.

## 3. Proposed Google Play Data safety answers

- Does your app collect or share any of the required user data types? **Yes**.
- Is all of the user data collected by your app encrypted in transit? **Yes** (HTTPS only).
- Do you provide a way for users to request that their data is deleted? **CONFIRM** — proposed
  "Yes", via the agency administrator or the privacy contact in the policy. Accounts are created by
  agencies outside the app; the app has no account creation, so Google's in-app account-deletion
  requirement should not apply. **CONFIRM** the account-creation answer in Play Console.

| Category / type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Personal info — Name | Yes | No | Required | App functionality, Account management |
| Personal info — Email address | Yes | No | Required | App functionality, Account management |
| Personal info — User IDs | Yes | No | Required | App functionality, Account management |
| Photos and videos — Photos | Yes | No | Optional (user chooses to add evidence) | App functionality |
| Photos and videos — Videos | Yes | No | Optional | App functionality |
| Audio — Voice or sound recordings | Yes (audio track of evidence videos) | No | Optional | App functionality |
| App activity — Other user-generated content | Yes (inspection notes, custody notes, scoring) | No | Required for those workflows | App functionality |
| App activity — Other actions | Yes (QR scans, attendance, custody actions) | No | Required for those workflows | App functionality |
| Location, Financial, Health, Messages, Contacts, Calendar, Files and docs, Web browsing, App info and performance, Device or other IDs | No | No | — | — |

"Shared: No" relies on Google's definition: transfers to service providers that process data on
TracePoint's behalf (AWS) are not "sharing". **CONFIRM** that agencies are treated as the customer
receiving the service, not as a third party.

## 4. Proposed Apple App Privacy disclosures

Tracking: **No** (no data is used to track users across other companies' apps or websites).

| Data type | Linked to user | Tracking | Purpose |
|---|---|---|---|
| Contact Info — Name | Yes | No | App Functionality |
| Contact Info — Email Address | Yes | No | App Functionality |
| Identifiers — User ID | Yes | No | App Functionality |
| User Content — Photos or Videos | Yes | No | App Functionality |
| User Content — Audio Data | Yes | No | App Functionality |
| User Content — Other User Content | Yes | No | App Functionality |
| Other Data — Other Data Types (QR scans, attendance, custody actions) | Yes | No | App Functionality |

Not collected: Location, Health & Fitness, Financial Info, Sensitive Info, Contacts, Browsing
History, Search History, Usage Data, Diagnostics, Purchases, Identifiers — Device ID.
Privacy Policy URL: `https://tracepointhq.com/privacy`. Support URL: `https://tracepointhq.com/support`.

## 5. Reviewer access

### Constraint (verified)
- Production pool `us-east-1_diFmWDMe9`: `MfaConfiguration: ON`, TOTP only, admin-created users,
  password-only first factor. Cognito cannot exempt a single local user from pool MFA.
- Google requires reusable review credentials and asks apps that normally use 2-step
  verification to provide credentials that bypass it (Play Console Help 15748846). Apple requires
  a non-expiring demo account (App Store Connect "App Review information").
- Sharing a TOTP setup key was rejected; making MFA optional would weaken every agency.

### How the backend authenticates a mobile request (verified in code at `8194364`)
1. `cognito-verifier.ts`: RS256 access token from the production pool, mobile `client_id`, uuid
   `sub` and `jti`, lifetime ≤ 15 min. It never inspects how the user signed in (no `amr`/MFA check).
2. `postgres-mapping.ts`: `(issuer, sub)` must map to an identity link in state `active`.
3. `postgres-sessions.ts` `registerVerified` (only via `POST /api/mobile/session`): same active
   link **and** an active department membership (or platform admin) in one transaction; each
   access token (`jti`) gets its own session row; global TracePoint revocations are honoured.
4. `cognito-mobile-session.ts`: every request also calls Cognito `GetUser` with the access token,
   so a Cognito global sign-out takes effect on the next request, not at token expiry.
5. Identity links become `active` through the normal activation link
   (`finalize_cognito_activation`) or an administrator password assignment — not through a TOTP
   sign-in. Groups, email and department claims never grant access.

### Recommendation: link an isolated review identity provider to one demo officer
Federated sign-in does not use the pool's MFA (AWS: Cognito "delegates all authentication
processes to the IdP" for federated users). `AdminLinkProviderForUser` makes the federated
identity sign in **as the existing local user** (same username and `sub`), so steps 1–5 above
apply unchanged. Result:
- **No backend code change, no mobile code change.** The app already opens the Cognito sign-in
  page without an `identity_provider` parameter; managed login shows one extra button for the
  provider on the mobile client only.
- Existing users keep mandatory MFA. The web client and its sign-in page are unchanged.
- The reviewer can reach only what its TracePoint membership allows: one fictional agency, officer
  role, enforced by the backend and row-level security — not by Cognito.

Components (each additive and reversible):
1. Review pool `tracepoint-app-review` (Essentials): one administrator-created user, no MFA, no
   self sign-up, long random password, its own domain and a confidential app client (secret,
   authorization-code grant, scopes `openid email profile`) whose only callback is the main pool's
   `https://<main domain>/oauth2/idpresponse`.
2. OIDC identity provider `TracePointAppReview` in the main pool: issuer
   `https://cognito-idp.us-east-1.amazonaws.com/<review pool id>`, `client_secret_post`,
   attributes request method `GET`, mapping `email`→`email` only.
3. Enable the provider **only** on the mobile app client.
4. Fictional agency (plan `internal`; not Readington or Montville, which are real tenants), its
   features and officer permissions, and one reviewer invited through the normal invite flow and
   activated through the normal activation link. Use the **same email** in both pools: AWS
   overwrites a linked user's mapped attributes at every federated sign-in.
5. `AdminLinkProviderForUser` (destination `Cognito`/local username; source
   `TracePointAppReview`/`Cognito_Subject`/review-pool `sub`). The source must not have signed in
   before linking.

Staging results (2026-10-17, evidence in `tracepoint-release-evidence/staging-reviewer-test-20261017/RESULTS.md`):
- Proven: a linked user signing in through the provider gets no TOTP prompt; tokens carry the
  local user's `sub` and `aws.cognito.signin.user.admin`; `GetUser` accepts them; mobile session,
  module access, refresh, logout/revoke, and global sign-out behave as designed; tenant isolation
  holds; existing users, identity links, profiles and memberships are unchanged.
- The local user must be `CONFIRMED` (normal activation sets a permanent password). A user still
  in `FORCE_CHANGE_PASSWORD` makes federated sign-in fail. It does not need TOTP enrolled.
- **Unlinking is not a revocation method.** After `AdminDisableProviderForUser`, Cognito's
  remembered hosted sign-in session kept issuing valid tokens for the linked user (also after a
  global sign-out). TracePoint refused those tokens only because the membership was inactive.
- Federated sign-in sets the linked user's `email_verified` to false. Only effect: an admin
  password reset or Cognito "forgot password" for the reviewer's local account is refused
  (`recovery_unavailable`), which is acceptable; map `email_verified` too to avoid it.

Required revocation procedure (verified kill switches, in order):
1. Deactivate the reviewer's TracePoint membership. Verified to refuse existing sessions and every
   new token, including tokens minted from a remembered session.
2. `AdminUserGlobalSignOut` on the reviewer's local user. Verified to end existing tokens on the
   next request and to invalidate refresh tokens. It does not prevent new sign-ins.
3. Then housekeeping (not counted as verified kill switches): disable the user in the review pool,
   disable the local user, remove the provider from the mobile client, unlink.

Cost: Cognito lists 50 free federated monthly active users per account, then $0.015 each; no fee
per user pool. Expected cost $0. No EAS cost.

Residual risk: the review account has no second factor. Its exposure is one fictional agency with
officer permissions. Mitigate with a long random password, no reuse, rotation after each review,
and disabling the provider between review cycles if preferred.

### Alternatives considered
| Option | Verdict |
|---|---|
| Share the TOTP setup key with reviewers | Rejected by owner; reviewers also need an authenticator app |
| Set pool MFA to optional | Weakens every agency; the backend has no MFA check to compensate |
| Email or SMS one-time codes | Pool-wide change; reviewers cannot receive codes |
| Passkeys | Bound to devices reviewers do not have |
| Apple demo mode without sign-in | Needs Apple's prior approval and new app code with fake data |
| Separate review deployment or second trusted pool in the backend | Backend and infrastructure changes; more complexity than linking |
| Company Microsoft 365 (Entra ID) as the provider | Possible, but MFA exclusions for one user need Conditional Access licensing; a review pool is simpler and free |

The linked review provider is the smallest option that keeps mandatory MFA for every real user.

### Proposed reviewer permissions (fictional agency only)
Role `officer`, with that agency's officer permissions set to: `view_fleet`,
`perform_fleet_inspections`, `view_inventory`, `firearm_custody.check_in`,
`firearm_custody.check_out`, `firearm_custody.view_history`, `score_range_days`,
`submit_off_duty_requests`. Features: `fleet`, `equipment_readiness`, `firearms`, `inventory`,
`range_training`, `qualifications` (**CONFIRM** `fleet` and `inventory` exist in `feature_catalog`).
Never grant: `administer_department`, `manage_users`, password management, `view_audit_log`,
manage/override permissions, or platform administration. Equipment check-out/in and Inbox need
no extra permission. Seed firearm assignments to the reviewer so the firearms list is populated.
Note: the mobile home screen does not hide modules the user lacks; every module above must be
enabled and populated so reviewers do not see "not permitted" screens.

### Reviewer sign-in instructions (to paste into both consoles once set up)
1. Open TracePoint and tap **Continue with TracePoint**.
2. On the sign-in page, choose **TracePointAppReview**.
3. Enter the username and password provided in the credentials fields.
4. If asked, choose the agency **[fictional agency name]**.
No verification code is required for this account.

## 6. Apple App Review notes (draft)

> TracePoint Public Safety is an operations app for public safety agencies. Accounts are created by
> each agency's administrator; the app has no public sign-up. Please use the demo account provided,
> which belongs to a fictional demonstration agency containing only fictional records.
> Sign in: tap "Continue with TracePoint", choose "TracePointAppReview", and enter the provided
> credentials. No verification code is needed for this demo account.
> Suggested review path: Home → Inbox; Fleet → open a vehicle → start an inspection (camera is used
> only to attach evidence to a failed checklist item); Equipment → check an item out and back in;
> Inventory; Firearms (assigned items); Range Days → open a range day → scoring workspace.
> QR scanning: use Scan and point the camera at one of the attached demo QR codes.
> Camera is used for QR scanning and inspection evidence; microphone only for the audio of a short
> inspection video; Face ID only to unlock the app locally. The app does not use location,
> tracking, or advertising. Accounts are provisioned only by agencies; the app does not offer account
> creation, so users request deactivation through their agency or support@tracepointhq.com.
> TracePoint serves multiple independent public safety agencies. Privacy policy:
> https://tracepointhq.com/privacy

## 7. Remaining blockers and risks

Blocking submission
- `/privacy` is not live (production still redirects it to sign-in) and the policy has unresolved
  owner confirmations; a production build refuses to publish it until they are resolved.
- No working reviewer access in either store (section 5).
- No store build contains the in-app privacy link; new builds from mobile `5b4e160` are needed.
- Store assets: real iPhone 6.9" screenshots, at least 2 Android phone screenshots, a 1024×500
  Google feature graphic, descriptions, and the completed privacy/content questionnaires.

Risks to resolve or accept
- Apple developer account is an **Individual** account (team `BHRBP525FV`, "Jason Phares"). The
  App Store will show the individual as the seller while the policy names the company. Either
  accept this or enroll an Organization account (requires a D-U-N-S number) before submission.
- Apple 5.1.1(v) account deletion applies to apps that support account creation. TracePoint
  accounts are created only by agencies, so it should not apply; state this in the review notes.
  Apple's guidance does not address organization-provisioned accounts explicitly.
- Apple may question whether an app limited to agency personnel belongs on the public App Store;
  the review notes explain that it serves multiple independent agencies.
- Sentry's data processing addendum must be accepted in Sentry (Legal & Compliance) by an owner;
  it is not automatic. Sentry's data region is visible only in the Sentry organization settings.

## 8. Staging rehearsal of reviewer access (performed 2026-10-17; rolled back — see section 5 results)

Scope: staging account `559054714699`, staging pool behind
`tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com`, staging mobile client
`5s8l4b8jt4vi8oubbj9m6dabbj`, staging API `https://staging.tracepointhq.com`. No production change,
no deployment, no mobile build.

Before changing anything, save `describe-user-pool-client` output for the staging mobile client:
`update-user-pool-client` resets every setting that is not passed, so the change and the rollback
must resend the full saved configuration.

Changes
1. Create review pool `tracepoint-staging-app-review` (MFA off, admin-create only, email
   username), a domain, a confidential app client with secret (code grant; scopes `openid email
   profile`; callback `https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`),
   and one user with a permanent random password and the reviewer email.
2. Staging pool: `create-identity-provider` OIDC `TracePointAppReview` (issuer = review pool,
   `client_secret_post`, attributes request method GET, scopes `openid email profile`, mapping
   `email`→`email`).
3. Staging mobile client: add `TracePointAppReview` to `SupportedIdentityProviders`, resending the
   saved configuration unchanged otherwise.
4. Staging TracePoint: fictional agency, features, officer permissions, reviewer invite with the
   same email, activation through the activation link.
5. `admin-link-provider-for-user` (destination `Cognito`/local username; source
   `TracePointAppReview`/`Cognito_Subject`/review-pool `sub`).

Test procedure and expected results (a local script performs the authorization-code + PKCE
exchange; the browser shows the redirect code)
| # | Test | Expected |
|---|---|---|
| T1 | Staging web sign-in page | No review provider button |
| T2 | Staging mobile client sign-in page | `TracePointAppReview` button beside local sign-in |
| T3 | Sign in through the provider | No TOTP prompt; access token `sub` = local user's `sub`, `client_id` = mobile client, scope includes `aws.cognito.signin.user.admin` |
| T4 | `GetUser` with that token | Succeeds; local username |
| T5 | `POST /api/mobile/session` | 200, one membership (fictional agency), no selection prompt |
| T6 | Inbox, inventory, firearms, fleet, equipment, range days, range workspace; QR resolve of a demo code | 200 with fictional data |
| T7 | Password reset, user management, other agency's id in `x-tracepoint-department-id`, support-mode header | Refused (401/403/400) |
| T8 | Refresh-token grant, then `POST /api/mobile/session` with the new token | New token accepted |
| T9 | Mobile logout plus `/oauth2/revoke` | Next request 401; refresh fails |
| T10 | Fresh sign-in, then `admin-user-global-sign-out` on the local user | Next request 401 (GetUser fails); refresh fails |
| T11 | Deactivate the reviewer membership in TracePoint | Session establishment refused |
| T12 | `admin-disable-provider-for-user` (unlink), sign in through the provider again | New unlinked Cognito user; backend 401 (no identity link) |
| T13 | Existing staging local user signs in | Still challenged for TOTP |
| T14 | Linked local user tries local password sign-in | Still challenged for TOTP |

Pass criteria: T1–T14 all as expected. Any deviation stops the rollout.

Rollback (staging): resend the saved mobile-client configuration (removes the provider);
`delete-identity-provider`; `admin-disable-provider-for-user`; deactivate the reviewer membership;
delete the review pool's domain, then the review pool. Fictional agency records can remain as
staging test data or be deactivated.

Cost: $0 expected (federated MAUs within Cognito's free 50; no EAS or compute cost). Time: about
two hours including the fictional agency setup.

## 9. Release sequence (dependency order)

| Step | Action | Needs | Gate to continue |
|---|---|---|---|
| 1 | Owner resolves the policy confirmations in `src/app/privacy/policy-content.ts` | Owner | No `[[OWNER: …]]` left; tests pass; local commit |
| 2 | Deploy web `/privacy` with `deploy-app.ps1` (CodeBuild image from the reviewed commit, then ECS update with automatic rollback) | Approval | `/privacy` 200 without sign-in; `/api/health`, `/support` 200; mobile APIs unchanged |
| 3 | Staging rehearsal of reviewer access (section 8) | Done | Passed except unlinking, which is excluded from the revocation procedure; staging rolled back |
| 4 | Production reviewer access: review pool, provider on the mobile client only (map `email` and `email_verified`), fictional agency with only the needed features, demo data and QR codes, reviewer activation (must end `CONFIRMED`) and link | Approval | Repeat T3–T11 against production with the reviewer only, including one request proving production’s registration-time membership check |
| 5 | Final mobile verification of `5b4e160` (privacy link opens the live page) | — | Tests pass; link target live |
| 6 | EAS production builds from `5b4e160` (iOS build 7, Android versionCode 5); upload iOS; upload Android versionCode 5 into the existing production draft (manually in Play Console, or with EAS Submit if a service account is added) | Approval (EAS cost) | Builds finished; Apple processing complete |
| 7 | Screenshots from the fictional agency, feature graphic, descriptions, App Privacy and Data safety, age/content rating, reviewer credentials and notes | Owner | All required fields complete in both consoles |
| 8 | Submit: Apple "Manually release this version"; Google "Managed publishing" | Owner | Both stores show "Waiting for review" / "In review" |

## 10. Console checklist

App Store Connect
- [ ] Privacy Policy URL and Support URL; App Privacy answers; age rating questionnaire
      (**CONFIRM**: proposed no objectionable content — firearms appear only as agency
      administrative records).
- [ ] iPhone 6.9" screenshots (1320×2868 or 1290×2796), captured on a device signed in to the
      fictional agency. iPad screenshots are not required (the app is iPhone-only).
- [ ] Description, keywords, promotional text, category (**CONFIRM**: Business or Productivity).
- [ ] Select the new build (from `5b4e160`); App Review contact; demo account; notes (section 6).
- [ ] Version release: **Manually release this version**. Then Submit for Review.

Google Play Console
- [x] First bundle (versionCode 4) uploaded and a production release draft created (owner, done).
- [ ] Upload versionCode 5 (from `5b4e160`) and swap it into the production draft in place of
      versionCode 4.
- [ ] Store listing: short and full description, 512×512 icon (exists:
      `TracePoint-Icon-Release-20261015-221734/tracepoint-google-play-512.png`), 1024×500
      feature graphic (missing), at least 2 phone screenshots from the fictional agency.
- [ ] App content: privacy policy URL, Data safety (section 3), App access (section 5
      instructions and credentials), Ads: none, Target audience: 18+, content rating
      questionnaire, government-app declaration (**CONFIRM**: proposed no — TracePoint is a
      private vendor).
- [ ] Publishing overview: turn on **Managed publishing**, then send the production release for
      review.

Nice-to-have, not blocking: clear inspection drafts on sign-out; remove the unused photo-library
permission string; consider stripping photo location metadata on upload.

## 11. Owner decision list for the privacy policy

Each item maps to one `[[OWNER: …]]` marker or store setting. A production build will not publish
`/privacy` until every marker is resolved.

| # | Decision or input | Who | Notes |
|---|---|---|---|
| 1 | Registered legal entity name and mailing address | Owner | From formation documents; no document in the repositories establishes it. |
| 2 | App Store seller identity | Owner | The Apple developer account is Individual ("Jason Phares"). Accept, or enroll an Organization account (needs a D-U-N-S number). |
| 3 | Privacy contact | Owner | Confirm support@tracepointhq.com (Microsoft 365) is monitored for privacy requests, or name another monitored address. |
| 4 | TracePoint's role | Owner / counsel | Approve the description in section 1 of the policy. It mentions no DPA or CJIS agreement; say if one exists. |
| 5 | Sentry | Owner | Read the data region in Sentry organization settings; accept Sentry's DPA under Legal & Compliance (owner or billing role). |
| 6 | Backup retention | Read-only check | AWS Backup plan retention for the production database (needs a fresh production sign-in). |
| 7 | Manual database snapshots | Owner | Decide how long to keep the two pre-migration snapshots, then state it. |
| 8 | Request and firewall log retention | Read-only check | Live WAF and load-balancer log retention (needs a fresh production sign-in). |
| 9 | End of service | Owner | How long an agency's data is kept after its agreement ends, and whether it is returned or deleted. Only what TracePoint can actually do today. |
| 10 | Effective date | Owner | The actual publication date, set when the web deployment is approved. |
