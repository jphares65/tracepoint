> **Appendix to the [TracePoint UI/UX audit](README.md).** Baseline: release candidate `origin/claude/integration-defects-20261020` @ 5b6cc00 ("RC"). Unless stated, `path:line` references point into that tree (`src/...`). "OA" is the operational defect audit on `origin/claude/tracepoint-operational-audit-w567t8` (`docs/operational-audit-20261020/`). First-pass IDs were assigned against `origin/main` and are kept for traceability.

# Group A (re-verified against the release candidate): shell, navigation, home, auth, and the cross-cutting design system

**Baseline.** The first pass read `origin/main` (2026-10-07). This revision re-checks every finding against the release candidate `origin/claude/integration-defects-20261020` @ 5b6cc00 (code 5b9ec98). The RC was extracted to `$RC = <RC>`. In this file, every path:line is an **RC path relative to `$RC/src`** unless it says otherwise. The marketing repo `/home/user/tracepoint-landing` (32ad5d6) is not part of the RC and has not changed.

**Labels.** All evidence is source code. **[Source-evident]** means the code clearly renders this. **[Suspected]** means it needs a live check. Two exceptions are taken from facts already established on staging: staging uses Cognito managed login, which is two screens (the TracePoint page, then the default unbranded Cognito hosted UI with "Forgot your password?"), and the staging screenshots in `evidence/`.

**OA ref.** This column points to the operational defect audit (`opaudit/docs/operational-audit-20261020`) and its reconciliation:
- `=` means the same issue. Our report defers to the OA and adds only the UX angle given in the cell.
- `~` means a related or overlapping issue.

---

## Re-baseline summary

### Counts by RC status (63 original findings)

| RC status | Count | IDs |
|---|---|---|
| Present | 49 | A-01 to A-15, A-17, A-18, A-20, A-21, A-23, A-24, A-26 to A-29, A-31 to A-33, A-35, A-36, A-38 to A-40, A-46 to A-50, A-52 to A-61, A-63 |
| Partly fixed | 10 | A-16, A-19, A-22, A-25, A-30, A-34, A-37, A-43, A-51, A-62 |
| Fixed in RC | 1 | A-42 (= ADM-07) |
| Obsolete | 3 | A-41, A-44, A-45. Under Cognito (`aws-native`), `/activate` and `/auth/setup` redirect to `/login`, and passwords are set in the Cognito hosted UI. |

- **26** of the 63 findings carry an OA reference:
  - 6 are the same issue (`=`): A-18 = ADM-34, A-28 = TRN-22, A-34 = ADM-10, A-42 = ADM-07, A-51 = ADM-08, A-62 = ADM-30.
  - 20 are related (`~`).
  - In addition, 5 of the 8 new findings carry `~` refs.
- **8 new findings** were added: A-64 to A-71. Two are **High**: A-64 (sign-in always lands on Home and drops `next`) and A-65 (Cognito endpoint failures render raw JSON pages). Neither is in the OA.

### Notable RC changes in scope

- **Login is now Cognito managed login** (`login/LoginForm.tsx:92-102`, `login/page.tsx:37`). The TracePoint page shows a single "Continue with secure sign-in" button. That posts to `/api/auth/cognito/login`, which sends the user to the hosted UI.
  - The hosted UI owns passwords, MFA and "Forgot your password?".
  - `/activate`, `/auth/setup`, `/auth/callback` and `/auth/confirm` are disabled in `aws-native` mode (`activate/page.tsx:34,89`; `auth/setup/page.tsx:40,130,572`; `auth/callback/route.ts:9-13`; `auth/confirm/route.ts:25-27`).
- **The nav gained two entries:** "My Notifications" → `/notifications`, with no permission requirement (ADM-06), and "Inventory" (`components/TracePointShell.tsx:71`, `201-205`).
- **Feature gating is unified** in `lib/tracepoint/feature-gates.ts`, with no super-admin bypass in the nav (ADM-23).
- **Department appearance** now comes from the `/api/access` payload instead of a separate Supabase query (`TracePointShell.tsx:761-775`).
- **Home** takes the profile from the access hook instead of 3 Supabase queries (`page.tsx:228-235`).
- **`/notifications`** now embeds the shared `NotificationPreferencesPanel` (`notifications/page.tsx:130-132`), which brings a digest schedule, a dependent "Critical only" toggle and a saved message.
- **Command Dashboard** shows a per-card "Data unavailable" state and a source-failure banner (ADM-10; `command-dashboard/page.tsx:1338-1366`, `1760-1766`).
- **Help copy** for activation, reset, notifications, Agency Training and Fleet was rewritten (ADM-08; `help/help-content.ts:60-100`, `411-430`, `672-689`).
- **The idle sign-out** now submits a POST form through the Cognito logout chain (`components/idle-session-core.ts`).
- **`VisualCustomization`** saves through `/api/settings/visual-configuration` and gets fixed error copy.
- **The platform layout** uses `resolvePlatformAdminAccess` (`platform/layout.tsx`).
- **New shared `components/SearchablePicker.tsx`** (157 lines). It is a typeahead combobox with keyboard support, Escape, and loading, error, empty and "create" states. Only `inventory/page.tsx:855` uses it, while the app still has **136 native `<select>` in 32 files**. It is the natural seed for one shared officer, firearm, vehicle and location picker (A-68).
- **15 non-armory backup files were removed** (ADM-30).

### Design-system inventory, `origin/main` → RC

Both trees were measured with the same commands (`evidence/scripts/inv.sh`, `evidence/scripts/btn.py`), over `src/app/**/*.tsx` excluding `api/` unless noted.

| Metric | main | RC | Note |
|---|---|---|---|
| Page files rendering `<TracePointShell>` (usages) | 29 (35) | 30 (36) | +`/inventory`. The shell is still mounted per page (A-01). |
| `fixed inset-0` overlays (files) | 26 (19) | 26 (19) | No shared Dialog |
| `role="dialog"`/`alertdialog`/`aria-modal` | 9 | 9 | The first pass reported 8 using a narrower pattern |
| Files handling `"Escape"` | 2 | 5 | +SearchablePicker, InventoryCheckoutForm, TracePointQrLabel |
| `createPortal` / body scroll lock / autoFocus+`.focus()` | 0 / 0 / 4 | 0 / 0 / 4 | |
| `window.confirm` (files) | 14 (10) | **17 (11)** | +2 range-days (the RNG-04 finalize confirmation), +1 fleet vehicle |
| `window.alert` (files) | 4 (2) | **5 (3)** | +`AgencyTrainingCloseoutPanel` |
| `window.prompt` (files) | 6 (5) | **7 (5)** | +1 `fleet-management/page.tsx` |
| Toast system / `fixed bottom-*` toasts / `beforeunload` | 0 / 2 / 0 | 0 / 2 / 0 | |
| Files with local `notice/message/success…` state | 20 | 22 | |
| `<button>` elements | 437 | 487 | |
| Distinct button className strings | 321 | **359** | |
| Distinct className strings containing `bg-blue-600` | 84 | **90** | |
| Buttons `py-1/1.5`/`p-1/1.5` (~24–30px) · `py-2`/`p-2` (~32–36px) · ≥`py-2.5` | 46 · 224 · 124 | 47 · 256 · 127 | |
| Icon-only buttons without `aria-label`/`title` | 13 | 13 | |
| Arbitrary `text-[Npx]` (files) | 1,013 (43) | **1,036** (43) | |
| …of which ≤10px | 441 | 445 | 10px ×357, 9px ×80, 8px ×8 |
| `text-sm` / `text-xs` | 721 / 668 | 780 / 745 | |
| `<h1>` / distinct h1 class strings | 39 / 28 | 40 / 28 | |
| Local status/tone colour maps | 12 (16 grep hits) | 12 (16 grep hits) | Unchanged set; lines moved |
| Local Pill/Badge components | 10 | 10 | |
| Hex literals / `rgb()` / `dark:` / `bg-white` | 25 / 47 / 0 / 20 | 25 / 47 / 0 / 20 | |
| `text-emerald-*` uses (status colour hijacked by the emerald accent) | 178 | 185 | |
| `<table>` (files) / forced `min-w-[NNNpx]` | 17 (13) / 13 | 17 (13) / 13 | |
| Backup files under `src` | 35 `*.backup-*` + 1 `.bak` + 12 `.before-*` = **48** | **33** `*.backup-*` | All 33 remaining are armory/firearm files (8 in `api/armory`); ADM-30 deferred them |
| Native `<select>` (files) | n/a | 136 (32) | Reuse target for SearchablePicker |

**Net effect.** The RC fixed data correctness but added more ad-hoc UI on top of it: +38 button class strings, +6 primary-button variants, +4 native dialogs and +23 px font sizes. No design-system primitive was introduced except SearchablePicker.

---

## Platform shell & navigation

### Screens inspected (RC)

| Route / component | File (lines) | Notes |
|---|---|---|
| Root layout | `app/layout.tsx` (42) | Unchanged: `SupportModeBanner` + `{children}`, with no shared app shell |
| Global CSS | `app/globals.css` (26) | Unchanged starter tokens |
| App shell | `app/components/TracePointShell.tsx` (1025; was 1056) | +My Notifications and +Inventory entries; `features[]` gating; appearance comes from the access payload |
| Idle timeout | `IdleSessionGuard.tsx` (115) + `idle-session-core.ts` (14) | Signs out with a POST form submit |
| Dashboard customizer | `VisualCustomization.tsx` (368) | Saves through the API |
| Shared picker (new) | `app/components/SearchablePicker.tsx` (157) + `lib/tracepoint/searchable-picker.ts` (28) | Used only by `/inventory` |
| Support banner | `components/SupportModeBanner.tsx` (80) | Unchanged |
| Ops cards | `CommandOperationsPanel.tsx` (305) | Unchanged |
| Platform layout | `app/platform/layout.tsx` (17) | Uses `resolvePlatformAdminAccess`; 401 → `/login`, 403 → `/unauthorized`, any other failure → `/landing` |

### Observed patterns (RC)

- The shell is still **mounted per page** (30 page files). Access is still fetched `no-store` on every mount (`lib/tracepoint/useTracePointAccess.ts:121-130`). The appearance query was folded into that fetch, so there is one fewer request per page.
- The appearance theme is still the `[class*=…] !important` override block (`TracePointShell.tsx:640-680`).
- Nav gating is now consistent with the layouts (`MODULE_FEATURES`). Feature-off layouts still `redirect("/")` with no message.

---

## Home, Notifications, Command Dashboard, Help, Auth, Landing

### Screens inspected (RC)

| Route | File (lines) | Change vs main |
|---|---|---|
| `/` My Home | `app/page.tsx` (686; was 772) | Profile comes from the access hook; `formatDateTime` |
| `/notifications` | `app/notifications/page.tsx` (161) | Preferences replaced by `settings/components/NotificationPreferencesPanel.tsx` (405) |
| `/command-dashboard` | `command-dashboard/page.tsx` (1875) + `layout.tsx` | Source-failure handling (`lib/tracepoint/command-dashboard-sources.ts`) |
| `/help` | `help/page.tsx` (276, unchanged) + `help-content.ts` (774) | Copy refresh (ADM-08, ADM-07b) |
| `/login` | `login/page.tsx` (130) + `LoginForm.tsx` (193) | `aws-native` branch: one button → `/api/auth/cognito/login` → hosted UI |
| Cognito endpoints | `app/api/auth/cognito/{login,callback,logout,refresh}/route.ts` → `lib/authentication/cognito-transport.ts` | New. Read for UX only |
| `/activate`, `/auth/setup`, `/auth/callback`, `/auth/confirm` | as listed | Disabled in `aws-native`; they redirect to `/login` |
| `/unauthorized`, `/landing`, `/training`, `/import`, `/inspections`, `/personal-rifle-review` | | Byte-identical to main |
| Unauthenticated session routing | `lib/authentication/request-proxy-core.ts:5-9` | `/` → `/landing`; other routes → `/login?next=…` |
| Marketing repo | `tracepoint-landing/src/app/*` | Unchanged |

### Observed patterns (RC)

- Home and `/notifications` are still two separate inbox implementations. `/notifications` is now in the nav, but Home still doesn't link to it.
- **Sign-in is two screens plus MFA.** The `next` destination is not carried through the Cognito round trip (A-64), and failures are JSON documents (A-65).
- There is still no toast, no success confirmation for inbox actions and no Retry. The Command Dashboard now says "Refresh the page to try again" but offers no Refresh control.

---

## Findings

The Evidence column cites RC lines.

| ID | RC status | OA ref | Screen | Finding | Type | Impact | Evidence (RC) | Label | Recommendation | Effort |
|---|---|---|---|---|---|---|---|---|---|---|
| A-01 | Present | — | All shell pages | The shell remounts on every navigation, because 30 page files each render `TracePointShell`. Nav groups collapse, sidebar scroll resets, `/api/access` (`no-store`) is refetched and idle timers reset. **RC:** the separate appearance query is gone because it is folded into `/api/access`. | Usability | Medium | `layout.tsx:35-38`; `TracePointShell.tsx:409-411`; `useTracePointAccess.ts:121-130` | Source-evident | Use a route-group `(app)/layout.tsx` plus an access context provider. | M |
| A-02 | Present | — | Sidebar | While access loads, `permissions` and `enabledFeatures` are empty, so `hasEnabledFeatures` hides every gated child and the nav pops in afterwards. The AgencyCard shows "Verifying access…". This combines with A-01. | Usability | Medium | `TracePointShell.tsx:269-325`, `610`, `623` | Suspected (flicker), Source-evident (logic) | Render a skeleton nav, or cache the last access payload. | S |
| A-03 | Present | — | Appearance balanced / high-contrast | The `[class*="bg-slate-800"]` override also matches `hover:bg-slate-800/70` on every inactive nav link, so all nav items are filled and the active state is lost. The same happens with `text-slate-400` and `text-blue-` against their hover variants. | Functional defect | High | `TracePointShell.tsx:454`, `496` vs `668-678` | Source-evident | Use CSS custom-property tokens through Tailwind `@theme`. | M |
| A-04 | Present | — | Appearance overrides | `var(--tw-bg-opacity, 1)` is a Tailwind v3 variable, so every translucent slate surface becomes opaque. | Aesthetic | Medium | `TracePointShell.tsx:668-675` | Source-evident | Same fix as A-03. | M |
| A-05 | Present | — | Accent emerald / slate | The emerald accent repaints all blue as emerald, which collides with the success/status colour (now 185 `text-emerald-*` uses). The slate accent makes primary buttons look disabled. | Usability | Medium | `TracePointShell.tsx:652-666` | Source-evident | Separate the accent from the status palette. | S |
| A-06 | Present | — | Shell first paint | `useState(getStoredAppearancePreferences)` differs between server and client, causing a hydration mismatch and an accent flash. The department accent is now applied in a microtask after access loads (`:761-775`), so the flash window is the length of the access fetch. | Aesthetic | Low | `TracePointShell.tsx:711-714`, `920` | Suspected | Set the accent via a cookie or an inline script before hydration. | S |
| A-07 | Present | — | Global | Unchanged. `globals.css` has an unlayered `body{background:var(--background)}`, which is white in OS light mode, plus an unused token pair. | Aesthetic | Medium | `globals.css:3-6`, `15-26`; `layout.tsx:35` | Source-evident (cascade), Suspected (visibility) | Delete the starter tokens or point them at slate-950. | S |
| A-08 | Present | — | "Choose Agency" | The membership line still uses `.join(" ? ")` (a mangled `·`). The same mojibake appears in "Open Import Wizard ?" (`settings/page.tsx:2487`, group E). | Aesthetic | Low | `TracePointShell.tsx:879` | Source-evident | Use `" · "` and add a lint for a stray `" ? "` in JSX text. | S |
| A-09 | Present | — | Shell, multi-agency users | There is still no agency switcher after selection. Only the shell interstitial and `/super-admin` call `/api/active-department`. Help still says "return Home and select the correct agency context" (`help-content.ts:113`). The Cognito logout now clears the department cookie, so a sign-out and sign-in re-prompts; that is the only switch path. | Usability (role/access confusion) | High | `TracePointShell.tsx:778-893`; `cognito-transport.ts:146-149` | Source-evident | Add a switcher to the AgencyCard and show the agency name in the mobile header. | M |
| A-10 | Present | ~ ADM-32 | Shell access error | "TracePoint Access Error" shows the raw `accessError` with no Retry, Sign out or Help link. | Usability | Medium | `TracePointShell.tsx:896-915` | Source-evident | Add Retry (`refreshAccess`), Sign out and "contact your administrator". | S |
| A-11 | Present | — | Mobile header | The phone header shows only the logo and the hamburger: no page, section or agency name. | Usability | Medium | `TracePointShell.tsx:989-1000` | Source-evident | Derive the title from `NAV_ITEMS`. | S |
| A-12 | Present | — | Mobile drawer | The drawer has no Escape, focus trap or scroll lock, and screen readers hear two "close" buttons. | Usability | Medium | `TracePointShell.tsx:946-984` | Source-evident | Use a shared Sheet primitive. | S |
| A-13 | Present | — | Shell tap targets | Shell controls are too small to tap: hamburger ~38px, drawer close ~36px, **Logout** `px-2 py-1 text-[11px]` ~24px, nav children `min-h-9` at 12px. | Usability | Medium | `TracePointShell.tsx:996`, `963`, `626-634`, `533` | Source-evident | Use a 44px minimum; make Logout a full-width row. | S |
| A-14 | Present | — | Sidebar contrast | Sidebar text is too small and too faint: "Navigation" label 10px slate-600, inactive child icons slate-700, AgencyCard text 11px. | Aesthetic | Low | `TracePointShell.tsx:435`, `545`, `605-623` | Source-evident | Use a 14px base and slate-500 or lighter. | S |
| A-15 | Present | — | Nav taxonomy | "Off-Duty Firearms" is still a group with one child. "Super Admin" still sits mid-list. | Usability | Low | `TracePointShell.tsx:222-240` | Source-evident | Flatten the single-child group; move Super Admin to a footer. | S |
| A-16 | Partly fixed | — | Nav active state | `/notifications` now highlights through its own nav entry. However, `/settings/*` sub-pages, `/training` and `/platform` still highlight nothing (`/settings` is exact-match). The `activePage` prop is still ignored (`activePage: _activePage`), and `/notifications` still passes `activePage="My Home"`. | Usability | Low | `TracePointShell.tsx:328-362`, `379`; `notifications/page.tsx:111` | Source-evident | Use a route → nav map and delete the prop. | S |
| A-17 | Present (worse) | — | Nav icons | The "Assets & Fleet" group **and all three children** (Equipment, the new Inventory, Fleet Management) use `Boxes`. `ShieldCheck` is still used ×6. Import / Export still uses `BarChart3`. | Aesthetic | Low | `TracePointShell.tsx:193-210`, `113-187`, `259` | Source-evident | Use distinct icons (Package, Car, Warehouse, Upload…). | S |
| A-18 | Present | = ADM-34 | Nav, officer role | The Armory group still requires `manage_firearms`, `manage_inspections` or `view_command_dashboard`, so officers who submit personal rifles have no nav path. The RC adds 8 `firearm_custody.*` permissions, none of which opens the group. **UX angle beyond OA:** officer-facing entries should be grouped by task ("My Requests") rather than by armory module. | Usability (role/access confusion) | High | `TracePointShell.tsx:92-102`; `lib/tracepoint/permissions.ts` (no `/firearms` rule) | Suspected | Expose a "My Personal Rifles" entry outside Armory (confirm under #10). | S |
| A-19 | Partly fixed | ~ ADM-06, ~ ADM-34 | Orphan routes | **Fixed:** `/notifications` is now in the nav. **Still orphaned:** `/training` (only the Certifications back-link), `/settings/command-dashboard-analytics` (no inbound link; ADM-30 remainder), `/personal-rifle-review/[id]` (only linked from a `.backup-*` API file), and the `/inspections` and `/import` stubs. | Usability | Medium | `TracePointShell.tsx:71`; `api/armory/personal-rifles/inbox/route.ts.backup-20260714-213043:141` | Source-evident | Link Customize Views from Settings and retire the stubs. | S |
| A-20 | Present | ~ TRN-31 | `/training`, `/training/certifications` | Certifications is filed under Readiness in the nav, but its back-link says "Training" and goes to a `/training` hub that isn't in the nav. The hub's "Coming next" card is still shown. | Usability | Medium | `training/page.tsx:12-36`, `97-101` (unchanged); `training/certifications/page.tsx:540-547` | Source-evident | Remove the hub or align it with the nav. | S |
| A-21 | Present | — | `/training`, `/training/certifications` | Double padding (`px-6 py-8` inside the shell's `px-3 py-4`) gives ~36px gutters on phones. | Aesthetic | Low | `training/page.tsx:70`; `training/certifications/page.tsx:540`; `TracePointShell.tsx:1002` | Source-evident | Let the shell own page padding. | S |
| A-22 | Partly fixed | ~ ADM-06 | `/` Priority Action Queue | Still `filteredItems.slice(0, 8)`, with no "+N more" and **no link to `/notifications`**; Home has 0 links to it. Officers can now reach the full inbox through the "My Notifications" nav entry, but nothing on Home says items are hidden. | Functional defect | Medium (was High) | `page.tsx:410`; Home hrefs at `194`, `445`, `488-585`, `642` | Source-evident | Add "View all N in My Notifications". | S |
| A-23 | Present | — | `/` snapshot cards | Regex categories still double-count, so expired certifications are counted as "Approvals". The Due / Expiring regex now also matches `reorder` (inventory). | Functional defect | Medium | `page.tsx:338-362` | Source-evident | Use an explicit `kind` → category map. | S |
| A-24 | Present | ~ TRN-34 | `/` item actions | Acknowledge and Snooze call `loadNotifications()`, which sets `loading=true` and replaces the list with a spinner. There is no success message or undo, and Snooze is fixed at "1 Day". **UX angle beyond OA:** the OA covers snooze validation; the list unmount, scroll jump and lack of undo are ours. | Usability | Medium | `page.tsx:242-243`, `268-298`, `594-597`, `668` | Source-evident | Update optimistically, show a toast with Undo, and offer snooze presets. | S |
| A-25 | Partly fixed | — | `/` header | **Fixed:** the profile and role now come from the shared access hook, so there is one source of truth. **Remaining:** while loading it still shows "Officer Home", "Authenticated department member" and role "Member", and the page has three names (eyebrow "My TracePoint", nav "My Home", fallback "Officer Home"). | Aesthetic | Low | `page.tsx:228-235`, `428-435` | Source-evident | Show a skeleton and use one name. | S |
| A-26 | Present | — | `/` phone ergonomics | 9–10px labels and chips. Open / Acknowledge / Snooze buttons are `py-1.5 text-[11px]` (~28px). The priority chip is grey, like the source chip. | Usability | High | `page.tsx:199-212`, `626-668` | Source-evident | Use a 12–14px minimum, 44px buttons and coloured priority chips. | S |
| A-27 | Present (worse) | — | `/` terminology | Snapshot CTAs say "Filter Inbox", the section says "Priority Action Queue", and the toggle says "My Actions / Department Actions". The nav now adds "My Notifications" for the inbox page (see A-69). | Usability | Low | `page.tsx:212`, `532`, `558`, `576` | Source-evident | Use one noun. | S |
| A-28 | Present | = TRN-22 | `/notifications` filters/prefs | The Source filter and per-source mutes still list only 4 sources. The shared preferences panel is passed the same 4 (`sources={sources}`). **UX angle beyond OA:** none. | Functional defect | Medium | `notifications/page.tsx:35`, `131`, `145` | Source-evident | Build the list from the payload. | S |
| A-29 | Present | ~ TRN-13 | `/notifications` vs `/` | Home hides Acknowledge for condition-based readiness kinds (the OA says even that list is incomplete). `/notifications` shows Acknowledge for every Open item. **UX angle beyond OA:** the same item behaves differently on two screens. | Functional defect | Medium | `page.tsx:153-164`, `651-661` vs `notifications/page.tsx:152` | Source-evident | Use one shared item component and rule set. | S |
| A-30 | Partly fixed | ~ TRN-35, ~ ADM-06 | `/notifications` states | **Fixed by the shared panel:** digest schedule, "Critical only" disabled while email is off, "preferences saved" message, and the inert in-app switch removed. **Remaining:** action buttons have `disabled` with no disabled style; one `saving` flag freezes every row; count tiles ignore the Source filter; the empty state is green "success" even on the Acknowledged and Snoozed tabs. | Usability | Medium (was Medium) | `notifications/page.tsx:60`, `89-108`, `134-141`, `148`, `152` | Source-evident | Use per-row pending state, a neutral empty state and filtered counts. | S |
| A-31 | Present | ~ ADM-11, ~ FLT-11 | Inbox "Open" deep links | Most hrefs are still module indexes: `/firearms/ammunition`, `/range-days`, `/training/certifications`, `/qualifications`, `/equipment`, `/agency-training`. Fleet links are record-level (with `?tab=`). | Usability | High | `api/notifications/route.ts:263`, `277`, `349`, `363`, `483-513`, `620`, `709`; `lib/tracepoint/agency-training-notifications.ts:89`, `95` | Source-evident | Add record query params. | M |
| A-32 | Present | — | Page titles | Page titles still differ from nav labels: nav "Command Dashboard" vs h1 "TracePoint Command Pulse"; Analytics; Range Days → "Range & Training"; "Admin Settings"; "Import Wizard"; "Training Alerts Inbox"; and now "My Notifications" → "Operational Inbox". | Usability | Low | `command-dashboard/page.tsx:1587`; `analytics/page.tsx:337`; `range-days/page.tsx:3952-3953`; `settings/page.tsx:2362`; `settings/import-export/page.tsx:6462`; `training-alerts/TrainingAlertsClient.tsx:499`; `notifications/page.tsx:117` | Source-evident | Make h1 equal the nav label. | S |
| A-33 | Present | ~ ADM-11 | `/command-dashboard` cards | `PulseCard` is still a non-interactive `<div>`. **UX angle beyond OA:** the OA covers drill-down depth; the inconsistency next to the clickable ops cards is ours. | Usability | Medium | `command-dashboard/page.tsx:490-525` | Source-evident | Make each KPI a link. | S |
| A-34 | Partly fixed | = ADM-10 | `/command-dashboard` loading/error | **Fixed (ADM-10):** a failed source now shows a red "Data unavailable" card and a banner naming the source, instead of "all clear". **Remaining (UX):** while *loading*, the detail lines still render zeros ("0 missing day/no record · 0 missing night…"), and a total `loadError` still leaves the cards on defaults. | Functional defect | Medium | `command-dashboard/page.tsx:1225` (detail not gated), `1338-1366`, `1754-1766` | Source-evident | Gate detail on `loading`. | S |
| A-35 | Present | ~ ADM-10 | Command ops cards | `CommandOperationsPanel` was outside the ADM-10 change. On error, `data` stays null and the cards spin "Loading Agency Training" / "Loading Fleet Readiness" **forever** under a banner with the raw error. | Functional defect | Medium | `CommandOperationsPanel.tsx:104`, `189-193`, `229-233`, `297-300` | Source-evident | Branch on `error` per card. | S |
| A-36 | Present | — | `/command-dashboard` freshness | There is no Refresh control and no "as of" time. The new failure copy tells users to "Refresh the page to try again" (`:1345`, `:1764`), which on a phone means a browser reload. | Usability | Medium | `command-dashboard/page.tsx:1345`, `1760-1766` | Source-evident | Add Refresh and "Updated hh:mm". | S |
| A-37 | Partly fixed | ~ ADM-32 | Customize mode | **Fixed:** errors now show fixed API copy ("The view configuration could not be saved.") instead of raw Supabase text. **Remaining:** Cancel discards dirty edits without asking, there is no `beforeunload` guard (0 in the app), and Save closes the editor with no confirmation. | Usability | Medium | `VisualCustomization.tsx:71-76`, `83-110`; `api/settings/visual-configuration/route.ts:57-68` | Source-evident | Add a dirty-cancel confirmation, an unsaved-changes guard and a "Saved" toast. | S |
| A-38 | Present | — | Customize › Advanced | The number input still clamps on every keystroke (`Number("")` snaps to the minimum), so a value cannot be cleared and retyped. | Functional defect | Medium | `VisualCustomization.tsx:356-361` | Source-evident | Keep a string draft and clamp on blur. | S |
| A-39 | Present | — | Customize controls | Advanced Settings is still hidden inside "Add Card / Section". Size buttons are 9px and ~20px tall. The ops-card grid is `grid-cols-4` with 9px labels on phones. | Usability | Low | `VisualCustomization.tsx:219`, `281`, `338`; `CommandOperationsPanel.tsx:176-185`, `217-226`, `280` | Source-evident | Give Advanced Settings its own toggle; use ≥32px controls; use `grid-cols-2 sm:grid-cols-4`. | S |
| A-40 | Present | — | Qualification Snapshot | "Missing Day" is blue while "Missing Night" is amber. | Aesthetic | Low | `command-dashboard/page.tsx:1443-1444` | Source-evident | Use one severity → tone map. | S |
| A-41 | **Obsolete** (aws-native) | ~ ADM-07 | `/activate`, `/auth/setup` | The password-trim mismatch applied only to the Supabase forms. Under Cognito both pages redirect to `/login`, and the hosted UI sets the password. The `textValue().trim()` code survives only on the bridge path (`activate/page.tsx:19-22`). The policy now rejects leading/trailing spaces outright (`lib/authentication/password-policy.ts:11`). | — | — | `activate/page.tsx:34`, `89`; `auth/setup/page.tsx:40`, `130`, `572` | Source-evident | None for staging/production. Delete the bridge forms when Supabase is retired. | — |
| A-42 | **Fixed in RC** | = ADM-07 | `/login` forgot password | The Cognito hosted UI provides "Forgot your password?" (verified live), and the Help reset article now matches it. **Residual (OA-owned, ADM-07c):** invited users with an unverified email cannot receive a reset code, and Help tells them to ask an admin. **UX angle:** the reset entry point now sits on the second screen; see A-66. | — | — | `help-content.ts:82-100`; `LoginForm.tsx:92-102` | Source-evident (code); verified live (hosted UI) | Follow the ADM-07 owner decision. | — |
| A-43 | Partly fixed | ~ ADM-32 | `/login` messages | **Fixed:** in `aws-native` there are no password inputs, so raw Supabase "Invalid login credentials", low-contrast placeholders and the missing reveal toggle no longer apply. **Remaining:** `?error=` is still rendered verbatim in a rose error box (`login/page.tsx:110-114`), and the RC now feeds it internal wording (see A-67). | Usability | Medium | `login/page.tsx:110-114`; `auth/callback/route.ts:9-13`; `auth/confirm/route.ts:25-27` | Source-evident | Use message codes mapped to copy and tone. | S |
| A-44 | **Obsolete** (aws-native) | — | `/activate`, `/auth/setup` forms | The pending-state and field-clearing problems apply only to the bridge forms, which now redirect. | — | — | as A-41 | Source-evident | — | — |
| A-45 | **Obsolete** (aws-native) | — | `/auth/setup` copy | The "RLS enforcement" / "Department tenant" copy is unreachable under Cognito. "Agency tenants" jargon remains on `/platform` (`platform/page.tsx:28`), which only platform admins see. | — | — | `auth/setup/page.tsx:405`, `415`, `572` | Source-evident | Change the `/platform` subtitle copy. | S |
| A-46 | Present | ~ ADM-23, ~ ADM-29 | `/unauthorized`, feature gates | Unchanged page: two links to `/`, no "whom to ask". Feature-off layouts still `redirect("/")` silently; B11 deferred `/unauthorized?reason=feature` as a "UX change". **UX angle beyond OA:** OA ADM-23 fixed consistency, but the silent bounce to Home is still ours. | Usability | Medium | `unauthorized/page.tsx:54-80`; `command-dashboard/layout.tsx:25-27` | Source-evident | Redirect to `/unauthorized?reason=feature` and add "Ask your administrator". | S |
| A-47 | Present | ~ ADM-13 | Idle session guard | Sign-out is now a POST through the Cognito hosted logout (good), but the rest is unchanged:<br>• no countdown;<br>• any mousedown or scroll dismisses the warning;<br>• timers are per tab, so an idle second tab ends the whole session (cookies cleared, Cognito logout) for the active tab;<br>• no draft preservation.<br>After re-sign-in the user lands on Home, not their page (A-64). OA ADM-13 covers the hard-coded 25/30 minutes vs the ignored policy setting. | Usability | High | `IdleSessionGuard.tsx:7-15`, `32-67`, `71-113`; `idle-session-core.ts:7-14`; `cognito-transport.ts:144-151` | Suspected (multi-tab), Source-evident (no countdown) | Share last activity across tabs, show a countdown, and preserve `next`. | M |
| A-48 | Present | ~ ADM-21 | Support mode banner | Unchanged: a `sticky top-0 z-[100]` banner over the `sticky top-0 z-40` mobile header, a third `/api/access` fetch, and "Support Mode - X" / "Exit Agency" wording. | Usability | Medium | `components/SupportModeBanner.tsx:20`, `65-76`; `TracePointShell.tsx:989` | Suspected | Render the banner inside the shell. | S |
| A-49 | Present (impact raised) | ~ ADM-31 | `/landing` (in-app) | Unchanged page. In the RC the proxy sends **unauthenticated `/` → `/landing`** (`request-proxy-core.ts:6`), so this page is the front door for any officer whose session expired. On a phone the header "Sign in" is `hidden sm:block`; the only sign-in is "Agency Sign In" at the very bottom. "Request a Demo" (`:233`) still links to `/login`. | Functional defect | High (was Medium) | `landing/page.tsx:156-157`, `233`; `lib/authentication/request-proxy-core.ts:5-6` | Source-evident | Show Sign in on mobile, point "Request a Demo" at a mailto, or send an expired session at `/` to `/login`. | S |
| A-50 | Present | ~ ADM-31 | Marketing repo | Unchanged: Sign-in links go to `tracepoint-amber.vercel.app/login?next=%2F`, Inter isn't loaded, and colours, logo and tagline drift from the app. OA ADM-31 notes the Vercel link. **UX angle beyond OA:** the brand-token drift. | Aesthetic | Medium | `tracepoint-landing/src/app/page.tsx:156`, `233`; `globals.css`; `layout.tsx` | Source-evident | Use the production domain and shared brand tokens. | S |
| A-51 | Partly fixed | = ADM-08 | `/help` accuracy | **Fixed:** the Agency Training and Fleet articles are Live, reset, activation and notification steps match Cognito, and the "brevo" keyword is gone. **Remaining:** "Officer Home" (`help-content.ts:52`, `120`, `717`), "My Pending / Department Pending" vs the UI's "My Actions" (`:128`), "return Home and select the correct agency context" (`:113`, no such control, A-09), and the route label "Open Operational Inbox" (`:152`) vs nav "My Notifications". | Usability | Low (was Medium) | as cited | Source-evident | Finish the label pass; extend `help-content.test.ts` to check UI labels. | S |
| A-52 | Present | — | `/help` navigation | Unchanged: the article is held in state, not the URL, so Back leaves Help. The role filter defaults to "All roles" and offers "Platform Admin" to everyone. | Usability | Low | `help/page.tsx:25-31`, `67-70`, `86-95` | Source-evident | Use `?article=`; default the role from access. | S |
| A-53 | Present | — | All modals | 26 overlays in 19 files, 9 `role=dialog`/`aria-modal`, Escape in 5 files (was 2), 0 portals, 0 scroll locks. | Usability | Medium | Inventory table above | Source-evident | Build one Dialog/Sheet primitive. | M |
| A-54 | Present (worse) | ~ FLT-21, ~ RNG-04 | Native dialogs | `window.confirm` 14 → **17**, `alert` 4 → **5**, `prompt` 6 → **7**. New in the RC:<br>• two range-day finalization confirms (RNG-04's fix is a native confirm);<br>• a fleet vehicle confirm;<br>• an `alert` in the training closeout panel;<br>• one more fleet `prompt`.<br>Audit reasons are still captured by `window.prompt`. **UX angle beyond OA:** the OA wants confirmations; we want them non-native and on a shared component. | Usability | Medium | `grep -rnE "window\.(confirm\|alert\|prompt)\(" src/app --include=*.tsx --exclude-dir=api` | Source-evident | Use a shared ConfirmDialog and ReasonDialog. | M |
| A-55 | Present | — | Feedback | Still 0 toast system, 22 files (was 20) with local message state, and 2 hand-rolled fixed toasts. | Usability | Medium | Inventory table | Source-evident | Add `useToast`. | M |
| A-56 | Present | — | Status colours | Still 12 local status/tone maps and 10 Pill/Badge components (lines moved, e.g. `command-dashboard/page.tsx:468`/`478`, `platform/page.tsx:173`). | Aesthetic | Medium | Inventory table | Source-evident | One StatusBadge and a tone registry. | M |
| A-57 | Present | — | Typography | `text-[Npx]` 1,013 → **1,036**, of which ≤10px 441 → 445; 40 h1 with 28 distinct class strings. | Aesthetic | Medium | Inventory table | Source-evident | Define a type scale and a PageHeader. | M |
| A-58 | Present (worse) | — | Buttons | Buttons 437 → 487; distinct class strings 321 → **359**; `bg-blue-600` variants 84 → **90**; ~24–30px buttons 46 → 47. | Usability | Medium | `evidence/scripts/btn.py` | Source-evident | Build a Button component. | M |
| A-59 | Present | — | Colour/theming | Unchanged: 25 hex literals, 47 `rgb()`, 0 `dark:`, 20 `bg-white`. | Aesthetic | Medium | Inventory table | Source-evident | Add `@theme` tokens. | L |
| A-60 | Present | ~ TRN-36, ~ FLT-16 | Tables | Unchanged: 17 tables in 13 files, 13 forced `min-w-[…px]`. | Usability | High | e.g. `fleet-management/page.tsx`, `equipment/page.tsx`, `training/certifications/page.tsx` | Source-evident | Build a shared DataTable with a card mode. | L |
| A-61 | Present | — | Page headers | Still at least 8 patterns. `ArmoryPageHeader.tsx` is still unused. | Aesthetic | Medium | `grep -rl ArmoryPageHeader src/app` returns only itself | Source-evident | One PageHeader. | M |
| A-62 | Partly fixed | = ADM-30 | Source hygiene | 48 → **33** backup files. All 33 left are armory/firearm (8 under `api/armory`, plus 2 `ArmoryWorkspaceNav.tsx.backup-*`). The `.bak` and 12 `.before-*` files are gone, and `.gitignore` is updated. `ArmoryWorkspaceNav.tsx` is still imported only by backups. | Aesthetic (maintainability) | Low | `find src -name "*.backup-*"` | Source-evident | Delete them after B8, as ADM-30 plans. | S |
| A-63 | Present | — | Terminology | Unchanged spread (RC counts): Agency 90 / Department 65; Officer 91 / Personnel 30; Inbox 28 / Notifications 6; Archive 28 / Remove 23; Logout vs Sign out. The RC adds "My Notifications" (A-69). | Usability | Medium | Counts via `grep -rhoE` | Source-evident | Publish a glossary. | M |
| **A-64** | **New** | — | Sign-in (Cognito) | **Sign-in always lands on Home and loses the destination.**<br>• The proxy sends a signed-out user to `/login?next=/range-days?...`.<br>• The login page posts `next` as a hidden field to `/api/auth/cognito/login`.<br>• `begin()` never reads the request body.<br>• The callback always redirects to `origin + '/'`.<br>Every deep link lands on My Home: notification emails, shared record links, Help "Open…" buttons, a fleet QR resolved in the browser, and a return after idle sign-out. On a phone the user has to navigate again (or never finds the record). | Functional defect | **High** | `login/LoginForm.tsx:94-96`; `lib/authentication/cognito-transport.ts:99-106` (no body read), `136` (`location:origin+'/'`); `lib/authentication/request-proxy-core.ts:8` | Source-evident | Persist a validated `next` with the PKCE flow record (server side, internal paths only) and redirect to it in `callback`. | S |
| **A-65** | **New** | — | Sign-in / sign-out failures | **Cognito endpoint failures render as raw JSON documents.** These are full-page form posts and redirects, so the browser displays the body:<br>• callback errors give 401 `{"code":"authorization_rejected"}`, for example after the 600-second flow cookie expires on the hosted UI, a Back or double tab, the user cancelling, or an `error` parameter;<br>• `begin` failure gives 503 `{"code":"authorization_unavailable"}`;<br>• logout failure gives 503 `{"code":"logout_unconfirmed"}`;<br>• provider off gives 503 `{"code":"provider_disabled"}`.<br>There is no link back to sign in and no explanation. | Functional defect | **High** | `cognito-transport.ts:49-53` (JSON `response()`), `106`, `137`, `151`; `lib/authentication/cognito-pkce.ts:10` (`COGNITO_FLOW_LIFETIME_SECONDS=600`); `cognito-runtime-transport.ts:81-85` | Source-evident (rendering), Suspected (frequency) | For browser navigations, redirect failures to `/login?notice=<code>` with friendly copy ("Your sign-in timed out. Try again."), keeping JSON for API and native callers. | S |
| **A-66** | **New** | ~ ADM-07 | `/login` → hosted UI | **Two-screen sign-in with a brand break and vendor jargon.**<br>• Screen 1 is a TracePoint card with one button, "Continue with secure sign-in", and the footnote "Authentication and MFA are completed by TracePoint's AWS Cognito identity service."<br>• Screen 2 is the default unbranded Cognito hosted UI (grey header bar, "name@host.com" placeholder; verified live).<br>Every sign-in costs one extra tap. The brand change looks like a phishing hop. "Forgot your password?" is only on screen 2, while Help (correctly) describes both steps. The OA notes the pool uses the classic hosted UI. | Usability | Medium | `login/LoginForm.tsx:92-102`; `evidence/mobile_login.png`, `mobile_cognito.png` | Source-evident (screen 1), verified live (screen 2) | Brand the managed login (logo, colours, TracePoint copy), drop "AWS Cognito" from the UI, and consider auto-continuing to the hosted UI when there is no error to show. | M |
| **A-67** | **New** | ~ ADM-07, ~ NEW-ADM-A | Legacy auth links under Cognito | Old activation and reset links (Supabase emails still in inboxes) now hit dead ends in `aws-native`:<br>• `/activate` and `/auth/setup` silently redirect to `/login` with no explanation;<br>• `/auth/callback` shows "This legacy authentication callback is disabled." in the rose **error** box;<br>• `/auth/confirm` shows "Complete account recovery through secure sign-in." as an **error**.<br>None of them tells a first-time user to use the temporary password in their newer invitation email. | Usability | Medium | `activate/page.tsx:34`, `89`; `auth/setup/page.tsx:572`; `auth/callback/route.ts:9-13`; `auth/confirm/route.ts:25-27`; `login/page.tsx:110-114` | Source-evident | Show one neutral notice for legacy links: "This link is no longer used. Sign in with the email and temporary password from your newest TracePoint invitation, or use Forgot your password?". | S |
| **A-68** | **New (consolidation seed)** | — | `components/SearchablePicker.tsx` | This is a good new primitive: a combobox with keyboard support, Escape, loading, error and empty states, and an inline "create" option. It is the first shared picker, but has **1 consumer** (`inventory/page.tsx:855`) against **136 native `<select>` in 32 files** (officer, firearm, vehicle and location pickers). Gaps to fix before reusing it widely:<br>• the list never closes on blur (no `onBlur`; it stays open after tabbing away);<br>• options have no `id` and the input no `aria-activedescendant`, so the arrow-key highlight is not announced;<br>• the clear control is an unstyled "×" glyph (~16px target);<br>• the label is `aria-label` only (callers must render a visible label);<br>• typing over a selection silently clears the value. | Usability | Low | `SearchablePicker.tsx:55-94` (no blur), `95-104`, `119-127`; `grep -rhoE "<select" src/app --include=*.tsx \| wc -l` gives 136 | Source-evident | Harden it (blur close, activedescendant, 40px clear button), then adopt it for officer, firearm and vehicle pickers. | S |
| **A-69** | **New** | ~ ADM-06 | `/notifications` naming | One page now has five names:<br>• nav "My Notifications";<br>• h1 "Operational Inbox";<br>• eyebrow "TracePoint / Notifications";<br>• Help "Open Operational Inbox" and "Open My Notifications";<br>• shell `activePage="My Home"`.<br>Its subtitle claims sources "Ammunition, Personal Rifles, Inspections, and Range Operations", but the inbox also carries certification, equipment, fleet and agency-training items. | Usability | Low | `TracePointShell.tsx:71`; `notifications/page.tsx:111`, `116-118`; `help-content.ts:152`, `171` | Source-evident | Pick one name and make the subtitle generic. | S |
| **A-70** | **New** | ~ ADM-22 | Platform console access errors | `platform/layout.tsx` redirects a platform admin to the **marketing `/landing`** page on any non-401/403 failure (`status 500`, e.g. a transient database error). The agency detail page calls `notFound()` on any access failure. Both read as "the console is gone", with no error or retry. | Usability | Low | `platform/layout.tsx:9-14`; `lib/platform/admin-access.ts:196-198`; `platform/[departmentId]/page.tsx` (`if (!access.ok) notFound()`) | Source-evident | Render an error state with Retry. | S |
| **A-71** | **New** | ~ ADM-21, ~ ADM-22 | `/platform/[id]` Send Activation | In `aws-native`, unless the admin is already in Support Mode for that agency, the Send Activation button is replaced with the text "Use Access Agency to enter Support Mode for this agency, then send the activation." The admin has to leave, enter Support Mode, and redo the action elsewhere. This is a B1 owner decision. | Usability | Low | `platform/[departmentId]/ActivationButton.tsx` (`requiresSupportMode` branch); `platform/[departmentId]/page.tsx` (cookie check) | Source-evident | Offer "Enter Support Mode and send" as one action, or link straight to Access Agency. | S |

There are 71 findings in total: 63 original and 8 new.

---

## Nav taxonomy & terminology (RC deltas only; the first-pass tables still hold otherwise)

### Changes to the sidebar

- **"My Notifications" (`/notifications`)** is a new top-level entry after My Home, with no gate. This fixes the ADM-06 reachability problem and A-19 for this route.
- **"Inventory" (`/inventory`)** is new under Assets & Fleet, gated by `view_inventory`, `manage_inventory` or `adjust_inventory`. It has **no feature code** (B11 deferred catalog codes for Fleet, Agency Training and Inventory) and the same `Boxes` icon as its group and siblings.
- **Analytics** now requires `analytics` **and** `range_training`, matching its layout.
- **Super admins no longer see modules** the agency has turned off.

### Routes not in the nav (RC)

| Route | Status |
|---|---|
| `/notifications` | Now in the nav. |
| `/training` hub | Still reached only from the Certifications back-link. |
| `/settings/command-dashboard-analytics` | Still has no inbound link. |
| `/personal-rifle-review/[id]` | Still linked only from a backup file. |
| `/inspections`, `/import` stubs | Unchanged. |
| `/landing` | Now the unauthenticated `/` destination. |
| `/activate`, `/auth/setup` | Now dead routes in `aws-native`. |

### Inbox naming (RC)

The RC adds "My Notifications" to the existing list:
- Home "Priority Action Queue", "My Actions" and "Filter Inbox";
- `/notifications` "Operational Inbox";
- `/training-alerts` "Training Alerts Inbox";
- landing "Officer Inbox";
- Help "Officer Home" and "My Pending".

---

## Consolidation / reuse opportunities (updated to RC)

1. **App shell in a route-group layout** plus an access context. Still the highest-leverage change (A-01, A-02, A-48), and it covers 30 pages.
2. **Design tokens** via Tailwind v4 `@theme`. Delete `AppearanceStyleOverrides` (A-03 to A-05) and the starter tokens (A-07). Now that accent and theme come from `/api/access`, they can be set as CSS variables on the shell root.
3. **Primitives:**
   1. `Dialog`/`Sheet`, replacing 26 overlays and the drawer.
   2. `ConfirmDialog` and `ReasonDialog`, replacing **17** `confirm`, **7** `prompt` and **5** `alert`. The RC's new RNG-04 finalize confirmations should be the first adopters.
   3. `Toast`, replacing 22 local message states.
   4. `Button`, replacing 359 class strings.
   5. `StatusBadge` plus a tone registry, replacing 12 maps and 10 pills.
   6. `PageHeader`, replacing 8 patterns.
   7. `EmptyState`.
   8. `DataTable` with a mobile card mode.
   9. `KpiCard` with link, loading and error states. The RC's "Data unavailable" PulseCard variant is a start; fold `SnapshotCard` and the ops cards in.
   10. **`SearchablePicker`** is new in the RC and the first shared form primitive. Harden it (A-68) and use it as the single picker for officer, firearm, vehicle and location selection (136 `<select>` today).
4. **One inbox item component.** Home and `/notifications` still duplicate the item card, the acknowledge rules (A-29) and the source list (A-28). The preferences half is already shared (`NotificationPreferencesPanel`), so finish the job.
5. **One page-title source:** a route → nav metadata map for the sidebar highlight, mobile title, h1 and Help labels (A-11, A-16, A-32, A-69).
6. **Help ↔ UI label tests.** `help-content.test.ts` now exists (ADM-06 and ADM-08 assertions). Extend it to assert nav labels and Home labels (A-51).
7. **One auth notice channel.** Replace `?error=` free text with `?notice=<code>` for the login page, legacy routes and Cognito failures (A-43, A-65, A-67).
8. Delete the remaining 33 armory backups, `ArmoryWorkspaceNav.tsx` and `ArmoryPageHeader.tsx` after B8 (A-62).

## Workflow simplification opportunities (RC)

| Task | Steps in the RC | Simplification |
|---|---|---|
| Open a deep link while signed out (email, Help, shared link) | Link → `/login` → Continue → hosted UI sign-in → MFA → **My Home** → navigate to the record again | Preserve `next` (A-64). That saves 2–4 navigations every time. |
| Sign in at all | TracePoint card → Continue → hosted UI → MFA | Auto-continue, or a branded hosted UI (A-66). That saves one tap and the brand break. |
| Officer clears an inbox item | Home → Open → module *index* → find the record → act → back to Home → spinner reload | Record deep links (A-31) and optimistic updates (A-24). |
| See more than 8 action items | Open the drawer → "My Notifications" (now possible) | Add an inline "View all N" link on Home (A-22). |
| Multi-agency user changes agency | Sign out (now Cognito logout) → sign in → pick from the interstitial | AgencyCard switcher (A-09). |
| Command staff drill-down from a KPI | Scroll to Module Snapshot | KPI cards as links (A-33). |
| Recover from a failed sign-in callback | Raw JSON page → edit the URL manually → `/login` | Friendly redirect with retry (A-65). |
| Platform admin sends a first activation | Agency detail → read the instruction → Access Agency → Settings → Users & Roles → Send Activation | One combined action (A-71). |
| Officer whose session expired opens the app root on a phone | `/` → marketing page → scroll to the bottom → "Agency Sign In" | Show Sign in on mobile, or route an expired `/` to `/login` (A-49). |

## Quick wins (low risk, high benefit; RC)

1. **A-64:** carry `next` through the PKCE flow record and redirect to it in the callback (internal paths only, using the existing `internalAuthRedirect`).
2. **A-65:** for browser (non-API) requests, map Cognito failure codes to a `/login?notice=` redirect with friendly copy and a "Try again" button.
3. **A-49:** remove `hidden` from the landing "Sign in" link on mobile, and point "Request a Demo" at the mailto the marketing site uses.
4. **A-67 and A-43:** use a neutral notice (not the rose error box) for legacy activation and reset links, with "use your newest invitation email" copy. Remove "AWS Cognito" from the login footnote (A-66).
5. **A-22:** add "View all N in My Notifications" under the 8-item queue.
6. **A-35 and A-34:** branch on `error` in `CommandOperationsPanel`, gate PulseCard detail on `loading`, and add a Refresh button (A-36).
7. **A-08:** replace `" ? "` with `" · "` (shell) and fix "Open Import Wizard ?".
8. **A-23:** use an explicit kind → category map, so certifications stop counting as approvals.
9. **A-26 and A-13:** use `min-h-11` on the Home action buttons and shell controls; nothing below 12px on Home.
10. **A-68:** add blur-close and `aria-activedescendant` to SearchablePicker before more modules adopt it.
11. **A-51 and A-69:** run the remaining Help label pass (Officer Home, My Pending, the agency switch sentence) and use one name for `/notifications`.
12. **A-07:** delete the starter `:root` and `prefers-color-scheme` block in `globals.css`.
