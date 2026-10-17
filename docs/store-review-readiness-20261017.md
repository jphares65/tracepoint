# TracePoint Public Safety — store review readiness (2026-10-17)

Status: prepared locally for owner review. Nothing here has been published, submitted,
or applied to production. Items marked **CONFIRM** need the owner's decision before use.
This document contains no credentials or secrets.

## 1. Builds

| | Current store builds | Required for review |
|---|---|---|
| iOS | 1.0.0 (5) from `98e6e8a` (old device name); 1.0.0 (6) from `1bec3eb` (name "TracePoint"), both uploaded to App Store Connect | New build from mobile `5b4e160` (adds the in-app Privacy Policy link). Apple 5.1.1(i) requires the policy to be reachable in the app. |
| Android | versionCode 3 from `98e6e8a`; versionCode 4 from `1bec3eb` (not uploaded) | New build from mobile `5b4e160`. Google's User Data policy requires the policy inside the app. |

Order: publish the web `/privacy` page first (the in-app link opens it), then build both apps from
`5b4e160`, then submit. Builds 5/6 and versionCodes 3/4 must not be submitted.

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

### Constraint
The production Cognito pool requires TOTP MFA for every local user (`MfaConfiguration: ON`;
TOTP only; admin-created accounts only). Cognito cannot exempt one local user. The backend binds a
verified production-pool access token to a TracePoint user through an active identity link and
calls Cognito `GetUser`; it does not inspect how the user authenticated. Sharing a TOTP setup key
was rejected. Turning MFA to optional would weaken every agency. Therefore no reviewer access is
possible without one approved production change.

### Recommendation: isolated review identity provider, linked to one demo officer
1. Create a separate Cognito user pool used only for store review (`tracepoint-app-review`):
   one user, administrator-created, no self sign-up, long random password stored only in the
   owner's password manager and the store consoles' credential fields.
2. Add that pool to the production pool as an OIDC identity provider ("TracePoint App Review") and
   enable it **only on the mobile app client** (`tracepoint-production-mobile`). The web client and
   every existing local user are unchanged and keep mandatory MFA.
3. Create a fictional agency (plan type `internal`, clearly fictional name — not Readington or
   Montville, which are real tenants) and invite one reviewer user through the normal invite flow
   with the `officer` role only. The owner completes its first activation once (with MFA).
4. Link the review-provider identity to that reviewer's Cognito user with
   `AdminLinkProviderForUser`. Federated sign-in then issues tokens for the existing local user, so
   the existing identity link applies and **no backend code changes** are needed.
5. Seed only fictional records in that agency and print its QR codes for the review notes.

Why this is acceptable: existing users and agencies are untouched; the review identity can reach
only one fictional agency with officer-level permissions; the access path can be removed by
unlinking the provider and disabling it on the mobile client; nothing bypasses backend
authorization.

Must be proven in staging before production (all are fail-closed if wrong):
- a linked federated sign-in is not prompted for MFA and receives tokens for the linked user;
- `GetUser` succeeds for that access token (the mobile session check calls it);
- the hosted sign-in page shows the review provider only on the mobile client.
If `GetUser` fails for federated sessions, stop: the only remaining options are a backend change or
a different review arrangement, both requiring a new decision.

### Proposed reviewer permissions (fictional agency only)
Role `officer`, with that agency's officer permissions set to: `view_fleet`,
`perform_fleet_inspections`, `view_inventory`, `firearm_custody.check_in`,
`firearm_custody.check_out`, `firearm_custody.view_history`, `score_range_days`,
`submit_off_duty_requests`. Features: `fleet`, `equipment_readiness`, `firearms`, `inventory`,
`range_training`, `qualifications` (**CONFIRM** `fleet` and `inventory` exist in `feature_catalog`).
Never grant: `administer_department`, `manage_users`, password management, `view_audit_log`,
manage/override permissions, or platform administration. Equipment check-out/in and Inbox need
no extra permission. Seed firearm assignments to the reviewer so the firearms list is populated.

### Reviewer sign-in instructions (to paste into both consoles once set up)
1. Open TracePoint and tap **Continue with TracePoint**.
2. On the TracePoint sign-in page, choose **TracePoint App Review**.
3. Enter the username and password provided in the credentials fields.
4. If asked, choose the agency **[fictional agency name]**.
No verification code is required for this account.

## 6. Apple App Review notes (draft)

> TracePoint Public Safety is an operations app for public safety agencies. Accounts are created by
> each agency's administrator; the app has no public sign-up. Please use the demo account provided,
> which belongs to a fictional demonstration agency containing only fictional records.
> Sign in: tap "Continue with TracePoint", choose "TracePoint App Review", and enter the provided
> credentials. No verification code is needed for this demo account.
> Suggested review path: Home → Inbox; Fleet → open a vehicle → start an inspection (camera is used
> only to attach evidence to a failed checklist item); Equipment → check an item out and back in;
> Inventory; Firearms (assigned items); Range Days → open a range day → scoring workspace.
> QR scanning: use Scan and point the camera at one of the attached demo QR codes.
> Camera is used for QR scanning and inspection evidence; microphone only for the audio of a short
> inspection video; Face ID only to unlock the app locally. The app does not use location,
> tracking, or advertising. Privacy policy: https://tracepointhq.com/privacy

## 7. Remaining submission checklist

Owner decisions and inputs
- [ ] Resolve every `[[OWNER: ...]]` item in `src/app/privacy/policy-content.ts` (legal entity
      and address, privacy contact, controller/processor role and DPA/CJIS, post-contract
      retention, photo location metadata, change-notification method, effective date).
- [ ] Approve deploying the web change (`/privacy`) to production.
- [ ] Approve the reviewer-access plan (section 5): staging rehearsal, then production Cognito
      change, fictional agency, reviewer invite, demo data.
- [ ] Approve new EAS production builds from mobile `5b4e160`.
- [ ] **CONFIRM** Data safety and App Privacy answers (sections 3–4).

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
- [ ] Upload the first AAB manually (no service account is configured in EAS) to the
      production track as a draft, or approve adding a service account for EAS Submit.
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
