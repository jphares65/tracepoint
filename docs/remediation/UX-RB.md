# Remediation batch UX-RB: release-safety UI fixes

| | |
|---|---|
| **Branch base** | `claude/integration-defects-20261020` @ `5b6cc00` (release candidate) |
| **Status** | Fixed in code; tests green locally (see the evidence section). **Not deployed. Not validated in staging. Production untouched.** |
| **Source** | UI/UX audit `docs/uiux-audit-20261022/` (remediation plan §2) |
| **Owner decisions applied** | 2026-10-22: Completion default "Not recorded"; repair the custody transfer rather than remove it; checklists default to "Not inspected" with an optional, explicit "Mark remaining as Pass"; test tooling approved; range concurrency must never discard or overwrite unsaved scores |

**Commit-message convention.** Each commit message records the defect as it was in the release candidate ("Before (RC 5b6cc00): …"). The same regression tests, run against the untouched release candidate, are in `ux-rb-evidence/before-rc-5b6cc00.txt`. Their results after the fixes are in `ux-rb-evidence/after-uxrb.txt`.

---

## 0. Environment provenance (owner item 1, read-only)

**AWS access.** The AWS credentials in the session environment are rejected (`sts get-caller-identity`: `InvalidClientTokenId`). So ECS task definitions, image digests and ECR could **not** be read. Everything below comes from public, unauthenticated responses only. No data was read or changed.

**Source commits.** Each build serves `/_next/static/...?dpl=<id>`. In this repo:
- `next.config.ts` sets `deploymentId: process.env.DEPLOYMENT_VERSION`;
- every image buildspec passes `DEPLOYMENT_VERSION="$SOURCE_COMMIT"` (`buildspec.production-image.yml`, `buildspec.staging-image.yml`).

So `dpl` is the deployed source commit:

| Environment | Source commit (`dpl`) | In `jphares65/tracepoint`? |
|---|---|---|
| Production (`tracepointhq.com`) | `5700011cc9ea6cff880bcb7f697423fa7f4fd27c` | **No.** None of the 83 refs GitHub advertises (`git ls-remote`) points at it, and the GitHub commits API returns "No commit found". |
| Staging (`staging.tracepointhq.com`) | `22e543d86dc9709c341010ac883406429b4e55c2` | **No.** Same result: no advertised ref, and the commits API returns "No commit found". |

**Route checks.** These refine the picture. An unknown `/api/mobile/*` path returns 404. A route that exists returns 401 or 405.

| Route | First added in | Production | Staging |
|---|---|---|---|
| `/api/mobile/session` (POST-only) | `c006764`, 10-04 | 405 GET / 401 POST: **exists** | exists |
| `/api/mobile/qr/resolve` | `5672b03`, 10-06 | exists | exists |
| `/api/mobile/inbox` | `555f061`, 10-09 (tip of the staging line) | **exists** | exists |
| `/api/inventory/*`, vehicle documents | 10-02/10-03 | exist | exist |

**Conclusions:**
1. **Production is *not* `564ff78`**, which the operational reconciliation R1 had inferred. Production serves routes first added on Oct 4–9, so it is at least as new as the staging line tip `555f061`.
2. **Both environments run source that was never pushed to GitHub.** Their exact code cannot be reviewed or diffed from the repository.
3. The two environments run **different** commits.

**Effect on the remediation plan (§3).** Assume these are **live in production** until proven otherwise:
- the Inventory defects (D-62, D-63, D-65, D-70);
- the record-page custody form (C-63 / RB-4) and its permission mismatch (C-R2);
- the Restricted-tab notes defect (C-64).

**Needed from the owner:**
- read-only `aws ecs describe-services` / `describe-task-definition` for `tracepoint-production` and `tracepoint-staging`, with the image digest and the `org.opencontainers.image.revision` label;
- the commits `5700011…` and `22e543d…` pushed to GitHub, so the deployed code can be compared with this batch.

---

## 1. Fixes

| ID | Defect (audit refs) | Fix | Files |
|---|---|---|---|
| **UX-RB-1** | Completion drills displayed "Complete" by default but saved nothing, or saved Fail with a remediation recommendation (B-05, B-R5; ~RNG-15). | **Display:** Completion rows start **Not recorded**, and a row with any entry cannot be saved until Complete or Incomplete is chosen. The control highlights exactly the value that will be saved. **Flags:** Notes Only drills never pass or fail. An incomplete run is a standard failure only when the drill has a standard. So no failure or remediation flag comes from an untouched or notes-only row. **Kept:** B10's semantics for an explicit Incomplete on a scored drill. | `src/lib/range/scoring-rules.ts`, `src/app/range-days/components/CompletionChoiceControl.tsx`, `src/app/range-days/page.tsx` |
| **UX-RB-2** | Inspection forms started fully "Pass". A firearm form saved untouched recorded "Passed" and, under B8, could return a failed firearm to In Service (C-03, C-06, C-07, D-04; ARM-15, FLT-10). | **Firearm:** every checklist item, *Weapon Cleared*, *Ammunition Removed* and the result start unanswered. Save is disabled, and lists what is missing, until all are answered. It has a busy state. The sidebar states the real status effect. **Vehicle:** every check starts *Not inspected*; only a condition an equipment record already shows (Missing, Attention, Out of Service) is carried in. **Both:** an explicit "Mark remaining N as Pass" fills only unanswered items. An unanswered item is never put in a request. | `src/lib/armory/inspection-form.ts`, `src/lib/fleet/inspection-form.ts`, `src/app/components/InspectionChoiceControl.tsx`, `src/app/firearms/inspections/new/page.tsx`, `src/app/fleet-management/[vehicleId]/QuickInspectionPanel.tsx` |
| **UX-RB-3** | "Inspection saved. Vehicle remains ready." whenever no work order was returned, including a critical defect that holds the vehicle Out of Service. A saved inspection that returned 500 invited a resubmit (D-58, D-59). | The message is built from the server's `readiness` status, `safetyHold`, work order and `audit`. A held or Out of Service vehicle is reported as "Out of Service. Do not use it." with the hold reason. Unknown readiness never claims the vehicle is ready. A 500 that carries the inspection closes the form and says not to resubmit. | `src/lib/fleet/inspection-outcome.ts`, `QuickInspectionPanel.tsx` |
| **UX-RB-4** | The firearm record page's "Transfer to Secure Storage / Return to Assigned Officer" posted the pre-031 body. The route has refused that body with 400 since `2c7bc51`, so every transfer failed. The buttons were gated by permissions the database does not use (C-63, C-R2). The Restricted tab dropped notes (C-64). | One shared contract and one eligibility rule mirroring `database/aws/031`. The custody GET returns `operations` (additive; web route only). History shows the action with the reason and notes. The non-functional "administrative correction" checkbox is removed. The Restricted tab sends its notes. | `src/lib/armory/restricted-custody.ts`, `src/app/api/armory/firearms/[firearmId]/custody/route.ts`, `src/app/firearms/[firearmId]/page.tsx`, `src/app/firearms/page.tsx` |
| **UX-RB-5** | After one "changed on another device" refusal, every save failed until reload, and the only remedy, Reload, discarded unsynced scores (B-70, B-R2). An offline copy loaded after a failed GET was saved with no version and overwrote the server (B-03). | On refusal, the page loads the server copy and replays this device's changes since its last sync, record by record. Different records from both devices are kept. A record changed on both is a visible, persisted conflict with "Use this device's value" or "Keep other device's value". The merge base and version are stored with the local copy, so a reload replays unsynced work. A copy whose server version is unknown is never saved until merged. No page reload. | `src/lib/range/workspace-merge.ts`, `src/app/range-days/page.tsx` |
| **UX-RB-6** | One impossible score stalled all syncing. The row stayed green "Saved" (B-69, B-17). | The server's RNG-14 rule (`resultMeasurementError`) is checked on the officer's row before saving, and blocks the save naming the officer. Score inputs are labelled per officer with `inputMode`. A row is "Saved" only when the server holds exactly that result, otherwise "Not synced". | `src/lib/range/workspace-mutation.ts` (extraction only), `src/lib/range/scoring-rules.ts`, `src/app/range-days/page.tsx` |

**Also in this batch:**
- React Testing Library with jsdom for component tests, under the existing `node:test` runner (`src/lib/testing/dom.ts`).
- The Playwright staging suite `e2e/` (see `e2e/README.md`).
- RFC 6238 TOTP for the synthetic accounts.

## 2. Flags (owner item: migrations, native compatibility, workflow semantics)

| Item | Kind | Status |
|---|---|---|
| **Migrations** | — | **None** in this batch. |
| **Fleet inspection API records an item with a missing or unknown condition as Pass** (`src/app/api/fleet/vehicles/[vehicleId]/inspections/route.ts`, the `condition:` fallback). This is a server-side default Pass. | **Native compatibility**: `/api/mobile/fleet/.../inspections` re-exports this route. | **Not changed.** The web form never sends an unanswered item. Returning 400 instead needs an owner decision and a contract row (proposed C33: "an inspection item without Pass/Defect/Critical is refused with 400"). |
| **Custody "administrative correction"** (028 `transfer_firearm_custody` with `firearm_custody.override`). | **Workflow semantics** | Not restored. The route has supported only the 031 restricted check-in/check-out since `2c7bc51`. Re-exposing 028 corrections for any firearm is a scope decision for the owner. |
| `GET /api/armory/firearms/{id}/custody` gains `operations` | API (additive) | Web route only; not re-exported under `/api/mobile`. Existing fields are unchanged. |
| Completion "Not recorded"; checklists "Not inspected" | Workflow semantics | **Owner-approved** (2026-10-22). One extra deliberate choice per item, or "Mark remaining as Pass". |
| Native range client | Native compatibility | No `/api/mobile` change. The native app's own handling of `stale_workspace` (contract row C10) still decides whether it can lose scores. **Native review needed** (plan §10). |

## 3. Evidence

### 3.1 Before and after (`ux-rb-evidence/`)

The same 17 test files ran against the untouched RC and against this batch:

| Run | Passed | Failed | Notes |
|---|---|---|---|
| RC `5b6cc00` | 7 | 27 | The 7 passes are pre-existing B10 tests, plus 3 tests that characterise the RC defects: the old completion display disagreeing with the saved value, the old custody body refused, and the second device's save refused. |
| UX-RB | 67 | 0 | — |

### 3.2 Full gate, run locally

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `next build` | Succeeds |
| Application tests | 901 tests, 791 passing; RC baseline 833 / 724 |

**About the 110 failures.** All of them are embedded-PostgreSQL tests, which cannot start PostgreSQL as root in this sandbox (`initdb: could not access directory … Permission denied`). This is the same set as the RC baseline, plus one new database test: the RB-4 round trip through 031 with notes. **These run in CI** (`.github/workflows/application-quality.yml`).

**Lint.** ESLint on `src/app/range-days/page.tsx` reports the same findings as the RC. CI does not run lint.

**Not run.** The staging Playwright suite (`e2e/`) needs the synthetic accounts.

### 3.3 Tests added

- **UX-RB-1:**
  - `scoring-rules.test.ts`: display equals saved value, explicit choice, no flags from untouched or notes-only rows;
  - `CompletionChoiceControl.test.tsx` (component);
  - `range-days/completion-contract.test.ts` (page).
- **UX-RB-2:**
  - `armory/inspection-form.test.ts` and `fleet/inspection-form.test.ts`: no defaults, blockers, mark-remaining, server payload rule;
  - `InspectionChoiceControl.test.tsx`;
  - page contracts.
- **UX-RB-3:** `fleet/inspection-outcome.test.ts` covers held without a work order, open critical work order, attention, available, audit pending or unrecorded, 500 with the inspection, and missing readiness. Plus a panel contract.
- **UX-RB-4:**
  - `restricted-custody.test.ts`: page body accepted by the route parser in both directions; the RC body refused; eligibility table mirroring 031; history text;
  - `restricted-custody-route.test.ts`: the real route handler, both directions, and the RC body refused before the database;
  - `custody-native-schema.test.ts`: embedded PostgreSQL against 031, notes persisted (CI);
  - page contracts.
- **UX-RB-5:**
  - `workspace-merge.test.ts`: different officers, same officer, identical edits, deletions, offline copy without a base;
  - `simultaneous-instructors-route.test.ts`: two devices through the **real** PUT route, including both officers kept, the same-officer conflict resolved without loss, and the RC refusal characterised;
  - `range-days/sync-contract.test.ts`.
- **UX-RB-6:** `row-validation.test.ts` checks that the shared validator equals the server's decision, plus page contracts.

## 4. Staging verification (add to `STAGING-VERIFICATION.md` §4)

| Step | Action | Expected | Automated |
|---|---|---|---|
| S25 | Completion drill: leave the toggle, type a note, Save; then choose Complete and Save | Blocked ("Choose Complete or Incomplete…"); then stored `completed:true`, with no deficiency or remediation | `e2e/range-completion.spec.ts` |
| S26 | Fail a firearm inspection; open New Inspection for it and do nothing | Save disabled with reasons; status stays Inspection Required | `e2e/firearm-inspection.spec.ts` |
| S27 | Fleet rule "defect creates work order" off; officer submits a critical defect | Checks start Not inspected; message "Out of Service. Do not use it."; vehicle is Out of Service | `e2e/vehicle-inspection.spec.ts` |
| S28 | Duty Only firearm: assignee transfers to secure storage, then back | Both succeed; history shows the reason and notes; the supervisor sees both events | `e2e/firearm-custody.spec.ts` |
| S29 | Two instructor devices: different officers; then the same officer | Both scores kept; then a conflict shown and resolved with no loss | `e2e/range-concurrency.spec.ts` |
| S30 | Enter 55 on a maximum-50 drill | Row marked invalid, officer named, nothing sent; 48 saves | `e2e/range-validation.spec.ts` |

## 5. Not in this batch (remaining plan items)

The "before production promotion" items in plan §2 are **not** done:
- D-27 / D-28: the Fleet Rules comma lists, and the defaults saved over the real rules after a failed load;
- D-R1: `canInspect` for Quick Inspect;
- D-60 / D-15: safety-hold visibility and status controls;
- B-75 / B-R4: the Agency Training roster 409 loop;
- E-52: confirmation for disabling a module;
- errors behind modals: E-01, B-49, D-08.

They are proposed as the next small batch. **D-R1 adds a field to a route the native app re-exports, so it needs a contract row before implementation.**
