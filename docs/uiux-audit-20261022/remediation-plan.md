# UI/UX findings × operational remediation: consolidated remediation plan

| | |
|---|---|
| **Date** | 2026-10-22 |
| **Status** | Plan only. No code, migration, deployment or production change was made. |
| **Inputs** | The [UI/UX audit](README.md) (339 open findings). The Oct-20 operational audit and its reconciliation, on `claude/tracepoint-operational-audit-w567t8`. The remediation batches B0–B11, F1–F6b, DC, DC2, TV, ADM-07 and B8a, merged in `claude/integration-defects-20261020`. |
| **Register** | [`reconciliation/`](reconciliation/), with one row per reconciled finding: [A+E](reconciliation/register-AE.md), [B](reconciliation/register-B.md), [C](reconciliation/register-C.md), [D](reconciliation/register-D.md) |
| **Priority order (owner)** | 1. Operational correctness. 2. Reliability. 3. Intuitive workflows. 4. Consistent presentation. |

---

## 1. Summary

**What was reconciled.** Every open UI/UX finding that is a functional defect, or that falls into the owner's risk classes, was re-verified in code. The risk classes are inaccurate records, failed operations, misleading success, unsafe defaults and lost input. That gives **115 findings, plus 10 found during verification**.

**Trees.** Each finding was checked in three code trees. History is linear: production ⊂ staging ⊂ RC.

| Tree | Ref | Status |
|---|---|---|
| **PROD** | `564ff78` (`codex/production-consolidated-upgrades-20260929`) | Likely production. Not recorded; see §3. |
| **STG** | `555f061` (`codex/staging-mobile-api-release-20261007`) | Likely staging. Not recorded; see §3. |
| **RC** | `5b6cc00` (`claude/integration-defects-20261020`) | Release candidate. Not deployed anywhere. |

**What came out of it:**
- **Six release-blocking defects (§2).** The RC either introduces them or makes them materially worse. Each produces wrong records, a failed core operation or a misleading safety message. All six are small client-side fixes with no migration. **They should go into the RC before its staging verification run**, because several S-steps exercise exactly these screens.
- **No UI/UX finding is fully fixed by an operational batch**, even where the batch fixed the data problem underneath. 34 findings are *partly* addressed: the batch fixed the server, but the screen still misleads. The rest are either known to the OA but unassigned (31) or not in the OA at all (50).
- **About 94 of the 115 are already present in likely production.** They are not RC regressions. They should be fixed through ordinary follow-on batches (§5), not hotfixes. None of them, on its own, warrants interrupting the current release path. §3 explains why.
- **The 125 items collapse into 6 release-blocker items and 10 work packages.** Each work package is built around one root cause, so every defect is fixed once (§4).
- **UI standardization (§6) is sequenced *behind* correctness.** It starts with the minimum shared primitives that the correctness fixes need: a dialog error slot, a busy-aware submit button, load states and confirm/reason dialogs. Broad visual adoption then proceeds one module per release, with parity checklists that guarantee no workflow or capability is removed.
- **Regression gap.** The RC has about 270 logic and route tests, but **zero UI-level tests**: no component tests and no end-to-end tests, though Playwright is installed. That is why a page-to-API contract mismatch (C-63) could ship with CI green. §7 sets the minimum regression bar for every package.

---

## 2. Release-blocking issues: fix in the RC before staging verification

**Criteria.** An item is release-blocking when the RC introduces it, or makes it materially worse, **and** it would write an inaccurate safety, accountability or qualification record, fail a core operation, or tell a field user something unsafe.

**Verification.** All six were confirmed by direct reading of the RC source, not only by the review agents.

| # | Issue | Introduced / worsened by | Effect | Evidence (RC) | Fix (no migration) | Effort |
|---|---|---|---|---|---|---|
| **RB-1** | **Range Completion drills record Fail + remediation while the screen shows "Complete / Pass."** An untouched Complete/Incomplete toggle displays *Complete*, but B10's `resolveRunCompletion` treats it as *incomplete* for Completion drills. A row with Result = Pass, or with only a note, is saved as `completed:false, passed:false`, with `deficiencyObserved` and `remedialTrainingRecommended` set. A single tap records *Incomplete*. Notes-Only drills and drills with no standard also get deficiency flags when marked incomplete (B-R5). | Display mismatch in every tree; **B10 turned it into a Fail record** | Inaccurate training records: wrong pass rate, false remediation badges. Misleading success. | `src/app/range-days/page.tsx:6633-6648` (display `row.completed ?? true`), `:2628-2631` (prefill leaves `undefined`), `:3465`, `:3517-3523`; `src/lib/range/scoring-rules.ts:15-16` | Prefill `completed` from `resolveRunCompletion`, so the display always equals what will be saved, or use an explicit tri-state ("Not recorded / Complete / Incomplete"). Do not set deficiency or remediation flags for formats with no pass concept. **Owner decision:** the default for Completion drills. | S |
| **RB-2** | **Saving the firearm inspection form untouched can return a failed firearm to service.** The form defaults to Result "Passed", recommendation "Remain In Service" and every item "Pass". B8 (ARM-17) now returns a firearm from *Inspection Required* (set by a failed inspection) to *In Service* on a Passed result. The sidebar copy still says Save does not change status (C-06). Save has no busy state, so double-submit is possible (C-07). | Defaults are in PROD; **B8 made a zero-touch save change status** | Unsafe default that changes the status of a safety-critical asset. Inaccurate record. | `src/app/firearms/inspections/new/page.tsx:106+` (items), `:314-315`, `:323` (`"Passed"`), `:325-326`, `:1031-1034` (copy); `src/lib/armory/firearm-status-change.ts:157-177`; `src/app/api/armory/inspections/route.ts:232` | **Minimum:** Result and recommendation start unset; Save stays disabled until a result is chosen; the server returns 400 when `result` is missing; the copy states the status effect; Save gets a busy and disabled state. Item-level defaults remain the ARM-15 owner decision (WP-3). | S |
| **RB-3** | **"Inspection saved. Vehicle remains ready." can show for a vehicle that was just put Out of Service.** The message depends only on whether a work order was created. Under F3/F6a, a critical defect holds the vehicle Out of Service even when the agency turned off "defect creates work order". The B4 response's `readiness` and `audit` warning are ignored. A 500 that carries `inspection` (meaning *saved*) is shown as a failure, which invites a resubmit (D-59). | Narrow form in PROD; **F3/F6a/B4 made it reachable in default use** | An officer is told a vehicle is ready to drive when it is held. | `src/app/fleet-management/[vehicleId]/QuickInspectionPanel.tsx:264-267`; `src/app/api/fleet/vehicles/[vehicleId]/inspections/route.ts:306`, `:381-383` | Build the outcome message from `readiness.status` / `readiness.safetyHold`. Show `audit.message` when the status is pending or unrecorded. Treat `ok:false` + `inspection` as "saved, do not resubmit". All are covered by the native contract rows C14/C15 already. | XS–S |
| **RB-4** | **The firearm record page's "Transfer to Secure Storage / Return to Assigned Officer" always fails (400).** The page posts `{toHolderType, toHolderUserId, toStorageLocationId, reason…}`, while the custody API accepts only `{action: "CHECK_OUT" \| "CHECK_IN", …}`. The buttons are also gated by permissions that don't match the database function (C-R2). Custody history shows the action code instead of the user's notes. | Page added `e935bca` (09-29). API changed `2c7bc51` (10-01) without updating the page. **Live in staging; not in likely production.** The RC would carry it into production for the first time. | Failed custody operation on a firearm. Users are routed to it by the Focus-view copy (C-01). | `src/app/firearms/[firearmId]/page.tsx:255-266`; `src/app/api/armory/firearms/[firearmId]/custody/route.ts:35-36` | **Owner choice:** (a) send the correct contract and gate the buttons exactly as RPC 031 authorises; or (b) remove the form and link to the working Restricted tab on `/firearms`. Fix the history display either way. | S |
| **RB-5** | **After one range "changed on another device" conflict, every later save fails until reload, and Reload discards unsynced scores.** `workspaceStale` is set and never cleared. The only remedy is `window.location.reload()`, with no warning that unsynced results will be lost. | **RC-introduced** (B3 optimistic concurrency) | Lost input and failed saves during live scoring, typically with two instructor devices. | `src/app/range-days/page.tsx:1956`, `:2986` (only setter), `:3898-3907` | Before reload, persist the unsynced results and re-apply them onto the fresh workspace, clearing the stale flag on success; or at minimum say "N unsynced results will be lost" and offer to keep them. Concurrency *merging* stays deferred (B3 owner decision). | M |
| **RB-6** | **One rejected score stalls all range syncing, and the instructor can't tell which officer caused it.** B10 now rejects impossible scores with a 400 (correct), but the client has no matching validation. The save queue always resends the whole workspace including the bad value, Retry resends the same payload, and the row pills stay green "Saved". | Silent in PROD (the value was saved); **B10/B3 made it a hard stall** | Failed operation; misleading success at row level. | `src/lib/range/workspace-autosave.ts:17-19`, `:61-68`; `src/lib/range/workspace-mutation.ts:250-271`; `src/app/range-days/page.tsx:6517-6521` | Share the B10 validator with the client: block Save on the offending row with a red field and officer name. Have the server name the officer in the 400. Row pills show "Not synced" until acknowledged. | S |

### Before production promotion: RC-worsened items to fix in the same follow-on batch

These are not blockers for the staging run, but they should not reach production in their RC form.

- **D-27.** The Fleet Rules comma-list inputs swallow a trailing comma, so a second role code cannot be typed. **Under F2 the inspection-role list now *excludes* unlisted members**, so a mis-entry locks officers out of inspections. Fix it together with D-28: a failed rules load must not allow defaults to be saved.
- **D-R1.** Quick Inspect and Report Issue are shown to users that F2 now refuses. They fill in the whole form and then get a 403. Fix: return `canInspect` with the vehicle and hide or disable the buttons.
- **D-60 + D-15.** A safety hold is visible only on one card, and status buttons and the list select stay enabled during a hold. A Save then reports success while the status does not change. Fix: hold badge in the header and list, and disable status controls while held.
- **D-R2 (runtime check).** The override flag may keep a vehicle Out of Service after its hold is released. Verify this in S12, then decide the override semantics.
- **B-75 + B-R4.** Removing an already-recorded Agency Training roster row makes every later Save All on that event fail with a 409. The page Refresh doesn't reload the board, so the only exits discard edits.
- **C-64.** Notes typed in the firearm Restricted tab check-in/out are dropped.
- **Errors behind modals, on the paths the RC added (part of WP-1):**
  - E-01: invite 409 "already a member".
  - B-49: certification 400s.
  - D-08: the B4 odometer correction prompt.
  - These are new server responses that currently land invisibly.
- **E-52.** Super Admin module switches become effective in aws-native with B2 (NEW-ADM-C) and have no confirmation.

**Recommended handling.** Add one small batch, **`UX-RB` (release-safety UI fixes)**, branched from the integration branch in the same way as B0–B11. It contains RB-1 to RB-6 plus the list above. Add the new staging steps (§7.4) to `STAGING-VERIFICATION.md`, then proceed with the existing staging gates G1–G7. Estimated size is about 2–4 days of focused work, with no migrations and no API contract changes except the RB-2 400 on a missing `result`. The native client has no firearm-inspection route, so that 400 does not need a native contract row.

---

## 3. Which environment each defect affects

> **Correction (2026-10-22, read-only provenance check; details in `docs/remediation/UX-RB.md` §0 on `claude/fix-uxrb-release-safety`).**
>
> - **Production is not `564ff78`.** Production serves `/api/mobile/session`, `/api/mobile/qr/resolve` and `/api/mobile/inbox`. The inbox route was first added in `555f061` on Oct 9, so production is at least as new as the staging line.
> - **Source commits.** The deployment ids the two environments serve, which are their source commits, are `5700011…` (production) and `22e543d…` (staging). **Neither exists in the GitHub repository.**
> - **Treat as live in production:** C-63 / C-R2 / C-64 (firearm custody) and the Inventory defects D-62, D-63, D-65 and D-70.
> - **Still needed:** read-only AWS access for image digests.


**Caveat: the production commit is not recorded.** The operational reconciliation (`R1-provenance-and-architecture.md` §2) *infers* that production runs CU `564ff78` or a commit from Sep 29–30. Live checks today show that production and staging both serve the Cognito sign-in page, which is consistent with that inference.

**Action G0 (owner, read-only):** record the production ECS task-definition image digest and its source commit before any further planning depends on it.

| Where the defect is | Count | Findings |
|---|---|---|
| **Likely production + staging + RC** (not caused by the remediation) | ~94 | Includes the sign-in deep-link loss (A-64), raw JSON auth failures (A-65), Settings false/absent success (E-04, AE-R1), group-membership wipe (E-02), Badge ← Employee Number mis-map (E-39), browser-local alert acknowledgements (B-60/61/62), pre-passed checklists (C-03 default, D-04), "Safe to operate" default (D-09/D-10), prefilled magazines (C-08), "all clear" shown on load error (C-26), errors behind modals (E-01, B-49, D-08, C-48), and range B-01/02/03/04/16/24 in their PROD form |
| **Likely production + staging + RC, but RC-worsened** | 10 | B-05 (→ RB-1), C-03/C-06 (→ RB-2), D-58 (→ RB-3), B-69 (→ RB-6), B-16 (firearm change keeps the old pass), B-49 / D-08 / E-49 (more server responses land invisibly), D-27 |
| **Staging + RC, not likely production** | 6 | C-63 (→ RB-4), C-R2, C-64, and **Inventory** D-62 / D-63 / D-65 / D-70, because `/inventory` does not exist in the likely-production tree |
| **RC only (introduced by a batch)** | 7 | B-70 + B-R2 (→ RB-5), D-59 (→ RB-3), D-60, D-R1, D-R2, B-75 / B-R4, B-R5 (→ RB-1) |

**Implications:**
- **No production hotfix is recommended from this audit.** The production-present items are long-standing. None is newly harmful. All are better fixed in the normal batch path with tests. The existing *date-contract hotfix candidate* (DC, "likely live in production") remains the only production-urgent item, and it is owned by the operational remediation.
- **If G0 shows production is newer than `564ff78`** (for example, a staging-line image), C-63, C-R2, C-64 and the Inventory defects are **already live in production**. In that case RB-4 and WP-6 move up, and a targeted production fix for RB-4 should be considered.
- If production is confirmed as `564ff78`, then promoting the RC is the moment Inventory, Restricted custody and the record-page transfer first reach production. Their defects must be fixed before promotion (RB-4; WP-6 Inventory items D-63/D-65).

---

## 4. Reconciliation results

| Assignment status | Count | Meaning | Handling |
|---|---|---|---|
| **ASSIGNED-FIXED** | **0** | An operational batch fully fixes the UI symptom | — |
| **ASSIGNED-PARTIAL** | 34 | A batch fixed the data or server; the screen still misleads or loses input | Add the UI remainder to a work package below. Do not reopen the batch. Reference the batch in the PR. |
| **OA-KNOWN-UNASSIGNED** | 31 | The OA recorded it, but deferred it, left it to an owner decision, or never put it in a batch | Needs an owner decision (§8), or adoption into a package |
| **NEW-UNASSIGNED** | 50 (+10 found during verification) | Not in the OA and not fixed by any batch | **New work.** Assigned below. |

Reviewer severity across the 115 findings was S1 ×1, S2 ×30, S3 ×53, S4 ×31. §2 applies the release-blocker override.

**Root-cause merges.** These are the reason 125 items become 16 units of work:
- **Range save state:**
  - B-01 + B-21 + B-69 (row status is local, not server-acknowledged);
  - B-02 + B-70 + B-R2 (concurrency recovery);
  - B-03 + B-24 (load, failure and offline cannot be told apart);
  - B-16 + B-R1 (the auto result is stored in the override field).
- **Range save feedback:** B-11 + B-12 + B-13 (feedback only in the header button).
- **Range completion:** B-05 + B-R5 (completion semantics).
- **Firearm custody:** C-63 + C-01 + C-64 + C-R2.
- **Firearm inspection:** C-03 + C-06 + C-07, and C-04 + C-05 (no inspection history, post-save redirect).
- **Firearm counts:** C-02 + C-11 (status normalisation in counts) and C-08 + C-23 (magazine inputs).
- **Vehicle QR:** D-01 + D-02 + D-03 (QR story and copy).
- **Vehicle inspection:**
  - D-04 + D-51 (FLT-10, prefilled inspection);
  - D-09 + D-10 (operability control);
  - D-58 + D-59 (inspection outcome contract);
  - D-15 + D-60 (status controls ignore holds).
- **Modal plumbing:** D-08 + D-57 + D-38.
- **Inventory ledger:** D-65 + D-70.
- **Settings save lifecycle:** E-04 + E-06 + E-07 + AE-R1; also E-01 + AE-R1 (Settings feedback missing on both failure and success).
- **Notification sources:** A-28 + E-58.
- **Sign-in continuity:** A-64 + A-65 + A-47.
- **Dashboard failure state:** A-34 + A-35.
- **Training alerts:** B-60 + B-61 + B-62 (TRN-20, persistence).
- **Agency Training roster lifecycle:** B-55 + B-75 + B-R4.

---

## 5. Work packages and implementation sequence

Rules for every package:
- **One root cause per PR.**
- **Fix at the lowest layer**, which is usually by extracting the page logic into `src/lib` with tests. `idle-session-core.ts` is the existing pattern.
- **No migrations unless named.**
- **No API contract change** without a row in `NATIVE-CLIENT-CONTRACT-CHANGES.md`.
- **No feature additions.**

Effort: XS < ½ day, S ≈ 1 day, M ≈ 2–4 days, L ≈ 1–2 weeks.

### Phase 0: release safety (now, inside the RC)

| Package | Contents | Effort |
|---|---|---|
| **UX-RB** | RB-1 … RB-6 (§2), plus the "before production promotion" list | ~1 week total, as several S items |

**Exit criteria:**
- CI green.
- New tests from §7.3 passing.
- New staging steps S25–S31 added to the verification package.
- Then the owner runs the existing G1–G7 gates.

### Phase 1: operational correctness (after the RC is verified in staging, in order)

| # | Package | Root causes and findings | Primitive introduced (§6) | Owner decisions | Effort |
|---|---|---|---|---|---|
| **WP-1** | **Feedback where the user acted; one tap = one record.** | Errors behind dialogs: E-01, B-49, D-08 (+D-57 reason field placement), C-48 (drawer + `window.alert`). Success never shown: AE-R1, C-05. Stuck "Saving…": B-R3. Double-submit: C-07 (if not done in RB-2), D-65, C-48. Range feedback location: B-11/12/13. | `Dialog` error slot, `SubmitButton` (busy + idempotency key), `InlineStatus` | — | M |
| **WP-2** | **Loading is not empty; failure is not "all clear".** | C-26 (green "no firearms need inspection" on a load error), C-37 (blank reconciliation), B-24, B-40, A-34 + A-35, D-28 + C-57 (failed rules load allows saving defaults over policy), B-03 (offline copy can overwrite the server), D-48 (fake preview vehicle on errors) | `LoadState` (loading / error + retry / empty / stale-copy) | B-03: offline policy, consistent with the RNG-02 deferral | M |
| **WP-3** | **Safe defaults and stated consequences.** | Checklist defaults C-03 (items) and D-04 + D-51. Operability D-09 + D-10. Magazines C-08 + C-23. Status normalisation C-02 + C-11 ("Unknown", not "In Service"; Available = unassigned **and** In Service). Off-duty expiry C-55. Unconfirmed privileged or irreversible actions: E-50, E-52, E-12, E-13, C-44, C-21. | `SegmentedControl` (no default value), `ConfirmDialog` / `ReasonDialog` | ARM-15 / FLT-10: prefilled checklists, or an explicit "Mark remaining as Pass". C-55: use `renewalDays`. | M |
| **WP-4** | **Range record integrity (UI remainder of B3/B10).** | B-01 + B-21 + B-69 (per-row sync state from server acks), B-16 + B-R1 (store the override separately), B-04 (warn before a drill/run switch drops typed scores), B-02 (server-side merge: **L**, needs a decision), B-31 (name-based qualification override), B-33 | uses WP-1/WP-2 | B-02 concurrency model (B3 open item) | M (+L for merge) |
| **WP-5** | **Settings and configuration integrity.** | E-04 + E-06 + E-07 + AE-R1 (one save model: SaveBar per panel, background refresh, dirty guard), E-02 (Save disabled until groups load), D-27 (if not in UX-RB), D-26, E-14 (legacy rank/unit values), A-28 + E-58 (Critical items cannot be muted, or the hint says so), E-16 (label "recorded, not enforced" or wire it, per ADM-13), E-03 | `SaveBar` + `useDirtyGuard` | E-58: may Critical be muted? E-16: hide or wire. | M |
| **WP-6** | **Custody, inventory and armory records.** | Inventory: D-62 (names, not UUIDs), D-63 (inventory-scoped recipient endpoint), D-70 (consumable draw-down, by exposing the existing `adjust`; otherwise fix the copy). C-01 copy and link after RB-4. C-R1 (Save Draft reverts a Submitted reconciliation). C-32 residual (ammunition last-write-wins outside counts, ARM-21). C-38. C-04 (list inspection history from the existing GET). D-14, D-22. | `SearchablePicker` hardening | D-70: expose `adjust`/consume, or correct the copy | M |
| **WP-7** | **Sign-in and navigation continuity.** | A-64 + A-65 + A-47 (sealed `next` through PKCE; HTML redirect to `/login?notice=`; idle countdown shared across tabs), A-49 (sign-in reachable on a phone, or signed-out `/` → `/login`), A-22, A-29 (comes with **B6**; expect a merge conflict with B11), V-01/V-02 (Cognito managed-login branding and email input type: **configuration, not code**) | — | A-49: front door for signed-out users. Hosted-UI branding approval. | S–M |
| **WP-8** | **Training-alert persistence.** | B-60 + B-61 + B-62 (= TRN-20): acknowledge/resolve stored only in the browser, hard-coded remediation assignee, no actor in the audit | — | Needs server persistence and **probably a migration**. Assign to the operational remediation (the B7 follow-on), not UI work. **Interim:** label "This device only". | M (+migration) |
| **WP-9** | **Import and admin accuracy.** | E-39 (remove the "employee number" → Badge alias; show sample values; flag duplicate mappings), E-42 (use the server's created/updated status; confirm with a count), E-43, E-37, E-49 | `ConfirmDialog` | — | S–M |
| **WP-10** | **Fleet manager and inspector visibility.** | D-12 (show failed items and notes in history), D-60/D-15 (if not in UX-RB), D-R1 (if not in UX-RB), D-01/D-02/D-03 (honest web QR copy; printing for managers), D-05 (web evidence: OA FLT-03 deferred capability, so **Phase 2**) | — | D-01: the web-only scan story (with the FLT-04 owner) | S–M |

**Sequence and parallelism:**
1. **UX-RB** (blocking).
2. **WP-1 and WP-2** first, because they create the shared primitives the rest depend on and they cover the most production-present misleading-success items.
3. **WP-3, WP-4 and WP-5** can then run in parallel; they touch different modules.
4. **WP-6** follows RB-4.
5. **WP-7** can run any time; it is isolated to the auth files.
6. **WP-8** belongs to the operational stream.
7. **WP-9 and WP-10** last.

**Batching.** Each package ships as its own branch and PR through the same integration → staging verification → production authorization path as B0–B11. **No package should contain more than one module's UI changes** except WP-1 and WP-2, which are primitive-led and touch every module.

### Phase 2: workflow simplification (usability only, after Phase 1)

These items come from the audit README §8. None adds a feature:
- range scoring flow on phones: tab strip, "Save & next run", unscored filter;
- finalize as an explicit step with a lock banner and reopen-with-reason (B-08/B-09 = RNG-04/RNG-21, coordinated with the OA);
- armorer issue, return and inspect from one place at any width;
- Quick Inspect opens the form directly (D-06);
- officers see their own records first;
- one editor per policy;
- import split into Import / Export / Reports tabs;
- reviewers land in review mode;
- duplicate entry points merged;
- Inbox items link to the record (A-31).

### Phase 3: UI standardization rollout

See §6.

---

## 6. Phased UI standardization plan

**Principle.** Primitives are introduced **by the defects that need them** (Phase 1). They are adopted broadly only afterwards, one module per release, behind a parity checklist. No screen loses an action, field, state or route.

| Stage | When | Scope | Guardrails |
|---|---|---|---|
| **S0: Foundations, zero visual change** | Alongside WP-1 | Tailwind v4 `@theme` tokens that reproduce today's palette exactly; the status registry (enum → label, tone, icon) with today's colours; formatters (`formatEnumLabel`, person display name). `src/lib/format/date` is already shared. | Pixel-diff the 12 reference screens (§7.2) before and after: **zero diff expected** |
| **S1: Primitives built in Phase 1** | WP-1 to WP-5 | `Dialog` (error slot, Escape, focus trap, sticky footer, mobile sheet; seed `FleetWorkOrderDialog`), `SubmitButton`/`Button`, `InlineStatus`/`Toast`, `LoadState`, `ConfirmDialog`/`ReasonDialog`, `SegmentedControl`, `SaveBar` + `useDirtyGuard`, hardened `SearchablePicker`. Each is adopted **only** where a defect is being fixed. | Each primitive gets unit and accessibility tests at creation. The API is frozen after first adoption. |
| **S2: Field screens** | After Phase 1 | Vehicle inspection, firearm inspection, range scoring, Home, inventory checkout: ≥44px targets, a 12px text floor, sticky primary action with inline result, phone-width layouts | Task-time and tap-count measured before and after on 390×844. Parity checklist per screen. |
| **S3: Module adoption** | One module per release: Armory → Fleet/Equipment/Inventory → Training/Range → Settings/Admin → Platform | Replace local modals, badges, buttons, headers, empty states and native `confirm`/`prompt`/`alert` with the primitives. Mobile card mode for wide tables. | Parity checklist, screenshot diff reviewed by the owner, module-scoped regression suite green, ratchet metrics only go down |
| **S4: Shell and information architecture** | After S3 for at least 3 modules | Route-group layout (shell mounted once), `PageHeader`, URL-synced tabs, nav labels from one route-metadata map, agency switcher (A-09), Help ↔ nav label tests | Every existing URL keeps working; redirects where renamed |
| **S5: Content and terminology** | Continuous, closing with S4 | Glossary rollout (README §4.3); remove developer, vendor and roadmap copy; delete backups and dead components | A banned-strings check in CI |

**Ratchet metrics.** `evidence/scripts/inv.sh` already measures these. CI should fail if any of them increases:
- `window.confirm`/`alert`/`prompt` count;
- `fixed inset-0` outside `Dialog`;
- distinct button class strings;
- `text-[≤10px]` on field screens;
- local status maps.

---

## 7. Regression-testing requirements

### 7.1 Gate for every package (in addition to the existing `Application quality gate`)

| Layer | Requirement |
|---|---|
| **Logic** | Each defect's decision logic is extracted from the page into `src/lib/**` and covered by `node:test` table tests. Examples: batch-row builder, outcome message, completion resolver, status normaliser, availability count. The test must fail on the RC code and pass on the fix. |
| **Route** | Every server-side change has a route test, following the existing pattern. Every new 4xx path has a test asserting its message names the record (officer or item). |
| **Page ↔ route contract** *(new)* | For every route whose client body a page builds, export the body builder (or a shared schema) and test that its output is accepted by the route's validator. **This would have caught C-63.** Start with the routes the RC changed: firearm custody, armory inspections, fleet inspections and work orders, the range workspace, settings users/invite and inventory transactions. |
| **Component / UI** *(new; needs approval)* | Add a UI test layer: React Testing Library + jsdom for component tests, plus Playwright (already installed) for flows. **Auth decision needed:** e2e needs either a test-only session fixture (env-guarded and security-reviewed) or synthetic Cognito users on staging. Until it exists, the §7.4 staging steps are the UI gate. |
| **Native compatibility** | Any change to an `/api/mobile/**` response, or to a route the native client re-exports, needs a contract row (C33 onwards) and an S-step. |
| **Metrics** | Ratchet check (§6). Banned-strings check (`Supabase`, `Cognito`, `next build step`, `Coming soon`, `?`-mojibake…) on user-facing strings. |

### 7.2 Reference screens

Capture these at 1440×900 and 390×844, and re-capture them for every Phase 3 stage:
1. Home
2. `/notifications`
3. `/firearms` (Standard and Focus views)
4. `/firearms/[id]`
5. `/firearms/inspections/new`
6. `/range-days` (scoring tab)
7. `/qualifications`
8. `/fleet-management/[id]` (inspection)
9. `/equipment`
10. `/inventory`
11. `/settings` (Rules → Fleet)
12. `/settings/import-export`

### 7.3 Required tests for the release blockers

| Item | Tests (each must fail on RC `5b6cc00`) |
|---|---|
| RB-1 | Table test over 6 scoring formats × {untouched, 1 tap, 2 taps, note only, Result=Pass}. Assert that the *displayed* completion equals the *persisted* `completed`, and that no deficiency or remediation flag is set for Notes-Only or no-standard drills. |
| RB-2 | Route: a POST without `result` returns 400. Route: firearm in Inspection Required + explicit Passed → In Service; omitting the result never changes status. Logic: Save is disabled until a result is chosen. Busy state: a second submit during the first is ignored. |
| RB-3 | `inspectionOutcomeMessage()` table test over: no defects; defects + work order; critical + hold without a work order; audit pending; audit unrecorded; 500 with `inspection`. |
| RB-4 | Contract test: the page's transfer body is accepted by the custody route validator. Route: button eligibility equals RPC 031 authorisation (assignee or `manage_restricted_firearm_custody` with an active `duty_only` restriction). Display: history shows the notes. |
| RB-5 | Logic: re-apply unsynced results onto a fresh workspace (no loss, no duplicates, stale flag cleared). Route: two PUTs from the same base, then client recovery. |
| RB-6 | Shared validator unit test (same cases on client and server). Route: the 400 names the officer. Logic: the queue does not mark rows "Saved" until acknowledged. |

### 7.4 New staging steps to add to `STAGING-VERIFICATION.md`

| Step | Action | Expected |
|---|---|---|
| S25 | Score a Completion drill without touching the toggle; Result = Pass; save; reload | The displayed state equals the stored state |
| S26 | Fail a firearm inspection; then open New Inspection for it and press Save without choosing anything | Blocked; status unchanged |
| S27 | Turn off "defect creates work order"; submit a critical defect | The message says Out of Service / held, and the audit warning is shown if the audit is pending |
| S28 | `/firearms/[id]`: transfer to secure storage and back (or the replacement link) | Succeeds; history shows the notes |
| S29 | Two instructor devices; device B saves after device A; device B recovers | No result is lost; saves resume without a page reload |
| S30 | Enter an impossible score | The row is blocked with the officer's name; other rows keep syncing |
| S31 | Fleet Rules: type two inspection role codes; force a rules-load failure | Both codes save; Save is disabled on load failure |

---

## 8. Owner decisions required, in order of need

1. **G0:** record the production image digest and source commit. This determines whether RB-4 and the Inventory defects are already live (§3).
2. **RB-1:** the default state for Completion drills (Complete, Incomplete or Not recorded).
3. **RB-4:** fix the record-page transfer, or remove it in favour of the Restricted tab.
4. **ARM-15 / FLT-10 (WP-3):** whether checklists may be pre-filled, or need an explicit "mark remaining as Pass".
5. **B-02 / RNG-13:** the concurrency model for multi-device range scoring (server merge vs. per-result writes).
6. **UI test infrastructure:** approve React Testing Library + jsdom, and the e2e auth approach (§7.1).
7. **E-58:** whether Critical inbox items can be muted.
8. **E-16:** hide the unenforced session-timeout and MFA controls, or wire them (ADM-13).
9. **A-49:** what a signed-out user sees at `/`.
10. **D-01 / FLT-04:** whether QR labels should support web-only users (an HTTPS form) or remain native-only, with honest web copy.
11. **D-70:** expose consumable draw-down, or correct the copy.
12. **D-R2:** whether a safety hold should clear a manual status override.
13. **Cognito hosted-UI branding** (configuration).

---

## 9. What authenticated staging testing must validate

No authenticated session was available to either audit. Use synthetic tenants and users only (`acceptance-<UUID>`), with the roles officer, instructor (score-only), lead instructor, armorer, fleet manager, inventory clerk (`adjust_inventory` only), supervisor/command, department admin and platform admin.

| Area | Validate | Findings |
|---|---|---|
| Release blockers | S25–S31 before **and** after `UX-RB` (the before run proves the defects; the after run proves the fixes) | RB-1 … RB-6, D-27/D-28 |
| Sign-in continuity | A deep link (email, inbox, Help) while signed out → land on the record; cancel at the hosted UI; let the flow cookie expire; use two tabs with one idle | A-64, A-65 (verified on unauthenticated paths), A-47 (multi-tab, *suspected*) |
| Hidden feedback | A server error in each dialog: certification, vehicle, equipment, invite (409), off-duty drawer, Assign Password | E-01, B-49, D-08, C-48 |
| Settings saves | Edit Off-Duty rules, then press the header "Save Rules Engine" and reload; check whether success messages appear | E-04, AE-R1 |
| Range | Two devices on the same day; an offline copy after a failed GET; firearm change after typing a score | B-02/B-70, B-03, B-R1 |
| Safety holds | Hold, attempt a status change, release, then check the status | D-60, D-R2 (runtime-dependent) |
| Inventory | A clerk checks out to another officer; a double-tap on Check out; a consumable | D-63, D-65, D-70 |
| Data-dependent | Query staging for legacy firearm `condition_status` values and legacy rank/unit strings | C-02, E-14 |
| Multi-agency | Deactivate a user who is still active in another agency, then check whether they can still sign in | E-12 / AE-R2 |
| Super Admin | Module toggle effect under aws-native | E-52 |
| Phone width | 390×844 walk-throughs of vehicle inspection, range scoring, firearm inspection and inventory checkout: tap counts and target sizes | D-07, B-14, C-29, A-26 |
| Role reachability | Officer reaches personal-rifle submission, own qualifications and certifications, My Notifications | C-41, A-18, B-42, B-51 |

---

## 10. What remains unreviewed in the native mobile app

**The native client source is not in any accessible repository** (`NATIVE-STAGING-BUILD.md`: "Local / not pushed"). Nothing about its UI has been reviewed. The server contract is documented: the session bearer, QR resolve, fleet, equipment custody, range workspace, inbox, and contract rows C1–C32.

These items need review once the source or a staging build (G6) is available:

| Area | Why it matters | Related |
|---|---|---|
| Sign-in: `tracepoint://auth`, MFA (TOTP), the 5-minute access token and rotating 1-day refresh | Re-session after each refresh is required (`/api/mobile/session`); a failure loops to 401 | C21, C23 |
| QR scan → resolve → workflow | The only way printed labels work. Needs coverage of: 409 ambiguous (open nothing), denied vs unknown, the never-before-allowed vehicle path (C7), and **scan ≠ custody confirmation** wording. | C3–C8, D-01, C-59 |
| Vehicle inspection form | Does the app also pre-pass items or default "Safe to operate"? Does it show the hold, `audit.message` and the 500-with-`inspection` "do not resubmit" case? | RB-3, D-04, D-09/D-10, C13–C17 |
| Evidence capture | The web has no photo capture; the app may (FLT-03). Check the upload limits and failure handling. | D-05, C24 |
| Equipment custody | Checkout and return, the new 409 texts, and the damaged → out of service mapping | C18, C19 |
| Range workspace | Whole-workspace PUT; `baseUpdatedAt`; `resultRevisions`; the 400 for impossible scores. **Does the app have the same RB-5/RB-6 stall and loss behaviour?** | C9–C11, C25–C27 |
| Inbox | Unknown kinds, `href` handling, B6 changes | C22 |
| Date and time parsing | DC and DC2 formats; this is known to be breaking | C1, C2, C31 |
| Offline and poor connectivity | No reviewed behaviour; the web equivalent is RNG-02 (deferred) | — |
| Accessibility, tap targets, terminology parity with the web glossary, and status colours | Field use outdoors, with gloves | README §4 |

## Live staging verification (2026-10-22)

The owner's authenticated browser testing on staging `22e543d` confirmed SV-28 to SV-32. They are reconciled in [reconciliation/register-SV.md](reconciliation/register-SV.md) against the existing entries (C-63/C-R2, E-04/E-06/E-07/AE-R1/E-02, D-28, A-64/A-65/A-47, B6), with one new finding: the staging line narrowed ordinary firearm custody transfers to restricted-only.

## 11. Open requirements carried forward (do not drop)

These are owner requirements that the release candidate meets only with an interim measure. Each stays open until its database change is reviewed, applied and verified.

| ID | Requirement | Interim state in the release candidate | To close | Lane |
|---|---|---|---|---|
| **R-WD-1** | A **dedicated permission** for withdrawing a submitted ammunition reconciliation (owner decision on C-R1, 2026-10-22: specific management permission, a reason, and an audit record) | Withdrawal is limited to `administer_department` (`src/lib/armory/reconciliation-withdraw.ts`, `RECONCILIATION_WITHDRAW_PERMISSIONS`). It needs a reason, and the withdrawal and its audit row are written in one statement. The administrator rule is enforced by the route only: at the database level, any `manage_firearms` holder can make the change under the 052 update policy and `audit_events_insert_managers`. | A migration that: adds the permission to the catalog (Administrator by default); makes the Submitted-to-Draft change require it (052 update policy or a security-definer function), with the audit row in the same transaction; and switches the route and the page's `canWithdraw` to it. A real-schema test with the permission granted and withheld. | B (migration) + A |

**R-WD-1 evidence (2026-10-22): accessible routes that can withdraw without the administrator check and the audit record.**

- **Deployed staging (`22e543d`) and production (`5700011`): yes, directly.** C-R1 is present there: Save Draft on a Submitted reconciliation returns it to Draft for any `manage_firearms` user, with no reason and no audit record. This is fixed only in the release candidate.
- **Release candidate: race fixed in `c844398`** (owner-approved release blocker). In `a628e6c`, `save`/`submit` rewrote the item rows and then updated the parent with no status condition. On AWS-native, Save Draft and Submit are now one transaction under the reconciliation's row lock, and only a Draft is edited. Competing requests get a 409 and write nothing. This is proven on real PostgreSQL by `scripts/validate-local-reconciliation-concurrency.ts`. The bridge client uses compare-and-set, with a documented residual for fully overlapping requests; it is not used in staging or production.
- **No other route** writes `ammunition_reconciliations`. The generic `/api/settings/data` table allowlist does not include it.
- **Database: still open.** 052 and `audit_events_insert_managers` allow any `manage_firearms` holder to make a Submitted-to-Draft change directly in the database. No application route now does so without the administrator check, a reason and an audit record. Only R-WD-1 closes the database gap.

Source: `docs/remediation/FINAL-CANDIDATE-20261022.md` §7 on `claude/integration-final-20261022`.
