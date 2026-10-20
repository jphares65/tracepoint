# Integration branch: claude/integration-defects-20261020

This branch is for integration and testing only. Nothing on it is deployed, no migrations have been applied anywhere, and it is not merged to `main`.

## Source commits

| Batch branch | Commit |
|---|---|
| `claude/fix-b0-proof-foundation` | `a39d26329397cd4dddb7018ae72b9b53e1a22c53` |
| `claude/fix-b1-account-access` | `705b540495de091e3f283016eca63cb9c13d10d3` |
| `claude/fix-b1a-reimport-safety` | `6626da75c17afd4de2da5194383f0926ad331d50` |
| `claude/fix-b2-field-write-authorization` | `b5976f4e19db24e243840fd8e208f3d1dd25fcd7` |
| `claude/fix-b3-range-save-integrity` | `6ff687f2ad4978fd79b7135728bb2e0fbd9b1980` |
| `claude/fix-b4-fleet-integrity` | `f43dc42c8c591653010d16a0ac357066ff5104af` |
| `claude/fix-b5-qr-resolve` | `df849ed9bdd12f1a016af9b0a30f46842432bb64` |

Base: `claude/fix-b0-proof-foundation` (`a39d263`), which sits on `codex/staging-mobile-api-release-20261007` @ `555f061`. B1 (`705b540`) comes in through B1a, which is stacked on it.

## Conflict resolution

- The only textual conflicts were in `scripts/validate-clean-bootstrap.mjs`, during the B3 and B4 merges. They were resolved by keeping every AWS-stage assertion from both sides.
- The B2/B4 semantic conflict (the fleet override guard) was fixed in B2 before integration (`b5976f4`).

## CI

`application-quality.yml` also runs on pushes to `claude/integration-**`, so this branch is exercised on a GitHub runner with the real SheetJS package and non-root PostgreSQL. Results are recorded below as they arrive.

### CI run 1: commit `d5b8ea8`, workflow run 39472400263, job 118799542038 (GitHub `ubuntu-latest`, Node 24): **all steps passed**

The runner installed the real SheetJS package through `npm ci` and ran PostgreSQL non-root through `embedded-postgres`.

| Step | Result |
|---|---|
| `node --test scripts/*.test.mjs` | 360/360 pass, 0 skipped |
| `node scripts/run-application-tests.mjs` | **676/676 pass**, 0 fail, 0 skipped, 0 cancelled. No "Test files that ran no tests" line. |
| `npm test --prefix infra` | 38/38 pass |
| `npx tsc --noEmit` | clean |
| `npm run db:validate-bootstrap` | "Local armory workflows and tenant isolation passed." and "Clean bootstrap passed: 79 ordered migrations and 43 AWS-native migrations; permission and retirement matrices passed" |
| `npx next build` | compiled, 90/90 pages |

Every test name in the following files has a matching ✔ line in the log. The database-backed ones take about 0.8–0.9 s each against real PostgreSQL.

- `ai-importer/workbook.test.ts` (8/8, real SheetJS). These are the four sandbox xlsx failures.
- `postgres-mapping` (2/2)
- `first-login-activation` (8/8)
- `cognito-membership-lifecycle-sql` (4/4)
- `fleet-audit-outbox-native` (5/5)
- `custody-native-schema` (2/2)
- `inventory-native-schema` (3/3)

The four xlsx failures and the "ran no tests" exclusions recorded during local development were environment limitations of the development sandbox. They do not occur in CI.

## Follow-up merges (owner decisions)

| Branch | Commit | Migration |
|---|---|---|
| `claude/fix-f1-account-import-decisions` | `ddcfc58acf8af3203227ae12774af24d1c554ab0` | 044 |
| `claude/fix-f4-qr-disclosure` | `2edaba653ff2bf4e821fa159aadce295566c9b29` | — |
| `claude/fix-f2-fleet-authorization-decisions` | `3de7ee73a65946d7808f2afcb54d6a5481a7afa8` | 045 |
