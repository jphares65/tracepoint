# Remediation batch UX-RB2: remaining pre-production fixes

- **Base:** UX-RB (`claude/fix-uxrb-release-safety`), itself on RC `origin/claude/integration-defects-20261020` @ `5b6cc00`.
- **Lane:** A (application only). No database migration. No infrastructure or security change.
- **Scope:** the items the remediation plan lists as needed before production but outside UX-RB (plan §2, "pre-production"), plus the owner's item 6 (vehicle inspection API default-to-Pass).
- **Not deployed.** Staging deployment needs separate authorization.

## 1. Fixes

| ID | Defect (register) | Fix | Contract / flag |
|---|---|---|---|
| **UX-RB2-1** | Vehicle inspection API saved an item with a missing or unknown `condition` as Pass, or inferred it from the equipment record. A zero-touch submission from any client could record a passing inspection (owner item 6). | Every expected item needs `Pass`, `Defect` or `Critical`. Otherwise the response is 400 `inspection_items_not_answered` with `items: [{id,label}]`, and nothing is saved. An explicit Defect on a critical item is still stored as Critical. | **Breaking for a native client that omits `condition`.** Row **C33** in `NATIVE-CLIENT-CONTRACT-CHANGES.md`. The web form already sends every answer. Compatibility cannot be verified because the native source is not in either repository; the owner should confirm before release (§3). |
| **UX-RB2-2** | D-27: Fleet Rules comma lists dropped a typed comma, so a second inspector role could not be entered. Under F2 a mis-entry locks officers out of inspections. D-28: a failed rules load showed the defaults, and Save wrote them over the agency's rules. | Lists keep the text as typed and save the trimmed, de-duplicated codes. A failed load shows the error and Try again, and Save is unavailable until the rules load. The inspector-role hint now states the F2 rule. | — |
| **UX-RB2-3** | D-R1: Quick Inspect, Report Issue and the inspection form were shown to users that F2 refuses, who filled in the form and then got 403. | The vehicle detail GET gains `canInspect` and `canReportIssue`, computed by the POST routes' own rules. The page hides the buttons and the form and explains why. | **Additive** on the re-exported `/api/mobile/fleet/vehicles/[vehicleId]`. Row **C34**. |
| **UX-RB2-4** | D-60, D-15: a critical safety hold showed on one card only. Available and Attention stayed clickable but the server keeps the vehicle Out of Service, and the list reported "status updated". | Header badge ("Critical safety hold" / "Open critical work"). Statuses the hold refuses are disabled with the reason. The list reports the status the server applied. | The list does not badge held vehicles, because the list API has no hold field (WP-10). |
| **UX-RB2-5** | B-75, B-R4: removing an Agency Training attendee with a recorded result made every later Save All fail with 409, and Refresh did not reload the board. | Remove is disabled for recorded attendees. If the server still keeps one, the board reloads, puts the attendee back, keeps the other edits and asks to save again. The page Refresh reloads the board, asking first when there are unsaved edits. | — |
| **UX-RB2-6** | E-52: Super Admin module switches took effect agency-wide on one tap, with no confirmation. | Turning a module off asks first, naming the module and agency and stating the effect. Either change then shows a notice. | — |
| **UX-RB2-7** | E-01, B-49, D-08, B-R3: failures from dialogs (the invite 409, certification 400s and closeout lock, vehicle saves) went to the page banner behind the dialog. The odometer-correction prompt's Cancel did nothing. A network failure left certification Save stuck. | The failure is shown inside the dialog (role=alert) and the dialog stays open. The correction reason is a field in the vehicle dialog. Certification requests are wrapped in try/finally. | An existing source-contract assertion (`granular-permissions.test.ts`) that pinned the old banner behaviour was updated to the new contract. |

## 2. Evidence

`ux-rb2-evidence/rb2-N-before.txt` holds each batch's tests run against the code before its fix (they fail). `rb2-N-after.txt` holds the same tests after the fix (they pass).

Tests added:
- RB2-1: three handler tests through the real inspection POST, in `fleet-integrity.test.ts`.
- RB2-2: `rules-form.test.ts`, plus RTL `FleetRulesPanel.test.tsx` (typing, save body, failed load, Try again).
- RB2-3: a handler test (web and mobile GET agree with both POST routes) plus a page contract.
- RB2-4: `status-change.test.ts` plus page contracts.
- RB2-5: RTL `AgencyTrainingRosterBoard.test.tsx` (disabled remove; a 409 restores the row and the next save succeeds; Refresh reloads).
- RB2-6: `module-switch.test.ts` plus a page contract (nothing is sent before the confirmation).
- RB2-7: `reading-correction.test.ts` plus `dialog-errors-contract.test.ts` across the three pages.

Local gate: `tsc` passes with 0 errors and lint shows no new findings in the changed files. Application tests show the same embedded-PostgreSQL failures as UX-RB (they cannot run as root here; CI runs them). `next build` succeeds.

## 3. Owner decisions needed before release

1. **C33 (native).** Confirm that the native app sends `condition` for every vehicle inspection item. If it does not, the app must be updated before this change reaches the server it uses (staging only today; production has no mobile client).
2. **Range conflicts (UX-RB §3.5–3.6).** Conflicts now stay until resolved. After an unpredictable refusal, every unsynced change on that device is held back for review.

## 4. Staging steps (after authorization)

| Step | Action | Expected |
|---|---|---|
| S31 | Fleet Rules: type `patrol, sergeant` into inspector roles and Save. Then block `/api/fleet/rules` and reload. | Both codes are saved. On failure, the error and Try again are shown, with no Save. |
| S32 | As a `view_fleet` user whose role is not listed, open a vehicle. | No Quick Inspect, Report Issue or inspection form; an explanation is shown. |
| S33 | Hold a vehicle with a critical defect, then try Available from the vehicle page and the list. | Disabled on the page; the list says "stays Out of Service". |
| S34 | Agency Training: record attendance for an attendee, then try to remove them. Then have another instructor record attendance and remove the attendee on the first device. | Remove is disabled. On the second device the attendee is put back with a message, and Save then succeeds. |
| S35 | Super Admin: turn a module off and cancel; then confirm. | Nothing changes on cancel. On confirm, a notice names the module and agency. |
| S36 | Invite an existing member. Save a certification closed by event closeout. Lower a vehicle's mileage. | Each error appears inside its dialog. The mileage correction asks for a reason in the dialog. |
| S27-N / S27-R | See C33 / C34. | — |
