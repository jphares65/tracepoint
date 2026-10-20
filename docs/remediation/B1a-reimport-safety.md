# Remediation batch B1a — personnel re-import safety

Base: `claude/fix-b1-account-access` (stacked on `claude/fix-b0-proof-foundation`). Findings and evidence come from `docs/operational-audit-20261020/reconciliation-20261020/R6-admin-onboarding.md` (ADM-04) and the original `appendix-e-admin-onboarding.md` ADM-04.

B1 corrected `prepare_cognito_membership_operation` (`039`). Since then the personnel-import lifecycle really runs in aws-native mode, so ADM-04 now also re-enables Cognito accounts (B1 owner decision 1). This batch closes that window. There is no schema change and no new migration.

## Defects addressed

| ID | Defect | Status | Change |
|---|---|---|---|
| ADM-04 (a) roles, bridge | The classic route (`/api/settings/onboarding/personnel`, Supabase branch) called `set_department_member_roles(["officer"])` on every row. Re-importing an existing member replaced all of their roles with Officer. | **Fixed** | The route reads the member's existing membership in this agency first. It assigns the default role only when the membership is new. There is no roles column in either importer, so an existing member's roles are never written. |
| ADM-04 (a) roles, aws-native | `attach_existing_cognito_personnel_import` (`010`) adds `officer` with `on conflict do nothing`. Roles are not stripped. | Already safe (residual noted) | No change. Residual: it still **adds** `officer` to an existing member who lacks it. Removing that needs a migration, and this batch has none allocated. See Owner decisions. |
| ADM-04 (b) reactivation, classic route | `isActiveValue` mapped a missing or blank Active to `true`. Bridge: the upsert set `is_active=true` and `deactivated_at=null` on a separated officer. aws-native: the writer called `setCognitoMembershipActive({active:true})` for every existing identity unless Active was explicitly false. That re-enabled the membership **and the Cognito user**. | **Fixed** | New pure module `src/lib/onboarding/personnel-reimport.ts`. `parseImportActive` returns `undefined` for a missing or blank value. Recognised values are unchanged. For an existing membership, an undefined value keeps `is_active`. The bridge upsert then omits `is_active` and `deactivated_at`, so PostgREST leaves them unchanged. New memberships keep the active default. |
| ADM-04 (c) Cognito lifecycle on unchanged status | The Cognito writer's create path (used by the classic route and by AI-importer CREATE rows that hit an existing identity) ran the enable lifecycle regardless of the current state. | **Fixed** | Before `attach_existing_cognito_personnel_import`, the writer reads this agency's memberships (`user_id,is_active`) through the request-role client, the same read the AI importer's reference data uses. `planExistingCognitoPersonnel` then returns `setActive` only when the target status differs from the current one. A new membership is inserted inactive by `attach`, so it is enabled by default as before. `setCognitoMembershipActive` is called only when `setActive` is defined. |
| ADM-04, explicit Active=false (aws-native classic route) | An explicit `Active=No` for an existing active member was silently ignored. The writer skipped the lifecycle on `false` and `attach` never changes status. | **Fixed (consequence of the same rule)** | An explicit value that differs from the current status now runs the lifecycle (`false` → disable, global sign-out and session revocation, as in the AI-importer update path). This matches bridge behaviour. |
| ADM-04, AI importer | `validatePersonnel` maps an absent or blank Active to `null`. `changeList` ignores `null`. The bridge `UPDATE` uses `compact()` and never writes roles. The Cognito `UPDATE` path calls the lifecycle only when there is an explicit boolean `active` change. | Already safe; now covered by tests | No code change in `execution.ts` or the adapter. Its CREATE-with-existing-identity path goes through the fixed writer. |

Invitation re-send (NEW-ADM-D from B1) is kept when the resulting status is active and the identity is still `pending`. That includes an already-active pending member re-imported without an Active column, as before. An inactive pending member re-imported without Active is not re-invited.

## Files

- `src/lib/onboarding/personnel-reimport.ts` (new; pure, no `server-only`): `parseImportActive`, `planBridgePersonnelMembership`, `planExistingCognitoPersonnel`.
- `src/app/api/settings/onboarding/personnel/route.ts`: blank Active is passed on as unset. The bridge branch reads the prior membership, writes status only when it changes and assigns the default role only to new memberships. The audit `new_value.is_active` records the resulting status.
- `src/lib/ai-importer/server/cognito-personnel-writer.ts`: prior-membership read, and the lifecycle and re-send gated by the plan.
- `src/lib/onboarding/personnel-reimport.test.ts` (new, 8 tests). It covers the decision functions, the AI importer behaviour (adapter and bridge execution with a fake client), and source contracts for the route and writer wiring. Route and `server-only` modules cannot be imported under the repository runner (same approach as B1's `account-access-routes.test.ts`).

Behavioural harnesses that run the **real** route (bridge mode) and the **real** Cognito writer with their dependencies mocked were kept out of the tree. They need `node --experimental-test-module-mocks`, which `scripts/run-application-tests.mjs` does not pass. Their results are recorded below.

## Verification (local, synthetic; no remote systems)

No SQL was changed, so no PostgreSQL server, bootstrap or validator run was needed.

| Check | Before (route + writer at B1 head) | After |
|---|---|---|
| `personnel-reimport.test.ts` | 2/8 fail: the classic-route and writer wiring contracts. The decision-function and AI-importer tests pass, because the AI importer was already safe and the helpers are new | **8/8** |
| Route harness (real `POST`, bridge mode, mocked Supabase clients) | (a) **fail**: `set_department_member_roles(["officer"])` called for an existing member. (b) **fail**: an absent or blank Active wrote `is_active` (true) for an inactive member. (c) explicit No/Yes pass. New-member defaults pass | **4/4** |
| Writer harness (real `writeCognitoPersonnel`, mocked lifecycle, resend and invite; classic-route Active semantics) | (b)+(d) **fail**: inactive member with Active absent → `setCognitoMembershipActive(true)`. (d) **fail**: active member with explicit true → lifecycle called. (c) **fail**: explicit false on an active member → no lifecycle (ignored). Explicit true on an inactive member and a new membership pass | **5/5** |
| `account-access-routes.test.ts` (B1 contracts, including two `resendPendingCognitoActivation` call sites) | — | 5/5 |
| `npx tsc --noEmit` | — | 0 errors |
| `npx eslint` on changed files | — | clean |
| `node scripts/run-application-tests.mjs` | — | 572 tests, 568 pass. The 4 failures are the xlsx stub (importer parse and inference). 13 embedded-PostgreSQL files "ran no tests" (same list as B1), which is the environment limitation |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | — | 348/349. The one failure is the SheetJS round trip |

## Owner decisions

1. **`attach_existing_cognito_personnel_import` adds `officer`** to an existing member who does not hold it. It never removes roles. Making it role-neutral for existing memberships needs a new `database/aws` migration. Recommended in B11 if wanted.
2. **Blank fields still overwrite** badge, rank, unit and employee number with NULL on the aws-native attach and update paths (`010`), and on the bridge upsert. This is R6's ADM-04 note and is out of scope here (status and roles only).
3. **Explicit `Active=No` now deactivates** an existing member through the classic route in aws-native, with Cognito disable and session revocation. Before, it was silently ignored. Confirm this is the intended behaviour. It matches the bridge and the AI importer.
4. **The classic import can deactivate the importing administrator** if their own row says `Active=No`. Whether that is refused depends on the lifecycle and database guards, as in the existing AI-importer update path. It is unchanged by this batch.

## Staging runbook (README §8)

Deploy the image together with B1, or after it. No migration.

1. Seed an agency with officer A (active, roles Officer + Supervisor) and officer B (deactivated in Settings; Cognito user Disabled).
2. Classic import (Settings → Import/Export, personnel) of a CSV **without** an Active column, containing A and B. Expected: A keeps both roles. B stays inactive, Cognito B stays Disabled, and there is no `department_membership_reactivated` audit row for B.
3. Repeat with an Active column left blank for both. Same result.
4. Import with `Active=Yes` for B. Expected: B is active and Cognito B is Enabled (lifecycle `committed`). Import with `Active=No` for A. Expected: A is inactive, Cognito A is Disabled, and A's open session is rejected on the next request or refresh.
5. Import a new person (no Active column). Expected: invited and active, role Officer (unchanged).
6. AI importer (Migration workspace) with a roster that omits status, including B. Expected: B's row shows no Active change and stays inactive after approval.
7. Run S10 (the tenant-negative suite).

## Rollback

Revert the image. There are no schema or data changes. Memberships changed by an explicit Active value during testing can be reverted in Settings → Edit Access.
