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

### 3.4 Independent review of the range merge (owner item 5)

An independent reviewer examined commit `65e1cd9` (UX-RB-5/6) for data loss, stale writes, repeated conflicts, deleted records and simultaneous instructors. The report and the eight executable proofs are in `ux-rb-evidence/review-65e1cd9/`. All eight proofs passed against `65e1cd9`, so each defect was real (`proofs-before.txt`). The fixes below are in this batch.

| Finding | Severity | Fix |
|---|---|---|
| H1. A recovered save that the server refused for a reason other than a newer version (another device finalized the day; two scorers added the same walk-up) blocked every later save, including after a reload. | High | Before saving a merged workspace, the page runs the server's own rule (`previewRangeWorkspaceMutation`, the same function the PUT route uses). Each replayed change the server would refuse is held back as a conflict that shows the refusal reason and this device's value, so the rest of the work saves. Any other refusal (400/403/409) triggers one reload and merge per server version. The route's second 409 ("changed during validation") now carries `code:"stale_workspace"` (web route only). |
| H2. The local copy and its merge base were two storage keys shared by every tab and user. A mismatched pair silently reverted saved work, and another user or agency could see and save the copy. | High | One record (`tracepoint.rangeDays.device.v2`, `workspace-device-copy.ts`) holds the copy, its merge base, the conflicts, the user, the agency and the writing tab, written with one `setItem`. It is used only by the same user, and never for another agency. A failed write is shown ("could not keep a backup copy"). Another tab writing the record is shown ("also open in another tab"). The old `…workspace.v1` key is no longer read, because it names no user or agency. **Consequence:** unsynced work stored by the RC build under that key is not merged; it stays in storage untouched. |
| H3. The same officer, drill and run scored fresh on two devices was stored twice with no conflict. | High | The merge matches results by range day, drill, run and officer (the server's `resultKey`) and roster entries by range day and officer, as well as by id, so they meet as one record. New result, roster and malfunction ids are random UUIDs. |
| M1. A copy with an unknown base brought back records the other device had deleted. | Medium | With an unknown base, nothing is replayed. Every record that differs is listed as a conflict ("could not be matched to a saved version"). The exception is a server with no workspace yet. |
| M2, M3. Conflicts accumulated, and an older entry could apply a superseded value. "Keep other device's value" only dismissed the conflict. | Medium | One conflict per record, showing the server's current value. A record edited again on this device supersedes its earlier conflict. Either choice writes that value, and the choice is stored together with the remaining conflicts. |
| M4. A snapshot taken before recovery could be sent with the new version. | Medium (suspected) | Each snapshot records the reload epoch, and a snapshot from an earlier epoch is never sent. |
| M5. RC-era unsynced copies are dropped on upgrade. | Medium (pre-existing) | Not merged. See H2: such a copy cannot be attributed to a user or agency. |
| L1 (id collision), L2 (unkeyed records), L3 (second 409), L4 ("Saved" on a conflicted result) | Low | UUID ids; unkeyed server records kept as they are and numeric ids matched; L3 as in H1; a conflicted result shows **Conflict**. |
| L5. A failed recovery fetch retries on each keystroke. | Low | Unchanged: bounded, and no data is lost. |

**After the fixes** (`proofs-after.txt`): P1, P3 and P8 call the merge and route as the page now uses them, and they no longer reproduce. P2, P4, P5, P6 and P7 re-create the earlier page logic around the raw merge: no server pre-check, two storage keys, an explicit empty base, conflicts concatenated, and timestamp ids. The page no longer does any of that. So these five still "pass", as the earlier logic would. Their fixed counterparts are new tests in `simultaneous-instructors-route.test.ts`:
- review H3 (P1);
- H1 day finalized elsewhere (P2);
- H1 walk-up (P3);
- H1 unforeseen refusal.

The other new tests are:
- `workspace-device-copy.test.ts`: H2 one record across two tabs (P4), user and agency scoping, failed write, M1 (P5), and M2 superseded;
- `workspace-merge.test.ts`: M2/M3 (P7) and P8;
- `range-days/sync-contract.test.ts`: H1 pre-check, H2/M4/L1/L4 page wiring.

Workflow semantics. A change the server would refuse is now shown as "Not saved: <reason>" with this device's value, instead of failing every save. No database or `/api/mobile` contract changes. The native range client's handling of `stale_workspace` (contract row C10) is unchanged.

### 3.5 Second independent review (of `f85ba7a`)

A second reviewer examined the fixes in §3.4 (`ux-rb-evidence/review-f85ba7a/`). All six proofs passed against `f85ba7a` (`proofs-before.txt`). This batch fixes them as follows.

| Finding | Severity | Fix |
|---|---|---|
| R2-H1. Removing a drill (`DELETE /api/pilot/range-workspace/drills`) had no version check. The page adopted the returned version and the server's drill list without merging, so the next autosave silently reverted another instructor's saved work and dropped this device's unsaved drills. Pre-existing since `6ff687f`. | High | The page sends `baseUpdatedAt`. The route refuses an older copy with `stale_workspace` (web route only; a request without the field behaves as before). The page then merges as for a save. After a removal, only the drill leaves the synced copy and this device's workspace, and earlier snapshots are never sent. |
| R2-H2. On a shared device, the next user's (or another agency's) first load overwrote the previous user's unsynced work. | High | One record per user and agency (`tracepoint.rangeDays.device.v2.<user>.<agency>`). A sign-in never reads, merges or overwrites another user's or agency's record. |
| R2-M1. A conflict outlived later edits. | Medium | A conflict stands only while the workspace still shows the other device's value. Editing that record again decides the conflict. |
| R2-M2. Matching by logical key left this device's malfunction pointing at a renamed result. | Medium | The malfunction's result reference is rewritten to the matched result. "Keep other device's value" keeps the malfunction listed on the kept score. |
| R2-M3. A refusal the preview could not predict still blocked every save. A held-back day's score was replayed. | Medium | The preview runs the server's agency and reference check, so a held-back day holds back its drills and scores. After any refusal of another kind, every unsynced change is held back: with the rule's own reason where there is one, otherwise with the server's message. Nothing keeps failing, and the instructor can "Try this device's value again" or "Discard this device's value". |
| R2-M4. Work stored under the earlier keys was never shown. | Medium | Offered once per user as differences, with the reason "Found on this device from an earlier version… it may have been entered by another user". It is never applied. Records naming another agency are skipped, and the old keys are left in place. |
| L1 (labels on held-back conflicts), L5 (`Date.now()` ids for range days and equipment), L6 (a copy with no agency) | Low | Relabelled; UUID ids. A copy written before the agency was known is listed as differences only, then removed. |
| L2 (a load always sends a PUT), L3 (two unsynced tabs replace each other's backup; a notice is shown), L4 (hold-back cost on very large offline sessions), L7 (pre-existing: a score on a drill another device removed), L8 (two records with one id) | Low | Not changed in this batch; recorded for WP-4. |

**After** (`proofs-after.txt`):
- P2 (R2-H2) and P4 (R2-M2) no longer reproduce.
- P1, P3, P5 and P6 re-create the earlier page logic, so they still "pass" as that logic would:
  - P1 sends a drill removal without a version (still accepted, for older clients);
  - P3 has no liveness step;
  - P5 runs a preview without the agency;
  - P6 uses the old single-key reader.
- The fixed counterparts are the `review R2-*` tests in `simultaneous-instructors-route.test.ts` (H1 through the real DELETE and PUT routes, M2, M3 ×2), `workspace-device-copy.test.ts` (H2, L6, M4), `workspace-merge.test.ts` (M1) and `range-days/sync-contract.test.ts`.

**Workflow semantics (flag).** After a refusal this device could not predict, all of its unsynced range changes are listed, not only the one that failed. The instructor re-applies the good ones with "Try this device's value again". This is safe (nothing is lost or sent blindly), but it takes more steps in that rare case.

### 3.6 Third independent review (of `3177a83`)

The third review is in `ux-rb-evidence/review-3177a83/`. All three proofs passed against `3177a83`.

| Finding | Severity | Fix |
|---|---|---|
| P1. The R2-M1 rule ("an edit to a conflicted record decides it") compared whole records. A batch save rebuilds and re-stamps every prefilled officer's result, so a conflict could be dropped and this device's score, held only in the conflict, lost. | High | The rule is removed: a conflict stands until the instructor chooses. "Keep other device's value" writes nothing; it keeps the record's current value and keeps a malfunction this device recorded with the score listed on it. "Use this device's value" applies only the fields this device changed (against the recorded merge base) to the record as it is now. A batch save no longer rebuilds or re-attributes saved results the instructor did not touch in that entry. |
| P2. Editing another field of a conflicted record discarded this device's value. | Medium | Same fix as P1. Each conflict records its merge base, and only this device's changed fields are applied. |
| P3. Drill removal set the drill list captured at click time, overwriting changes or a merge made during the request. | Medium | Functional update from the current list. |
| L-c. A leftover copy's conflict could replace this user's own. | Low | This user's conflicts win. |
| L-a (unsuffixed key from unreleased intermediate builds; no device ran them), L-b (end-of-recovery race; moot once the liveness rule was removed), L-d (harmless today) | Low | Not changed. |

**After** (`proofs-after.txt`):
- P3 fails on its assertion, so the defect is fixed.
- P1 and P2 fail because the function they exercise (`liveConflicts`) no longer exists. The fixed behaviour is pinned by `workspace-merge.test.ts` ("review R2-M1 / 3177a83 P1", "3177a83 P2") and `range-days/sync-contract.test.ts`.

**Workflow semantics (flag).** Range conflicts now stay listed until the instructor resolves each one, even if the record is edited again in the meantime. This is safer than dropping them automatically, but it leaves more items to clear.

### 3.7 Fourth independent review (of `ba6bccf`): simplified conflict model

The fourth review is in `ux-rb-evidence/review-ba6bccf/`. All three proofs passed against `ba6bccf`.
- **R4-H1.** Recovery still dropped an earlier conflict when its record had been edited again.
- **R4-H2.** The field-level "Use this device's value" could combine this device's score with the other device's pass/fail fields, recording a false failure.
- **R4-M1.** The panel compared against a stale value.

Each round of finer-grained merging had added edge cases, so the conflict model is now deliberately simple:
- A conflict holds this device's **whole** entry. It stays until the instructor chooses, or until the entry's current value equals this device's. Every distinct value this device held for an entry is kept: a later conflict on the same entry never replaces an earlier one.
- The panel compares this device's value with the entry **as it is now**.
- "Use this device's value" replaces the whole entry with this device's version, so a score and its outcome always come from one entry. The panel says so.
- "Keep the current value" writes nothing.
- Either way, a malfunction recorded on either entry stays listed on the kept score.

**After** (`proofs-after.txt`): all three proofs fail on their assertions, so the defects are gone. The counterparts are in `workspace-merge.test.ts` and `workspace-device-copy.test.ts` ("ba6bccf R4-…").

**Workflow semantics (flag).** "Use this device's value" now replaces the entry's other fields too, for example an instructor added to a range day after the conflict. This is an explicit, labelled choice, never automatic.

### 3.8 Fifth independent review (of `2c073ae`)

`ux-rb-evidence/review-2c073ae/`:
- **H1.** "Keep the current value" still merged this device's malfunction ids into the kept score. On a day another device had completed, that change was refused, and it then blocked every later save.
- **Fix.** "Keep the current value" writes nothing. "Use this device's value" is checked with the server's rule before it is applied; if it would be refused, the entry stays listed with the reason instead of blocking saves. The malfunction record itself is never removed.
- **After.** The proof fails on its assertion, so the defect is fixed.
- **Lows.** A re-refused retry needs a reload; non-score conflicts show no values. Both recorded for WP-4.

## 4. Staging verification (add to `STAGING-VERIFICATION.md` §4)

| Step | Action | Expected | Automated |
|---|---|---|---|
| S25 | Completion drill: leave the toggle, type a note, Save; then choose Complete and Save | Blocked ("Choose Complete or Incomplete…"); then stored `completed:true`, with no deficiency or remediation | `e2e/range-completion.spec.ts` |
| S26 | Fail a firearm inspection; open New Inspection for it and do nothing | Save disabled with reasons; status stays Inspection Required | `e2e/firearm-inspection.spec.ts` |
| S27 | Fleet rule "defect creates work order" off; officer submits a critical defect | Checks start Not inspected; message "Out of Service. Do not use it."; vehicle is Out of Service | `e2e/vehicle-inspection.spec.ts` |
| S28 | Duty Only firearm: assignee transfers to secure storage, then back | Both succeed; history shows the reason and notes; the supervisor sees both events | `e2e/firearm-custody.spec.ts` |
| S29 | Two instructor devices: different officers; then the same officer | Both scores kept; then a conflict shown and resolved with no loss | `e2e/range-concurrency.spec.ts` |
| S29a | Two instructor devices: lead marks the day Completed while a line instructor enters a score on the same day | Line device shows the score as "Not saved: … cannot be changed" with its value; its other work keeps saving; nothing reverts | Manual (owner) |
| S29c | Lead removes a drill while a line instructor marks attendance on the same day | Removal refused as changed elsewhere, merged, removed on retry; the attendance stays | Manual (owner) |
| S29d | Shared tablet: user A scores offline, signs out; user B signs in and works; user A signs in again | A's unsynced scores are still there for A only; B never sees them | Manual (owner) |
| S29b | Same browser, two tabs of Range Days | Notice "also open in another tab"; saving in one tab never reverts the other tab's saved scores after reload | Manual (owner) |
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
