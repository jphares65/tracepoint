# Staging release continuation ? September 5, 2026 UTC

Status: staging operational by public HTTP checks and the earlier AWS checkpoint; not production cutover-ready or fully migrated. Deadline: Wednesday, September 9.

## Vercel failure and implemented fix

GitHub reports deployment 6275396855 for commit 44af49f6bc6c3e84e6535e09cd9bc3356dd56c5a as environment Preview, production_environment=false. Vercel deployment dpl_qdaPB3aHyfvTATTmtjEvsQVVKRGt failed. Read-only CLI inspection retrieved the actual build logs: dependencies installed, Next.js 16.3.4 compilation and TypeScript passed, all 78 static pages generated, then Vercel onBuildComplete failed with ENOENT opening /vercel/path0/.next/next-server.js.nft.json. Install-script warnings were not the terminating error.

Failure: https://vercel.com/jphares65s-projects/tracepoint/qdaPB3aHyfvTATTmtjEvsQVVKRGt
Matching upstream issue: https://github.com/vercel/next.js/issues/96646

Commit bdac9c6dca5bddf9e3bf1380607d13384767e08b changes next.config.ts to select native output when VERCEL=1 and standalone otherwise. AWS Docker builds do not set VERCEL. Main was not changed or redeployed. The next AWS image must use the reviewed descendant containing this fix, not mislabel the changed source as 44af49f.

Validation: changed-file ESLint passed; configuration imports select standalone for AWS and undefined output for Vercel; full production Next build with VERCEL=1 passed, including TypeScript and 78 static pages. The initial local attempt lacked NEXT_PUBLIC_SUPABASE settings and failed during prerender; the subsequent successful build used the isolated staging URL and a non-secret, nonfunctional placeholder publishable key. No production credentials were read. This local build does not run Vercel's hosted adapter. Hosted preview validation remains required. Tracked image archive validation passed for 332 files at bdac9c6.

## Fresh live evidence

- Remote AWS branch remains 44af49f6bc6c3e84e6535e09cd9bc3356dd56c5a; remote main remains e33e4a4f17b662dddec9bf653ebf4051c3eb78ab.
- Main's Vercel commit status is success. Production /login and /api/health both returned 200; no authenticated production operations occurred.
- Staging public HTTP suite: 10/10 pass (login, health, eight protected API routes).
- Acceptance harness: 15 anonymous route checks and browser login form passed. Authenticated workflows blocked because disposable staging email/password/department were unavailable; full workflow coverage remains incomplete. Harness did not receive service-role credentials or persist sessions.
- AWS CLI 2.36.34: STS reports no credentials; configure list shows no profile, keys or region. Reading the configured .aws/config path fails EPERM. No AWS mutation was attempted.
- AWS connector read-only STS request was rejected by automatic approval review: tool requires approval, but session approval policy is never.
- Git credential helper hangs, including noninteractive mode. Direct push with helper disabled fails because the configured VS Code askpass script is inaccessible. Remote reads work. No new commit was pushed from this continuation.
- Vercel inspect logs succeeded, but project-link attempts failed to load the user with a local err-range error; retry with the restricted-Windows userInfo workaround did not resolve it. No preview or production deployment was created.

ECS revision 7, desired/running 1/1, ALB healthy, issued certificate and clean original image scan are earlier checkpoint evidence only. Current digest, revision, scan, alarm state, recent logs, structural/live CDK diff, deployment and rollback rehearsal could not be freshly verified through AWS. Public HTTP health does not establish them. Publishing is intentionally blocked until the source fix reaches the branch, hosted preview validation succeeds and exact AWS identity passes.

## Score and cost

Continuation before: 47.80%; after: 47.80%. The existing weighted binary checklist remains authoritative. Build compatibility repair and repeated public checks do not add capabilities or justify percentage inflation. Prior overall baseline was 33.35% before the earlier engineering run.

The existing modeled staging cost is $54.17/month, $20.83 below the $75 ceiling. Actual current spend and forecast are unverified because billing access is unavailable. No resources or build jobs were created in this continuation.

Supabase remains the deployed database, authentication and object-storage provider; Brevo remains email. The SES adapter is prepared but disabled. No provider migration is claimed.

## Shortest critical path and Jason's manual gates

1. Make the existing short-lived staging AWS session and GitHub push credentials available to this execution context (without pasting secrets into chat). The user's external verification did not make credentials accessible here. Exact STS account 559054714699, role TracePointMigrationStaging, region us-east-1 must pass before mutation. Management account remains forbidden.
2. Push the committed fix and checkpoint from the isolated clone or recover the companion bundle; do not force-push. Validate its Vercel Preview reaches Ready. Do not touch main production.
3. Supply disposable staging acceptance email/password/department privately, with a second isolated department for negative checks. Codex can then publish the corrected commit image, require completed clean scan, review structural/live diff, deploy, monitor, run acceptance and rehearse rollback ending on the corrected revision. Verify actual monthly cost and forecast against $75 before more chargeable work.
4. Identify the separate production workload account and authorized short-lived production role, alarm recipients and rollback owner. Codex can apply the exact positive production gate and validate the production stack after that access exists. No management account work is authorized.
5. Complete production-hostname authentication, monitoring/backup evidence and a reviewed rollback rehearsal, then obtain a separate deliberate production DNS/traffic approval. Keep existing Supabase and Brevo for the first hosting cutover; provider replacement is a separate authorized migration.

The next autonomous run should execute the existing release package after these access gates, rather than repeating inventory, migration analysis or broad local validation. Production data transfer and production DNS changes remain unauthorized.
