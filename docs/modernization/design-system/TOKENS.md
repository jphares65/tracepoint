# Design tokens

Defined once in [`src/app/globals.css`](../../../src/app/globals.css). Owned by the design-system
workstream (Claude). Module code uses the Tailwind utilities below and does not define colors, sizes or
radii of its own. A module that needs a token that doesn't exist asks for it (see
[CODEX-HANDOFF.md](CODEX-HANDOFF.md#requesting-a-change)).

Runtime values are `--tp-*` custom properties. The agency appearance preferences (accent: blue, indigo,
emerald, slate; brightness: dark, balanced, high contrast) swap those values through the
`tracepoint-accent-*` and `tracepoint-brightness-*` classes that `TracePointShell` already sets, so
token-based screens follow the preference without the `!important` attribute-selector overrides that
legacy screens rely on.

## Color roles

| Utility suffix | Use | Default |
|---|---|---|
| `canvas` | Page background | `#020617` |
| `surface` | Cards, tables, sheets | `#0b1222` |
| `surface-raised` | Table headers, hovered rows, secondary buttons | `#111a2e` |
| `surface-sunken` | Inputs, segmented-control tracks | `#050b19` |
| `line`, `line-strong` | Borders and dividers; strong for inputs and secondary buttons | `#1e293b`, `#334155` |
| `fg` | Primary text and data | `#f1f5f9` |
| `fg-secondary` | Body text, cell values | `#cbd5e1` |
| `fg-muted` | Labels, help, captions. The lowest-contrast text allowed. | `#94a3b8` |
| `accent`, `accent-hover`, `accent-fg` | Primary buttons, selection, focus | agency accent |
| `accent-text`, `accent-soft` | Links and selected-row tint | agency accent |
| `focus` | Focus ring (applied globally on `:focus-visible`) | agency accent |

Examples: `bg-surface`, `border-line`, `text-fg-muted`, `bg-accent text-accent-fg`.

Data is brighter than its label: values use `text-fg` or `text-fg-secondary`, labels `text-fg-muted`.

## Status roles

Five roles. Color appears only on status, never on a zero or for decoration (blueprint §1).

| Role | Means | Utilities |
|---|---|---|
| `success` | Ready, passed, in service, saved | `text-success`, `bg-success-soft`, `border-success-line`, `bg-success` |
| `warning` | Needs attention soon; not recorded; restricted; not synced | `…-warning…` |
| `danger` | Blocking: out of service, failed, expired, conflict | `…-danger…` |
| `info` | In progress, scheduled, in storage, checked out | `…-info…` |
| `neutral` | No judgement: unassigned, draft, not set up | `…-neutral…` |

Prefer the components (`StatusChip`, `KpiTile`, `InlineNotice`) to the raw utilities. The mapping from
status words to roles is in [`src/components/ui/status.ts`](../../../src/components/ui/status.ts), so
"Out of service" is red on every screen. Add new status words there, not in a module.

## Type scale (Geist)

| Utility | Size / line height | Use |
|---|---|---|
| `text-caption` | 12 / 16 | Help text, meta, table headers. **The minimum size.** |
| `text-label` | 13 / 18 | Field labels, chips, small buttons |
| `text-body` | 14 / 20 | Default text, cells, buttons |
| `text-emphasis` | 16 / 24 | Empty-state titles, emphasized values |
| `text-section` | 20 / 28 | Section and dialog headings (h2) |
| `text-title` | 24 / 32 | Page title (h1, via `PageHeader`) |
| `text-kpi` | 30 / 36 | KPI values (via `KpiTile`) |

- `font-mono` (Geist Mono) for serials, asset tags, plates, scores and counts. Add `tabular-nums` in columns.
- Sentence-case labels. Uppercase only in table headers (DataTable does this).
- Nothing below 12px. No `text-[9px]`, `text-[10px]`, `text-[11px]` in new or modernized code.

## Spacing and radius

- 4px grid: Tailwind's default spacing scale (`gap-1` = 4px, `p-3` = 12px, `p-4` = 16px).
- `rounded-control` (6px) for buttons, inputs and chips' inner controls; `rounded-card` (10px) for cards,
  tables, notices and dialogs; `rounded-full` for chips and counts.
- Cards only for objects. Sections are plain areas with a heading and a `border-t border-line` divider.
  Never a card inside a card.

## Touch targets

`tp-touch-target` gives a 44×44px minimum on coarse pointers (phones, tablets) without changing desktop
density. Every shared interactive component already applies it. Field workflows (inspection, scoring)
use the larger `field` sizes regardless of pointer.

## Global behavior

- `color-scheme: dark`, dark scrollbars, and a visible focus ring on `:focus-visible` everywhere.
- `<body>` is navy on every system theme (the previous default painted it white on light-mode systems).
- `dialog::backdrop` is dimmed and blurred for every native dialog.
