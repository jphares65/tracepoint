# Handoff to the Codex workstream

How the operational modules (Fleet, Equipment, Inventory, Range Days, Qualifications, Agency Training,
Training Alerts, Certifications, Agency Documents) adopt the shared design system. Read this with
[TOKENS.md](TOKENS.md), [COMPONENTS.md](COMPONENTS.md) and the blueprint
([`../sources/blueprint-v2/index.html`](../sources/blueprint-v2/index.html)).

## Ownership

| Area | Owner | Codex may |
|---|---|---|
| `src/app/globals.css`, design tokens | Claude | Request changes only |
| `src/components/ui/**` (shared kit) | Claude | Use. Request changes or new components. |
| `src/app/components/TracePointShell.tsx`, navigation, breadcrumbs conventions | Claude | Request nav label or route changes |
| `docs/modernization/register/*.json` | Shared | Update status, implementation and evidence for **Codex-owned** requirements only |
| Fleet, Equipment, Inventory, Range, Qualifications, Training, Training Alerts, Certifications, Agency Documents screens | Codex | Modernize |
| APIs, save semantics, validation, permissions, audit writes, migrations | Operational (deployment) workstream | Never change from a UI branch |

Codex does not define its own colors, type sizes, buttons, chips, dialogs, tables or empty states.
If a shared component can't express what a screen needs, that's a design-system request, not a local fork.

## Requesting a change

1. Open an issue or PR comment titled `design-system request: <component>` describing the screen, the
   need and a sketch.
2. Claude adds a `MOD-DS-` requirement to the register and ships the change in the shared kit.
3. Until it lands, use the closest existing component; don't build a temporary one.

Small, clearly-additive fixes (a missing prop, a status word in the vocabulary) can be proposed as a PR
against `src/components/ui/` with Claude as required reviewer. Each such PR touches only shared files,
never a module screen in the same PR.

## Page conventions

- Template: List, Record, Dashboard, Form/Wizard or Settings (blueprint §1). Every page starts with
  `PageHeader`; the title equals the navigation label; the breadcrumb starts with the navigation group
  ("Assets › Fleet", "Range & Quals › Range Days").
- Order: what needs action → summary (one `KpiStrip`, up to four tiles) → detail.
- One primary action per view, in the header or a sticky footer on phones.
- Lists: `SavedViews` (when there are recurring questions) → `FilterBar` → `DataTable`. Row opens the
  record (drawer or full page). View, filter and sort state in the URL query.
- Records: `PageHeader` with `StatusChip` → `Tabs` (URL-backed; keep History) → sections.
- Accountable changes in a `Sheet`; creates in a `Dialog`; destructive only via `ConfirmDialog`
  (blueprint §1b table). No native `prompt`/`confirm`/`alert`.
- Loading, error and empty states through `AsyncState`. Never render 0 or an all-clear before data loads.
- Identifiers (`EntityLabel`, `mono` columns) are serials, plates, unit numbers or asset tags, never ids.

## Navigation conventions

- Routes don't change unless the register says so. Old URLs keep working or redirect.
- Group labels (blueprint): Home · Operations · Command · Armory · Range & Quals · Assets · Admin. The
  shell branch applies them; module screens use the same words in breadcrumbs.
- Tabs and record sections use real URLs (`/fleet-management/[vehicleId]?tab=inspections`).

## Terminology

| Use | Not |
|---|---|
| Command Dashboard | Command Pulse |
| Shared supplies | Pooled stock |
| On hand | Standing total |
| Duty restrictions | Restriction policy (in UI copy) |
| Range packet | Packet bundle |
| Out of service, In service, Available | OOS, red-tag, operational |
| Not recorded | Unknown, null, — (for custody) |
| Verbs on buttons: Inspect vehicle, Report a problem, Close range day, Use template | Submit, OK, Go |

Never in UI copy: "authoritative", "hybrid readiness", "normalized targets", developer notes, raw API
messages, HTTP status codes, UUIDs. State limits plainly ("MFA is not enforced yet").

Statuses use the shared vocabulary in `src/components/ui/status.ts`; add a word there rather than
coloring it locally.

## Safety guardrails (non-negotiable, blueprint §1b)

- Inspection items start unanswered. Safety acknowledgments are answered one by one; no bulk Pass covers
  them. Submit stays disabled and lists what's missing; the result and its status effect show before
  Submit.
- Range scoring autosaves; row status comes only from the server (Saved / Saving / Not synced / Conflict);
  unsynced work survives reload; corrections use "Correct result" with a reason.
- The UI hides or disables what a role can't do; the server stays the authority. No permission logic in
  components.
- Every audited action still writes the same audit entry; required reasons stay required.

## Visual acceptance criteria (each modernized screen)

1. Built only from tokens and shared components; no raw palette colors for meaning, no `text-[<12px]`.
2. PageHeader title equals the nav label; one primary action; no card-in-card; no intro card.
3. Desktop 1280 shows the primary list without sideways scroll; tablet 768 usable without the sidebar;
   phone 375 renders cards, `Filters (n)`, 44px targets, no horizontal page scroll.
4. Loading skeleton, error with Retry, and empty state with next step all present.
5. Status chips use the shared vocabulary; KPI zeros are neutral; every KPI links to its filtered list.
6. Keyboard: all actions reachable; visible focus; dialogs trap and restore focus; Escape closes.
7. axe: no new violations. Contrast ≥ 4.5:1.
8. Feature parity inventory for the screen 100% checked (routes, actions, fields, filters, sorts,
   exports, permission gates, audit writes, empty/error states); network calls identical before/after.
9. Before/after screenshots at 1280, 768 and 375 committed under `docs/modernization/evidence/<module>/`.
10. Role pass: Officer, Instructor, Armorer, Fleet Manager, Supervisor, Admin see what the baseline shows.

## Branches and PRs

- One feature branch per module increment, from the agreed integration baseline (see
  [`../README.md`](../README.md#baseline)). Prefix `codex/modernize-<module>-<yyyymmdd>`.
- Each PR lists the `MOD-` ids it resolves and updates their register entries (status `Implemented`,
  branch/PR, evidence) in the same PR, then runs `node scripts/modernization-register.mjs`.
- Claude cross-reviews visual consistency; Codex reviews Claude's PRs for functional and workflow parity.
- No merges into the active operational release branch and no deployments without the deployment
  workstream.

## Reference implementation

`src/app/design-system/ComponentGallery.tsx` shows each component composed into the patterns above
(the Firearms list with saved views, filter bar, table/cards, custody sheet). Copy its composition, not
its synthetic data.
