# Appendix G – Runtime validation

_Executed against the October 7 `main` baseline (`a3677a6`). For executed verification against the current code line (`555f061`), see [reconciliation-20261020](reconciliation-20261020/README.md) §3–4 and R7._


Date: 2026-10-20. Repo: /home/user/tracepoint @ a3677a6 (Next.js 16.3.4, Node 22.22.0).
All logs/screens: /tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/runtime/
Repo tree: `git status --short` is empty after all work. No tracked files changed, no migrations, no deploys, no remote systems.

## 0. Environment caveats (read first)

1. **`npm ci` in the repo FAILS**: `E403 Forbidden GET https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (egress policy blocks the SheetJS CDN; retried once, same result). I did not route around the block.
   - Workaround: copied the source (no .git) to `scratchpad/runtime/work/`, removed only `xlsx` from that copy's package.json and lockfile, and ran `npm ci` there (it succeeded). **Every result below comes from that copy.** For `next build` I also added a non-functional local `xlsx` stub (it throws on use) to that copy's node_modules. As a result, nothing that uses xlsx was validated.
2. The sandbox runs as **root**, and the scratchpad is `0700 root`. Embedded Postgres has to run its binaries as the `postgres` user, so `initdb` fails with EACCES (and, with the binaries relocated, `could not access directory /tmp/tracepoint-*-test-*: Permission denied`). Running the tests as a non-root user or loosening directory permissions was denied by the sandbox permission policy, so **every embedded-Postgres test/script is blocked here**. CI (ubuntu-latest, non-root) is not affected.
3. The shell environment had `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` set. The first `scripts/*.test.mjs` run inherited them. I reviewed the tested modules: they are pure functions, `main()` is guarded, fetch is injected and mocked, and there is no aws CLI, so no AWS call was made. Every later run explicitly unset AWS vars and set AWS_CONFIG_FILE/AWS_SHARED_CREDENTIALS_FILE=/dev/null.
4. Leftovers outside the scratchpad: three `/tmp/pg-password-*` files that embedded-postgres created during the failed starts. They hold the local test-only passwords from the test sources. The sandbox refused my request to delete them. I removed the empty `/tmp/tracepoint-*` temp dirs.

## 1. Test inventory

| Area | Files | approx. `test(` calls |
|---|---|---|
| permissions / authentication (Cognito, PKCE, session, proxy-authorization, granular perms) | 16 | 86 |
| import (AI importer) | 7 | 49 |
| notifications / email (SES/SNS outbox) | 11 | 44 |
| range (attendance, drills, workspace) | 8 | 39 |
| dashboards / reports / readiness / evidence | 9 | 38 |
| equipment | 5 | 24 |
| armory / firearms (incl. off-duty, personal rifles, QR) | 7 | 20 |
| qualifications | 3 | 20 |
| admin / settings / platform | 5 | 20 |
| training / certifications | 4 | 17 |
| fleet | 2 | 14 |
| storage (S3 object store) | 2 | 14 |
| **src total (application)** | **79** | ~385 |
| scripts/*.test.mjs (staging/prod release, cost, lease, migration lineage, config) | 36 | ~106 |
| infra/test (CDK) | 8 | ~30 |
| **infra/deploy/ops total** | **44** | ~136 |

- About 36% of test files (44/123) are infrastructure/deploy/ops. Within src, the largest single block is auth/permissions plus email/SES/storage plumbing (29 files). Core product workflows (armory, range, qualifications, training, fleet, equipment) have 29 files and about 134 tests.
- Nearly all src tests are repository/adapter/policy units against mocked clients. There are **0 component tests (`*.test.tsx`)** and **no Playwright config or specs**. `@playwright/test` is used only by scripts that target **staging** (test-staging-acceptance, staging-auth-recovery-scenario, test-ai-migration-workspace-staging).
- CI (aws-staging-runtime / oidc-proof) runs `scripts/*.test.mjs`, `run-application-tests.mjs`, `npm test --prefix infra` and `tsc --noEmit`. **Neither `npm run lint` nor `next build` runs in CI**, and neither does `db:validate-bootstrap`. Note: `aws-staging-foundation.yml` runs `npm test` with `working-directory: infra`, which is correct (the root package.json has no `test` script).

## 2. Executed: results

| Check | Result |
|---|---|
| `npm ci` (repo) | **FAIL**: 403 on cdn.sheetjs.com (blocked by policy) |
| `npm ci` (scratch copy without xlsx) | PASS |
| `npm run lint` | **FAIL: 446 problems (398 errors, 48 warnings)**. 334 no-explicit-any, 43 react-hooks/set-state-in-effect, 10 prefer-const, 5 no-unescaped-entities, 3 react-hooks/purity (Date.now in render: notifications/page.tsx:84,97; app/page.tsx:370), 2 no-html-link-for-pages, 1 rules-of-hooks (AgencyTrainingEventEditor.tsx:711 `useCourse` called in onClick; it is likely a plain helper with a `use` prefix, but the linter blocks it). Lint is not run in CI, so this debt is invisible. |
| `npx tsc --noEmit` | 14 errors, **all caused by the missing `xlsx`**. With the typed local stub: **0 errors**. |
| `node scripts/run-application-tests.mjs` | Reported 329 tests: 324 pass, 5 fail. The 5 failures are the AI-importer files (adapters, bedrock-provider, remediation, workbook, workspace), which fail on `Cannot find module 'xlsx'` (~36 tests not run). **5 files report "ok" but ran zero tests** (next row). Actually executed and passing: **319**. |
| False green | `cognito-establish`, `postgres-mapping`, `postgres-refresh-sessions`, `postgres-session-state` and `email/ses-feedback` each report `ok` at file level. Postgres failed to start (EACCES), the process exited 0, and **none of their ~30 tests ran**. Running postgres-mapping.test.ts directly prints only `TAP version 13`, exit 0. **Test-harness gap:** if embedded Postgres can't start, node:test reports green. CI should assert a minimum test count per file or fail on 0 subtests. |
| `node --test scripts/*.test.mjs` | 103 reported: 102 pass, 1 fail (`spreadsheet-roundtrip`, xlsx missing). `staging-management-manifest.test.mjs` is the same false green (embedded Postgres, 0 tests). Actually executed and passing: **101**. |
| `npm test --prefix infra` (CDK, offline, AWS env scrubbed) | **PASS: 31/31** across 8 files |
| `next build` (scratch copy + xlsx stub + synthetic env) | **PASS**: compiled, typecheck OK, 82/82 static pages, standalone output. Without NEXT_PUBLIC_SUPABASE_URL/PUBLISHABLE_KEY the build fails while prerendering `/settings` (`Missing NEXT_PUBLIC_SUPABASE_URL...`). Build needs these env vars at build time. Synthetic values used: `http://127.0.0.1:54321` and `sb_publishable_local_synthetic`. |
| Local boot (`node .next/standalone/server.js`, 127.0.0.1:3100) | PASS for public surface. `/`→307 `/landing`; `/landing`, `/login`, `/activate` → 200; `/help`, `/firearms`, `/range-days`, `/unauthorized` → 307 to `/login?next=...`; `/api/health` 200 `{"status":"ok"}`; `/api/notifications`, `/api/fleet/vehicles`, `/api/super-admin` → 401 JSON; `/api/notifications/email-dispatch` GET → 405. |
| Playwright screenshots (Chromium `/opt/pw-browsers/chromium`; all non-localhost requests aborted; none attempted) | 12 full-page shots, 390x844 and 1440x900, in `scratchpad/runtime/screens/`, plus mobile landing crops (`mobile-landing-y*.png`). No page errors. No horizontal scroll on any page (scrollWidth equals viewport). |

### Mobile/UI observations (executed, public pages only)
- **Mobile `/landing` has no visible "Sign in" in the header.** The header link is hidden below `sm`, so the header shows only "Demo". The first visible sign-in link ("Agency Sign In") is at y≈6869px, about 8 screens down. On desktop, "Sign in" is in the header (y=22). Returning officers on phones have to scroll the entire marketing page.
- Mobile `/landing` is 7194px tall. The mock dashboard cards use 9–10px text: 24 text nodes are under 12px ("Operational picture", "Live records", "View all", category labels). The "View all" link and similar targets are under 32px tall. The "Skip to content" link is 32x16 (it is normally visually hidden, so this is acceptable).
- `/login` and `/activate` render cleanly at 390px: inputs and buttons are full width, and the primary targets are ≥44px tall. The logo PNG renders with a visibly darker rectangular background box on the dark page (it is not transparent-looking).
- Public pages call `/api/access` (→401) on load, which produces a console error on every unauthenticated page. This is harmless but noisy.
- Elements reported off-canvas were only decorative blurred background circles; they are clipped, so no layout breakage.

## 3. Attempted but blocked

- **`npm run db:validate-bootstrap`** (read it first: local only, embedded Postgres on 127.0.0.1, a disposable dir in os.tmpdir, the 75 migrations, then `validate-local-armory-workflows.sql`, `validate-local-tenant-isolation.sql`, a permission matrix, and with `--rehearse-restore` a local pg_dump/restore). **Blocked:** `spawn .../initdb EACCES` (root sandbox plus a 0700 scratchpad). The fallbacks (relocating the binaries, running as the `postgres` user, chmod) were either insufficient or denied by the sandbox permission policy. Therefore **validate-local-armory-workflows.sql and validate-local-tenant-isolation.sql were NOT executed.** `psql` and `docker` binaries exist, but there is no running server and I did not stand one up.
- **The 6 embedded-Postgres test files** (5 src plus staging-management-manifest): blocked for the same reason, and they report a false green (see above).
- **Authenticated app workflows** (armory, range, qualifications, training, fleet, equipment, notifications, admin pages): blocked by design. Auth and data access go through Supabase (`@supabase/ssr` getClaims in `src/proxy.ts` and PostgREST via supabase-js), which needs GoTrue + PostgREST, not plain Postgres. In addition, `src/lib/authentication/server-provider.ts` hard-requires `NEXT_PUBLIC_SUPABASE_URL` to match `^https://[a-z0-9]+\.supabase\.co$`, and `TRACEPOINT_AUTH_PROVIDER` must be `supabase`. So even a local Supabase stack (http://127.0.0.1:54321) is rejected for server-side authenticated reads unless the source changes. The Cognito code paths are not activatable ("not approved by the runtime compatibility gate"). Reaching them would require real Supabase/Cognito, which is out of scope.
- **xlsx import/export flows** (AI importer, spreadsheet roundtrip, /settings/import-export): blocked because the package download is forbidden.

## 4. Not attempted

- Any staging/production script (`test-staging-*`, `run-disposable-staging-acceptance`, `verify-staging-schema`, `db:validate-upgrades` was not run either; it was not reviewed for locality), CDK synth/deploy, PowerShell scripts, Docker image builds.
- `npm run dev` (avoided because it rewrites AGENTS.md; I used the production build instead).
- Accessibility or visual testing of authenticated pages (unreachable).

## 5. Code-reading note (not executed)
- `updateSession` in `src/lib/supabase/proxy.ts` returns `NextResponse.next()` **without any auth gating when `NEXT_PUBLIC_SUPABASE_URL` or the publishable key is unset**. The proxy fails open. Pages and API routes may still enforce auth themselves, but a misconfigured deploy would silently drop the proxy-level route permission checks. Consider failing closed.

## Recommended next steps
1. Mirror or vendor xlsx 0.20.3 (or allow cdn.sheetjs.com) so `npm ci` works in restricted environments.
2. Make embedded-Postgres tests fail when Postgres can't start (assert in `before`, or require >0 subtests), and run `db:validate-bootstrap` in CI.
3. Add `npm run lint` (after triaging the 398 errors; start with rules-of-hooks, purity and set-state-in-effect) and `next build` to CI.
4. Add a local e2e harness with a synthetic auth/data provider so the armory, range and qualification workflows can be exercised without Supabase.
5. Mobile landing: show a "Sign in" link in the mobile header.
