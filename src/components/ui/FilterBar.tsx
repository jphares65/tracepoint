"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useId, type ReactNode } from "react";

import { Button } from "./Button";
import { cx } from "./cx";

export type SavedView = {
  key: string;
  label: string;
  count?: number;
};

export type FilterBarProps = {
  search: {
    value: string;
    onChange: (value: string) => void;
    /** Says what can be searched: "Search make, model, serial, officer". */
    placeholder: string;
    label?: string;
  };
  /** Up to three inline filter controls (Selects) shown from 768px. */
  filters?: ReactNode;
  /** How many filters are active. Drives the phone "Filters (n)" button. */
  activeFilterCount?: number;
  /** Opens a Sheet with all filters. Required on phones when `filters` is set. */
  onOpenFilters?: () => void;
  /** Trailing controls such as a column chooser or Export. */
  trailing?: ReactNode;
  className?: string;
};

/**
 * Search plus up to three inline filters; below 768px a single "Filters (n)" button.
 * Contract: COMPONENTS.md#filterbar
 */
export function FilterBar({ search, filters, activeFilterCount = 0, onOpenFilters, trailing, className }: FilterBarProps) {
  const searchId = useId();
  return (
    <div role="search" className={cx("flex flex-wrap items-center gap-2", className)}>
      <div className="relative min-w-0 flex-1 basis-56">
        <label htmlFor={searchId} className="sr-only">
          {search.label ?? search.placeholder}
        </label>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
        <input
          id={searchId}
          type="search"
          value={search.value}
          onChange={(event) => search.onChange(event.target.value)}
          placeholder={search.placeholder}
          className="tp-touch-target h-10 w-full rounded-control border border-line-strong bg-surface-sunken pl-9 pr-3 text-body text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
        />
      </div>
      {filters ? <div className="hidden items-center gap-2 md:flex">{filters}</div> : null}
      {filters && onOpenFilters ? (
        <Button
          className="md:hidden"
          icon={<SlidersHorizontal aria-hidden="true" className="h-4 w-4" />}
          onClick={onOpenFilters}
        >
          {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : "Filters"}
        </Button>
      ) : null}
      {trailing ? <div className="flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}

export type SavedViewsProps = {
  label: string;
  views: readonly SavedView[];
  activeKey: string;
  onSelect: (key: string) => void;
  className?: string;
};

/**
 * One-tap answers to the questions people ask of a list ("What's restricted?"),
 * each with a count. Replaces ad-hoc view toggles and group selects (blueprint §3D).
 */
export function SavedViews({ label, views, activeKey, onSelect, className }: SavedViewsProps) {
  return (
    <div role="group" aria-label={label} className={cx("-mx-1 flex gap-1 overflow-x-auto px-1 pb-1", className)}>
      {views.map((view) => {
        const active = view.key === activeKey;
        return (
          <button
            key={view.key}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(view.key)}
            className={cx(
              "tp-touch-target inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-label font-medium transition-colors",
              active ? "border-accent bg-accent-soft text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
            )}
          >
            {view.label}
            {typeof view.count === "number" ? <span className="font-mono text-caption text-fg-secondary">{view.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
