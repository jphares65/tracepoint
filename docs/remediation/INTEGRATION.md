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
| `claude/fix-f3-fleet-safety-hold` | `96e86b393ab0dde26650dfd338e2c9ed26d81658` | 046 |

F3 merge notes:

- There was a textual conflict in the `src/app/api/fleet/vehicles/[vehicleId]/route.ts` import line. It was resolved by taking the union: F2's `canViewFleetCosts` and F3's `findSafetyHold`.
- One test-fixture gap was fixed. F3's `findSafetyHold` uses `.gt()`, which F2's mock data client in `fleet-authorization-decisions.test.ts` did not implement, so F2's 4 route tests failed. The mock gained `gt`, in the same form as `fleet-integrity.test.ts`. After the fix, all 136 fleet and tracepoint tests pass.
- Migration 046 does not redefine F2's `guard_fleet_field_vehicle_update`, so 045's eligibility rule is preserved. F3 also verified its route harness with 045 applied before 046 (124/124 migrations).
| `claude/fix-f5-qr-inspection-eligibility` | `dbab1166623597060f75e9e8fc5141add86d7ef5` | — |
| `claude/fix-date-contract` | `cec3235baeb62f4740c0361ccb8765f8f43bdabd` | — |
| `claude/fix-f6a-fleet-safety-decisions` | `51d6e0e1bebfa74edbacb54d66515e6700d41698` | 046 (edited in place; unapplied anywhere) |
| `claude/fix-f6b-qr-decisions` | `c57b6799c4bffbd0cd33900b87c0417236660512` | — |
| `claude/fix-tv-training-visibility` | `3f8f5e28983fbed085a0abc040fa02b912d22b95` | 048 |

B6 merge note: `claude/fix-b6-notification-delivery` restructures `src/app/api/notifications/route.ts`, which TV also edits. Expect a conflict when B6 is integrated. Re-run the TV notification tests after resolving it.
| `claude/fix-b9-separated-custody` | `330ce2042fd12150b469f0d59c635f7bfb241a14` | 049 |
| `claude/fix-b7-training-records` | `15867d05f52d11a081b35aa0e8a97cf3a407f614` | 050 |
| `claude/fix-b10-qualification-range-roles` | `6e43ab400910347c4be4bbcaab1e852db1b30d10` | 051 |

B10 merge note: `scripts/validate-clean-bootstrap.mjs` conflicted with B7 (both add an AWS-stage suite after training visibility). Resolved by keeping both, closeout first. Range and TV tests 80/80 on the merged tree; `tsc` clean.
| `claude/fix-b8-armory-integrity` | `06d397da9d4c8f0240d81c48e0220c818c437c2b` | 052 |

B8 merge note: clean merge (cut from the integration head `9ba56a3`).
| `claude/fix-b11-admin-correctness` | `b8b3475e29ecc8e5f3f69a91680ab1badd3f9173` | — |

B11 merge note: clean merge on top of B8. On the merged tree: `tsc` 0 errors; application tests 724/728 (the 4 are the sandbox `xlsx` stub); scripts 350/351 (SheetJS round trip). B11 left 33 armory/firearm backup files for after B8; `scripts/repository-hygiene.test.mjs` excludes exactly those paths until they are removed.
| `claude/fix-adm07-invited-reset` | `9a7a2346b842bc1fd22446675a03531fd616904c` | — |

ADM-07 merge note: clean merge on top of B11. It replaces B11 S23 step 3 with "S23-3 (revised)" in the ADM-07 record.
