# Shared component contracts

All components live in [`src/components/ui/`](../../../src/components/ui/) and are imported from
`@/components/ui`. They are the only implementation of these patterns: modules compose them and do not
copy, fork or restyle them. A live reference of every variant is at `/design-system` (development builds,
or production with `TRACEPOINT_COMPONENT_GALLERY=enabled`). Screenshots at 1280, 768 and 375px are in
[`../evidence/design-system/`](../evidence/design-system/).

Every contract below has three parts: **use it for**, **API**, and **rules** (what reviewers check).
The safety guardrails in blueprint §1b override any convenience a component offers.

Status of each component: **Ready** (built and tested on this branch) or **Planned** (contract fixed,
implementation in a later increment; do not build your own in the meantime).

---

## PageHeader

**Ready.** Use it for the top of every page, list and record.

```tsx
<PageHeader
  title="Firearms"                               // equals the navigation label
  breadcrumbs={[{ label: "Armory", href: "/firearms" }, { label: "Firearms" }]}
  description="Department-owned firearms, who they're assigned to and where they are."
  status={<StatusChip label={record.status} />}  // record pages only
  meta="Updated 10:14 AM"                        // freshness, dashboards
  actions={<Button variant="quiet">Export</Button>}
  primaryAction={<Button variant="primary">Add firearm</Button>}
/>
```

Rules: one `h1` per page, from PageHeader. The title matches the menu label exactly. At most one primary
action. No card around the header and no intro card under it. No eyebrow text in uppercase.

## Button / ButtonLink

**Ready.** `variant`: `primary` (one per view), `secondary`, `quiet`, `destructive`. `size`: `sm` (32px),
`md` (40px, default); both grow to 44px on touch. `busy` + `busyLabel` disable the button and announce
progress. `ButtonLink` is for navigation and takes `href`.

Rules: labels are verbs that name the effect ("Inspect vehicle", "Move to SYN-TEST Vault", "Create range
day"), never "OK", "Submit" alone, or "Yes". Every button that calls the server uses `busy` so it can't be
double-submitted. Labels don't wrap: shorten them.

## StatusChip

**Ready.** `label` (any case; shown in sentence case), optional `role`, optional `reason` (tooltip and
screen-reader text), `size` `sm` | `md`.

Rules: the role comes from the shared vocabulary unless the module has a documented reason to override.
A chip states a status; it is not a button and not decoration. Give a reason whenever the status blocks
something ("Brakes: critical defect").

## KpiTile / KpiStrip

**Ready.** `label`, `value` (mono), `context`, `href`, `role`, `attention`, `loading`, `error`, `onRetry`.
`KpiStrip` lays out up to four and sizes its grid to the tile count, so no slot is left empty.

Rules: every tile with a count links to the filtered list behind it. A tile is neutral unless
`attention` is true; zeros and all-clears are never colored. While data loads, pass `loading`: the tile
shows a skeleton, never a number. Counts come from the API's readiness source, never recomputed in the
page.

## Field, TextInput, Select, Textarea

**Ready.** `Field` renders a visible label, required marker, help text and inline error, and passes
`id`, `aria-describedby`, `aria-invalid` and `aria-required` to its control through a render function.

```tsx
<Field label="Reason" required help="Recorded in custody history" error={errors.reason}>
  {(control) => <TextInput {...control} value={reason} onChange={…} />}
</Field>
```

Rules: no placeholder-only inputs. Required reasons stay required wherever they are required today.
Validation messages say what to do ("Enter a reason"). Client checks mirror server validation; they never
replace it.

## InlineNotice

**Ready.** `role` (`success`, `warning`, `danger`, `info`), `title`, body, one `action`. Danger is
announced immediately (`role="alert"`), the others politely.

Rules: errors explain the next step. Never a raw API error string or status code. Never claim success
the server hasn't confirmed.

## EmptyState

**Ready.** `title`, `description`, `action`, `steps` (first-run guide), `icon`.

Rules: always offer the next step a person with this role can take. Hidden prerequisites (types,
locations) are listed as steps.

## AsyncState / Skeleton

**Ready.** `status`: `loading` | `error` | `empty` | `ready`; `noun`; `onRetry`; `errorDetail`; `empty`;
`skeleton`.

Rules: loading is a skeleton; failure is "Couldn't load {noun}" with Retry; empty is an EmptyState.
A page never shows zero, "None" or an all-clear before its data has loaded. Error and empty detection
follows the API contracts owned by the operational workstream (SV-05, SV-06, SV-15).

## DataTable (with phone CardList)

**Ready.** `caption`, `columns`, `rows`, `getRowId`, `onRowSelect`, `selectedRowId`, `status`, `noun`,
`onRetry`, `empty`, `initialSort`.

Column: `key`, `header`, `render`, `sortValue` (sortable when present), `mono`, `align`, `minWidth`
(`md`/`lg`/`xl`: hide below that width in table mode), `cardHidden`.

Behavior: sortable headers with `aria-sort` (asc → desc → unsorted, empty values last, stable); pinned
first column; dark scrollbar; rows are focusable and open with Enter or Space; under 640px the same rows
render as cards with the first column as the title and the other fields in column order.

Rules: the row is the link: selecting it opens the record drawer (Sheet) or the record. Six columns or
fewer at 1280px with no sideways scroll; move the rest to the record. Status columns use StatusChip.
Identifiers use `mono`. Sorting and filtering are client-side over the existing list response; the table
never changes what the API returns.

Planned: column chooser, row selection checkboxes for bulk actions.

## FilterBar / SavedViews

**Ready.** `FilterBar`: `search` (`value`, `onChange`, `placeholder` naming what is searchable), up to
three inline `filters`, `activeFilterCount`, `onOpenFilters` (opens a Sheet below 768px), `trailing`.
`SavedViews`: one-tap list views with counts (`views`, `activeKey`, `onSelect`).

Rules: below 768px only search and "Filters (n)" are visible. Saved views answer the questions people
ask ("In storage", "Needs inspection", "Custody not recorded") and replace ad-hoc toggles. The active view
and filters belong in the URL query so Back and sharing work.

## Dialog

**Ready.** `open`, `onClose`, `title`, `description`, `footer`, `error`, `busy`, `dirty`. Native `<dialog>`
with `showModal()`: focus is trapped and returns to the opener; Escape and backdrop close it unless `busy`.
With `dirty`, closing first asks "Discard your changes?" inside the dialog (Keep editing / Discard).

Rules: for short creates (the Training Event pattern). A create is saved only by its explicit Create
button and confirmed by a toast; no second "are you sure". API errors go in `error` so the person can
fix and resubmit without losing input. No `window.prompt`, `window.confirm` or `alert`.

## Sheet

**Ready.** Dialog props plus `auditNotice`. Right side from 640px, bottom sheet on phones.

Rules: for record actions and accountable state changes (custody, status, restriction, check-out).
Shows From → To, keeps required reasons required, shows the one-line audit notice ("Recorded in custody
history with your name and time"), and the submit button names the effect. No extra confirmation. Sheets
call the same endpoints with the same payloads as the screens they replace.

## ConfirmDialog

**Ready.** `title` naming action and record, `impact`, `confirmLabel` naming the effect, `destructive`,
`busy`, `error`, `typedConfirmation` (irreversible actions only).

Rules: only for destructive or broad-impact actions (archive, retire, unpublish, agency rules, lock a
range day, role changes). Never for routine saves, creates or accountable changes; over-confirming
trains people to click through.

## SegmentedControl

**Ready.** `label`, `options` (`value`, `label`, `role`), `value` (null = unanswered), `onChange`,
`size` `md` | `field` (44px), `disabled`. A radio group with arrow-key navigation and a roving tab stop.

Rules: starts unanswered; nothing is pre-set to Pass. Safety acknowledgments are answered one by one; no
"mark remaining as Pass" covers them (blueprint §1b).

## Tabs

**Ready.** `label`, `tabs` (`label`, `href`, `count`), `activeHref`. Link-based.

Rules: every tab has a URL (route or `?tab=`). A record's History tab is never removed.

## EntityLabel

**Ready.** `name`, `identifier` (mono), `meta`, `href`, `fallback`.

Rules: records are named the way people know them. Never show a database id or UUID; when the name is
missing show the fallback.

## Toast (ToastProvider, useToast)

**Ready.** `toast.success(message)`, `toast.error(message)`, `toast.info(message)`. Success and info
dismiss after 5 s; errors stay until dismissed. Announced through a live region.

Rules: confirms a completed action in plain words after the server confirms it. Errors say the next
step. Autosaving work (range scoring, notes) shows inline status instead of toasts.

## Planned (contract fixed, not built yet)

| Component | Contract | Stage |
|---|---|---|
| AppShell | Top bar (global search, bell, user menu), sidebar with "Home · My work" first and the active group open, icon rail at 768–1279px, phone bottom bar (Home / Search / Inbox / Menu). Search and bell slots stay hidden until their APIs exist. | R1 (visual) / R2 |
| Drawer | Sheet variant for row preview with a "Full record ›" link; overlay on tablet, bottom sheet on phone. Built on `Sheet`. | R1 |
| Checklist | Inspection acknowledgments; exact API below. | R2 |
| StatusChangeSheet | `Sheet` preset for status changes with reason, before → after and audit notice. | R2 |
| InboxList | One attention list where every item says what happened, to whom, and opens the record. | R3 (needs inbox API) |

### Checklist contract (R2)

`Checklist` is a controlled, presentational component for existing inspection and other safety-critical
forms. It owns unanswered state presentation, progress, required-item feedback and the sticky result
summary. The caller owns the existing endpoint, payload mapping, validation, permission checks, audit
writes and the status-effect calculation. The component never fills or submits an answer implicitly.

```tsx
type ChecklistItem = {
  id: string;
  label: string;
  help?: ReactNode;
  required: boolean;
  safetyCritical: boolean;
  showCanBeDrivenOnDefect?: boolean;
};

type ChecklistAnswer = {
  value: string | null; // null or missing means unanswered
  note?: string;
  canBeDriven?: boolean;
};

<Checklist
  items={items}
  options={[
    { value: "pass", label: "Pass", role: "success" },
    { value: "defect", label: "Defect", role: "danger" },
    { value: "na", label: "N/A" },
  ]}
  defectValue="defect"
  answers={answers}
  onAnswer={(itemId, answer) => setAnswer(itemId, answer)}
  summary={resultSummary}
  submitLabel="Submit inspection"
  busy={saving}
  onSubmit={submit}
/>
```

`items` are rendered in their supplied order. Each has one `SegmentedControl`; absent answers render
unanswered, including every safety-critical item. `required` answers are listed by label while missing,
counted in progress and block Submit. No bulk-answer control is provided. The defect note appears only
when that item's selected value equals `defectValue`; `Can it be driven?` appears only for a defect on
items with `showCanBeDrivenOnDefect`. Those values are returned through `onAnswer`; requiredness and
payload semantics remain with the caller. `summary` must state the computed result and its status effect
before Submit. Submit remains disabled while required answers are missing or `busy` is true.

At phone widths, progress and the result summary stay visible in a sticky footer above the shell's
bottom navigation and safe area; the checklist itself scrolls. All answer options and defect fields meet
the 44px touch target, use visible labels, support keyboard operation and announce missing required items.
The component supports the shared 1280px desktop, 768px tablet and 375px phone acceptance viewports;
the page must not gain horizontal scrolling. The inspection screen continues using the same route and
request contract as its verified baseline.

## Accessibility expectations (all components and every modernized screen)

- Keyboard: everything reachable and operable with Tab, Shift+Tab, Enter, Space, Escape and arrow keys
  (segmented controls, tabs). Visible focus ring on every focusable element.
- Names: every control has a visible label or an `aria-label`; icon-only buttons have `aria-label`.
- Contrast: text ≥ 4.5:1 (use `fg`, `fg-secondary`, `fg-muted`; nothing dimmer for text).
- Targets: ≥ 44px on touch; `field` sizes for gloved use.
- Announcements: errors use `role="alert"`; progress and success use `role="status"` or the toast region.
- Motion: no essential information conveyed only by animation or color; status always has a text label.
- Automated check: axe reports no new violations on the screen's states (loaded, empty, loading, error).
