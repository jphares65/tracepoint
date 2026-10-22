"use client";

import { useRef, type KeyboardEvent } from "react";

import { cx } from "./cx";
import type { StatusRole } from "./status";

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  /** Role used for the selected state, e.g. Pass = success, Defect = danger. */
  role?: StatusRole;
};

export type SegmentedControlProps<T extends string> = {
  /** Accessible name, e.g. the checklist item: "Brakes, steering & controls". */
  label: string;
  options: readonly SegmentOption<T>[];
  /** null means unanswered. Nothing is pre-selected (blueprint §1b). */
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: "md" | "field";
  className?: string;
};

const SELECTED: Record<StatusRole, string> = {
  success: "border-success-line bg-success-soft text-success",
  warning: "border-warning-line bg-warning-soft text-warning",
  danger: "border-danger-line bg-danger-soft text-danger",
  info: "border-info-line bg-info-soft text-info",
  neutral: "border-line-strong bg-surface-raised text-fg",
};

/**
 * Single choice as a radio group. Field size is 44px tall for gloves and poor light.
 * Arrow keys move between options. Contract: COMPONENTS.md#segmentedcontrol
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  size = "md",
  className,
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next].value);
  }

  return (
    <div role="radiogroup" aria-label={label} className={cx("inline-flex w-full gap-1 rounded-control border border-line bg-surface-sunken p-1", className)}>
      {options.map((option, index) => {
        const selected = option.value === value;
        // Roving tab stop: the selected option, or the first one while unanswered.
        const tabbable = selected || (selectedIndex === -1 && index === 0);
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={tabbable ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cx(
              "flex-1 rounded-[4px] border px-3 font-semibold transition-colors disabled:opacity-50",
              size === "field" ? "min-h-11 text-body" : "tp-touch-target min-h-8 text-label",
              selected ? SELECTED[option.role ?? "neutral"] : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
