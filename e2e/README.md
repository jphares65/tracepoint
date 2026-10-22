# Authenticated staging workflows (Playwright)

These tests sign in to **staging** through the real Cognito managed login (password + TOTP MFA) as dedicated synthetic accounts, and drive the release-safety workflows (UX-RB) through the UI, with the application's real authorization. They are the UI half of the regression gate in `docs/remediation/UX-RB.md`.

## Safety rules (enforced in code)

- **Never production.** `support/env.ts` refuses `tracepointhq.com` and `www.tracepointhq.com`. The default target is `https://staging.tracepointhq.com`.
- **Synthetic agency only.** After every sign-in, `/api/access` must return exactly `TRACEPOINT_E2E_DEPARTMENT_ID` and `TRACEPOINT_E2E_DEPARTMENT_NAME`, and must not be in support mode. Otherwise the run aborts before anything is created.
- **No authentication shortcuts.** There is no test-only login route, no token injection and no relaxed MFA. Sessions come from the normal sign-in.
- **Records are labelled.** Everything the tests create is named `E2E <run id>` (firearms, range days, vehicles, storage locations).
  - Range results cannot be deleted (B3 keeps score history), so use a staging agency that holds only synthetic data.
  - The vehicle test changes the agency's fleet rule "defect creates work order" and restores it afterwards.

## Accounts

Create one Cognito user per role in the synthetic staging agency, each with a TOTP authenticator, and grant only these permissions:

| Role key | Purpose | Permissions needed |
|---|---|---|
| `MANAGER` | Seeds range days, firearms, restrictions, storage locations | `manage_range_days`, `manage_firearms`, `manage_firearm_restrictions` (or `administer_department`) |
| `INSTRUCTOR` / `INSTRUCTOR2` | Two scoring devices | `score_range_days` only (the default Instructor role) |
| `ARMORER` | Firearm inspection | `manage_firearms` or `manage_inspections` |
| `OFFICER` | Assigned officer: custody, vehicle inspection, range shooter | No admin permissions; `view_fleet` with an empty inspection-role list, or listed in it |
| `FLEET_MANAGER` | Creates the test vehicle and toggles the fleet rule | Fleet management and fleet rules |

## Credentials

Provide credentials as environment variables only, never in files. In CI, store them as secrets of a protected GitHub Environment (for example `staging-e2e`, with required reviewers).

```
TRACEPOINT_E2E_BASE_URL=https://staging.tracepointhq.com          # optional; production is refused
TRACEPOINT_E2E_DEPARTMENT_ID=<synthetic agency uuid>
TRACEPOINT_E2E_DEPARTMENT_NAME=<synthetic agency name>
TRACEPOINT_E2E_<ROLE>_EMAIL=...
TRACEPOINT_E2E_<ROLE>_PASSWORD=...
TRACEPOINT_E2E_<ROLE>_TOTP_SECRET=<base32 authenticator secret>
```

`<ROLE>` is one of `MANAGER`, `INSTRUCTOR`, `INSTRUCTOR2`, `ARMORER`, `OFFICER` or `FLEET_MANAGER`.

How the credentials are handled at run time:
- Sessions are written to `e2e/.auth/` for the duration of the run. That directory is git-ignored; delete it after the run.
- The TOTP secret is used in memory only (`src/lib/testing/totp.ts`, which is RFC 6238 and checked against the RFC test vectors).
- A spec whose roles are not configured is skipped, and the skip names the missing accounts.

## Run

```
npm run test:e2e:staging                      # desktop and phone (390x844) projects
npx playwright test -c e2e/playwright.config.ts range-concurrency.spec.ts
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome npm run test:e2e:staging   # when the bundled browser differs
```

The phone project runs the specs tagged `@field`.

## What each spec proves

| Spec | Staging step | Proves |
|---|---|---|
| `auth.spec.ts` | — | Each role signs in through Cognito with MFA and resolves to the synthetic agency |
| `range-completion.spec.ts` | S25 | Completion starts Not recorded; a note alone cannot be saved; Complete is stored as complete with no deficiency (UX-RB-1) |
| `firearm-inspection.spec.ts` | S26 | An untouched form cannot be saved; every item and the result are explicit; the status effect is stated (UX-RB-2) |
| `vehicle-inspection.spec.ts` | S27 | Vehicle checks start Not inspected; a critical defect with no work order is reported Out of Service (UX-RB-2, UX-RB-3) |
| `firearm-custody.spec.ts` | S28 | The record page transfers to secure storage and back; history shows the reason and notes (UX-RB-4) |
| `range-concurrency.spec.ts` | S29 | Two instructors keep both scores; a same-officer edit is a visible conflict, resolved without loss (UX-RB-5) |
| `range-validation.spec.ts` | S30 | An impossible score is stopped on the officer's row; a valid one saves (UX-RB-6) |

The first run against staging confirms the selectors. Several steps rely on page labels (tabs, card titles) that could not be observed without access. Fix any failure that is a selector failure, not a product failure, before the before/after evidence is recorded.
