# Native client: staging build and compatibility run (owner checklist)

- **Purpose:** produce a native iOS/Android build pointed at staging, so the owner can run the native parts of `STAGING-VERIFICATION.md` §4 (S2–S5, S17, S24) and rows C1–C32 of `NATIVE-CLIENT-CONTRACT-CHANGES.md` §4. This is option B of that file's §5.
- **Sources (read-only):**
  - `jphares65/tracepoint` @ `origin/claude/integration-defects-20261020`, plus the `codex/*mobile*` and `codex/staging-native-*` branches;
  - `jphares65/tracepoint-landing` (`main` and `claude/tracepoint-operational-audit-w567t8`);
  - the CDK in `infra/`.
- **The client source is not in either repository** (owner: "Local / not pushed"). Neither repository has an `app.json`, `eas.json`, Xcode project, Gradle file, `Info.plist`, bundle identifier, Android `applicationId`, TestFlight or Play reference, `apple-app-site-association` or `assetlinks.json`. Everything about the build itself (§3) therefore has to come from the owner's local client project. The server-side values (§1–§2) are defined here.

## 1. Values the build must point at

None of these is a secret. Client ids and the pool id are configuration. Do not put any secret into the app: the mobile client has none.

| Setting | Staging value / how to obtain | Defined in |
|---|---|---|
| API base URL | `https://staging.tracepointhq.com`. The TLS certificate is for this host; do not use the ALB DNS name (`LoadBalancerDnsName` output). | `scripts/deploy-app.ps1` (`Host`), `infra/lib/cognito-foundation-stack.ts` (`site`), `scripts/test-staging-image-mobile-routes.sh` (`NEXT_PUBLIC_SITE_URL`) |
| AWS region | `us-east-1` | `infra/bin/staging-cognito-foundation.ts`; enforced in `cognito-runtime-configuration-core.ts` |
| Cognito user pool id | Stack `tracepoint-staging-cognito`, output **`UserPoolId`** (`us-east-1_…`), pool name `tracepoint-staging` | `cognito-foundation-stack.ts` |
| Mobile app client id | Stack `tracepoint-staging-cognito`, output **`MobileClientId`**, client name **`tracepoint-staging-mobile`**. The same value is in the runtime task definition as `TRACEPOINT_COGNITO_MOBILE_CLIENT_ID`. **Not** the `ClientId` output (`tracepoint-staging-web`): the server verifies mobile bearers only against the mobile client id and refuses a mobile id equal to the web id. | `cognito-foundation-stack.ts` (`MobileApplication`), `infra/lib/runtime-stack.ts`, `parseCognitoMobileTargetConfiguration` |
| Hosted UI (managed login) domain | Stack `tracepoint-staging-cognito`, output **`ManagedDomain`**. The prefix is `tracepoint-staging-<account>`, so it should read `https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com`; confirm against the output. Endpoints: `/oauth2/authorize`, `/oauth2/token`, `/oauth2/revoke`, `/logout`. | `cognito-foundation-stack.ts` (`addDomain`) |
| Redirect (sign-in callback) URI | `tracepoint://auth` | §2 |
| Sign-out URI | `tracepoint://logout` | §2 |
| OAuth scopes to request | `openid email profile aws.cognito.signin.user.admin`. The last one is required: `/api/mobile/**` calls Cognito `GetUser` with the access token, which needs that scope. Without it, every call returns 401. | `cognito-foundation-stack.ts`; `cognito-mobile-session.ts` |

How to read the outputs (read-only, staging SSO profile `tracepoint-member-staging`, role `TracePointMigrationStaging`, account `559054714699`):

```sh
aws cloudformation describe-stacks --stack-name tracepoint-staging-cognito --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'||OutputKey=='MobileClientId'||OutputKey=='ManagedDomain']"
aws cognito-idp describe-user-pool-client --region us-east-1 --user-pool-id <UserPoolId> --client-id <MobileClientId> \
  --query "UserPoolClient.{name:ClientName,callbacks:CallbackURLs,logout:LogoutURLs,flows:AllowedOAuthFlows,scopes:AllowedOAuthScopes,authFlows:ExplicitAuthFlows,rotation:RefreshTokenRotation,secret:ClientSecret}"
```

Two CDK entry points define this stack under the same name, `tracepoint-staging-cognito`:
- `infra/bin/staging-cognito-foundation.ts`;
- `infra/bin/tracepoint-infra.ts` with `environment=tracepoint-staging`, which builds `${environmentName}-cognito`.

Both pass the same mobile client, so the outputs are the same either way.

## 2. Server contract the build must follow (staging)

**Registered URIs (per CDK)**
- The mobile client allows exactly one callback, `tracepoint://auth`, and one sign-out URI, `tracepoint://logout`.
- `CognitoFoundationStack` **throws** for any other value, so other URIs cannot be added by configuration alone. Examples:
  - an Expo `exp://…` or `<scheme>://…/--/` dev URI;
  - a reverse-DNS scheme such as `com.example.app://`;
  - an `https` universal link.
- `infra/test/provider-foundations.test.ts` asserts these exact lists. The acceptance script on `codex/mobile-v1-backend-integration-20260914` (`infra/scripts/run-aws-native-staging-acceptance.mts`) checks them live with `DescribeUserPoolClient`.
- **Owner check:** the client's configured redirect must be byte-identical: lower-case `tracepoint`, the path `auth`, no trailing slash. If it is not, the build must change, or the CDK guard and its test must change. That is an infrastructure change and needs its own approval.

**Client type and token lifetimes**
- Public client: `GenerateSecret: false`, authorization-code grant only, so use PKCE (S256).
- `ExplicitAuthFlows: ALLOW_USER_SRP_AUTH`, so direct SRP sign-in, as in the acceptance script, also works.
- Hosted-UI auth session: 3 minutes (`AuthSessionValidity: 3`).
- Access and ID tokens: 5 minutes. Refresh token: 1 day, **rotating**:
  - `RefreshTokenRotation ENABLED`, 10 s grace;
  - store the new refresh token from every refresh response;
  - testers re-sign in daily.
- Refresh through `POST <ManagedDomain>/oauth2/token` with `grant_type=refresh_token`, as the acceptance script does.

**MFA and accounts**
- MFA is **required**, TOTP only. Every synthetic tester needs an authenticator app.
- No self sign-up: accounts are created by invitation.
- The password minimum is 14 characters, with all character classes.

**Session establishment**
1. Call `POST /api/mobile/session` with `Authorization: Bearer <Cognito ACCESS token>` (one bearer; not the ID token).
2. Optional headers:
   - `X-TracePoint-Department-Id: <uuid>`;
   - `X-TracePoint-Support-Mode: true|false` (`true` needs the department id and a platform administrator).

The server registers each access token's `jti` as a durable session only on this route (`establish: true`). Other `/api/mobile/**` routes accept only an already-registered token. **After every refresh, call `/api/mobile/session` with the new access token before any other call.** Otherwise the other routes return 401.

| Response | Body |
|---|---|
| 401 | `{"error":"Authentication is required."}`. This includes a *pending* invitee: the mobile path resolves only `active` identity links (C23). |
| 400 | invalid department id or Support Mode header |
| 403 | `"No active department membership was found."` |
| 200 | `{selectionRequired:true, memberships:[…]}` when the user has more than one agency and none was selected, then re-call with the header; otherwise `{selectionRequired:false, platformAdmin, memberships, access}`. A platform administrator without memberships gets `supportAgencies`. |

**All other calls**
- Send the same `Authorization` and `X-TracePoint-Department-Id` headers to the `/api/mobile/**` routes in the contract file §0.
- A bearer token is honoured **only** under `/api/mobile/`. On any other path it returns 401 (`server-access.ts`). The app must not call web routes such as `/api/fleet/...` directly.

**Sign-out**
1. `POST /api/auth/mobile/logout` with the bearer revokes the server session. It returns `{ok:true}` or 401 `"Mobile authentication is required."`.
2. Then call `<ManagedDomain>/oauth2/revoke` (`client_id`, refresh `token`).
3. Optionally open `<ManagedDomain>/logout?client_id=<MobileClientId>&logout_uri=tracepoint://logout`.

**Deep links**
- The `tracepoint://` scheme also carries printed QR label values: `tracepoint://vehicle/<id>` and `tracepoint://equipment/<id>` (`qr-identifiers.ts`).
- If the app registers the scheme, a label scanned with the system camera will open the app with that URL. The URL handler must route `auth` and `logout` to sign-in and treat `vehicle` and `equipment` as a QR resolve, or ignore them.
- No universal or app links exist (no `.well-known` files in `public/` of either repository).

**Production and local**
- **No mobile client exists for production.** `tracepoint-infra.ts` passes `mobileClient: undefined` for production, and the CDK refuses a mobile client outside staging. This checklist is staging-only.
- `src/proxy.ts` sends CORS headers only to `http://localhost:*` and `http://127.0.0.1:*` origins, which is the local mobile preview. A native build sends no `Origin`, so CORS does not affect it.

## 3. Producing the staging build (owner, in the local client project)

1. **Check out the right commit.** Use the client commit or tag built against server baseline `555f061` (`origin/codex/staging-mobile-api-release-20261007`, the contract file's baseline). Record its SHA in the §6 evidence.
2. **Set the §1 values** in the client's staging environment or config profile:
   - API base URL;
   - region;
   - `UserPoolId`;
   - `MobileClientId`;
   - `ManagedDomain`;
   - redirect `tracepoint://auth` and sign-out `tracepoint://logout`;
   - the four scopes.

   Take the values from the `describe-stacks` output above. Do not copy them from another environment.
3. **Confirm the scheme registration.** `tracepoint` must be registered as a URL scheme: iOS `CFBundleURLTypes`; Android an intent filter with `android:scheme="tracepoint"`, or the Expo `scheme` if the app uses Expo. It must match the redirect exactly.
4. **Give the staging build its own identity**, if the client supports per-environment identifiers: a distinct bundle id / `applicationId` suffix and app name (for example "TracePoint Staging"), so it can sit beside any other build. Neither repository records the identifiers. The owner supplies:
   - Apple Team ID and bundle id;
   - Android package name;
   - signing (App Store Connect / Play Console access).
5. **Build** with the client's own tooling: Xcode archive or `eas build --profile <staging>` for iOS; Gradle `assembleRelease`/`bundleRelease` or EAS for Android. Disable any offline queue replay against production endpoints.
6. **Smoke test before handing out.**
   1. Sign in with a synthetic user (TOTP).
   2. `POST /api/mobile/session` returns 200.
   3. Wait for more than 5 minutes so a refresh happens. The next call still works, which proves re-establish after refresh.
   4. Sign out. Then `/api/mobile/inbox` with the old token returns 401.

## 4. Distribution options

| Option | Use when | Notes |
|---|---|---|
| **iOS TestFlight, internal testing** | Testers are App Store Connect users of the team | Fastest signed path; no external beta review; up to 100 internal testers. Needs an App Store Connect app record for the staging bundle id. |
| iOS ad hoc / development build | Few devices with known UDIDs | Register devices in the developer account. |
| iOS Simulator build | The operator runs S-steps on a Mac | No camera, so S4 label scans must be typed or pasted into the scanner's manual entry (if the app has one) or done on a device. TOTP works with an authenticator on a phone. |
| **Google Play internal testing track** | Testers have Google accounts on the tester list | Needs a Play Console app for the staging package name; available within minutes. |
| Android APK sideload / emulator | Quick check or no Play Console access | Emulator camera is limited (S4, as on the iOS simulator). |

Record the build number, distribution channel and tester list in the §6 evidence of `STAGING-VERIFICATION.md`.

## 5. Synthetic accounts and data on staging

Rules:
- Only `acceptance-<UUID>` tenants and generated users (`STAGING-VERIFICATION.md` §0).
- Every account is invited through the web and completes **first sign-in on the website**, including the ≥14-character password and TOTP enrolment, before using the app. A pending invitee is refused by `/api/mobile/session` (C23).

| Account (agency A unless noted) | Needed for |
|---|---|
| Inspector-only (role with `perform_fleet_inspections`, not an administrator, no maintenance permission) | S2, S4a, S15, C14–C17 |
| Officer eligible only through a configured inspection role | S4b, C7, C16 |
| `view_fleet` viewer **not** in the configured inspection roles | S4c, C7, C16, C20 |
| Officer with `view_fleet` while the inspection-role list is empty | S16 / C16, C17 |
| Fleet manager | S2 setup (set the vehicle Available with override), S12, S15 (costs present) |
| Mechanic | S12 |
| Plain officer A with Equipment Readiness on (custody pool) | S3 check-out/check-in, S24-3 |
| Plain officer B | S3 (looks up officer A's held item: 404) |
| Officer holding a firearm | S4 (held firearm: `denied`) |
| Officer with no firearm read | S4 (firearm serial: same body as a non-existent value) |
| Range instructor with only `score_range_days`, plus a range manager | S5, S21, S24-5, C9–C11, C25–C27 |
| A second user on another device or browser, same agency | S5 stale save (C10) |
| Member holding a certification valid until next year | S17 |
| Command staff with a training event 3 days out | S24-1 (web) |
| User in a **second** synthetic agency | S10 cross-tenant checks for S2–S4 |
| One pending invitee (invited, never signed in) | C23 |
| One officer to deactivate while signed in on the app | C21 (B1 step 4) |

Seed data:
- printed vehicle and equipment labels (`tracepoint://vehicle|equipment/<id>`);
- two equipment assets sharing a serial (409);
- a vehicle with all six date fields set;
- one asset with `expiration_date` and one with only `issue_date`;
- a range day with saved scores;
- one work order with `reported_at = date_trunc('second', now())` (whole-second timestamp, S24-4);
- custody events on two different days (S24-3).

## 6. Compatibility checks to run with the build

Run each step **before** (the current staging image) and **after** (the 038–053 migrations plus the integration image), per `STAGING-VERIFICATION.md` §4. Capture HTTP traffic or app logs for the raw JSON. "Stop" means hold the deploy for a client update.

| Step | On the native build | Pass |
|---|---|---|
| **S2** | As the inspector-only user, submit a Critical inspection on a vehicle a manager set to Available. | 201 is shown as saved. Vehicle Out of Service. `audit.status` `recorded` is tolerated (C14). |
| **S3** | Officer A checks out a pool item, then returns it `damaged`. Officer B looks it up. | Both 200; the item shows out of service; B gets 404. 409 and 500 texts are shown (C19). |
| **S4** | Scan a vehicle label, an equipment label, a unit number, a serial, a duplicated serial, a no-read firearm and a held firearm. Repeat the vehicle scan as the S4a/b/c accounts. | Exact items. The duplicate gives 409, the message is shown and **no** item opens (C5). No-read equals non-existent; held gives `denied` (C6). For a/b, `allowed:true` opens the inspection for `entityId` (C7); for c, `denied`. |
| **S5** | Load the range workspace, save, correct a score, score after Ready, then make a stale save from the second device. | `resultRevisions` tolerated (C9). The stale save gets 409 `stale_workspace` and a reload prompt with no auto-retry (C10). Corrections save (C11). |
| **S17** | Open equipment expiry and vehicle inspection-due views. | `YYYY-MM-DD` parsed as a calendar date with no day shift, and statuses are current (C1, C2). **Stop** if parsing fails. |
| **S24** steps 3–5 | (3) Custody history across two days. (4) Inbox and vehicle detail; record the raw JSON and include the whole-second value. (5) Live scoring with a stale `…Z` `baseUpdatedAt` cached before the deploy. | (3) Newest first. (4) `…[.ffffff]+00:00` parsed, including whole seconds (C31). (5) First save 200, stale save 409. **Stop** if (4) fails. |
| S10 | Cross-tenant attempts from S2–S4 with the second agency's user | Every attempt denied or `unknown` |

Contract rows C1–C32 (details in `NATIVE-CLIENT-CONTRACT-CHANGES.md` §4). Each row is checked within the step shown.

| Row | Check on the build | Step |
|---|---|---|
| C1 | `YYYY-MM-DD` date fields parse; both forms inside `history[].details` | S17, vehicle list and detail |
| C2 | Readiness equipment dates, statuses and counts; no stale cache | S17 (asset with expiry versus issue-date only) |
| C3 | Raw printed label posted to `qr/resolve` resolves | S4 |
| C4 | Unit, VIN, asset and serial scans now return decisions, not errors | S4 |
| C5 | 409 ambiguous: message shown, nothing opened, no retry | S4 |
| C6 | Navigate only on `allowed:true`; `unknown`/`denied` show `message` | S4, S10 |
| C7 | Vehicle scan `allowed:true` opens the inspection workflow | S4a/b |
| C8 | A 500 shows the `error` text (operations: 045 applied before the image) | S4 after deploy |
| C9 | Workspace GET with `updatedAt` and `resultRevisions` loads | S5 |
| C10 | PUT `baseUpdatedAt` as the exact string or null; 409 `stale_workspace` means reload | S5 |
| C11 | Corrections and post-Ready scores save (former 409 → 200) | S5 |
| C12 | Work orders without cost fields decode, for the inspector | S15 |
| C13 | `safetyHold` and `vehicle.safety_hold_*` tolerated | S12 |
| C14 | 201 `audit {status,message?}` and `readiness.safetyHold` tolerated | S2, S11 |
| C15 | 500 with `ok:false` or `inspection` means saved: no resubmit or offline replay | S2b fault drill (new) |
| C16 | 403/404 inspection refusals shown; eligibility comes from the QR decision | S16, S2 |
| C17 | Blank mileage/hours sent as null or omitted, never 0 | Inspection with mileage blank (new) |
| C18 | Custody GET by equipment label | S4, S3 |
| C19 | Custody 409/500 texts shown; item refreshed after a 409 | S3 |
| C20 | Fleet list that was empty now populated for eligible inspectors | S16 |
| C21 | After deactivation, 401 returns to sign-in with no refresh loop | B1 step 4 (new) |
| C22 | Unknown inbox `kind` (`fleet_audit_pending`) tolerated; `href` used as given | S11 follow-on |
| C23 | Pending invitee: app tells the user to finish first sign-in on the web | S1 |
| C24 | Logout, session shape, drill documents, attachments, range-days, evidence unchanged | S10; inspector-only evidence upload (new) |
| C25 | 400 impossible score: text shown, no retry | S21 |
| C26 | Instructor attendance and walk-up controls work (or stay hidden) | S21 |
| C27 | `firearmTypeSnapshot` optional; statuses not cached | S21, S5 |
| C28 | Armory web-route changes (only if the app calls web routes; bearer is refused there) | S22 |
| C29 | Admin web-route changes (same condition) | S23 |
| C30 | ADM-07 409 text (same condition) | S23-3 (revised) |
| C31 | Timestamps `…[.f0–6]+00:00` parsed, whole seconds included | S24-3–5 |
| C32 | B8a web-route additions (same condition) | S22a |

C28–C30 and C32 apply only to web routes. Because a bearer token is refused outside `/api/mobile/` (§2), a native app that works today cannot be calling them. Record "not called" if traffic capture confirms this.

## 7. Open items for the owner

1. Provide the client project (or the build) and the identifiers listed in §3.4. None of them exists in either repository.
2. Confirm that the client's redirect and sign-out URIs are exactly `tracepoint://auth` and `tracepoint://logout`, and that it requests `aws.cognito.signin.user.admin`.
3. Confirm that the client calls `/api/mobile/session` after each token refresh (§2).
4. Decide the distribution channel (§4) and the tester list. Each tester needs TOTP.
5. Production has no mobile Cognito client. Any production native release needs a separate infrastructure decision.
