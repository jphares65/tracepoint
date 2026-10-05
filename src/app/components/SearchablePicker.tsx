"use client";

import { useMemo, useState } from "react";
import {
  filterSearchablePickerOptions,
  nextSearchablePickerIndex,
  type SearchablePickerOption,
} from "@/lib/tracepoint/searchable-picker";

export type { SearchablePickerOption } from "@/lib/tracepoint/searchable-picker";

export default function SearchablePicker({
  id,
  label,
  options,
  value,
  onChange,
  placeholder,
  loading = false,
  error = "",
  clearable = true,
  createAction,
}: {
  id: string;
  label: string;
  options: SearchablePickerOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  loading?: boolean;
  error?: string;
  clearable?: boolean;
  createAction?: { label: string; onSelect: () => void };
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = useMemo(
    () => filterSearchablePickerOptions(options, query),
    [options, query],
  );
  const selected = options.find((option) => option.id === value);
  const select = (option: SearchablePickerOption) => {
    onChange(option.id);
    setQuery(option.label);
    setOpen(false);
  };
  const clear = () => {
    onChange("");
    setQuery("");
    setOpen(true);
    setActiveIndex(0);
  };
  return (
    <div className="relative">
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={`${id}-options`}
          aria-expanded={open}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 pr-9 text-sm text-white"
          placeholder={placeholder}
          value={selected && !open ? selected.label : query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
            if (value) onChange("");
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) =>
                nextSearchablePickerIndex(index, matches.length, 1),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) =>
                nextSearchablePickerIndex(index, matches.length, -1),
              );
            } else if (event.key === "Enter" && open && matches[activeIndex]) {
              event.preventDefault();
              select(matches[activeIndex]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
        />
        {clearable && value ? (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-slate-400"
          >
            ×
          </button>
        ) : null}
      </div>
      {open ? (
        <div
          id={`${id}-options`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 p-1 shadow-xl"
        >
          {loading ? (
            <p className="p-2 text-xs text-slate-400">Loading options…</p>
          ) : error ? (
            <p role="alert" className="p-2 text-xs text-red-300">
              {error}
            </p>
          ) : matches.length ? (
            matches.map((option, index) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.id === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(option)}
                className={`block w-full rounded-md px-2 py-2 text-left text-sm ${index === activeIndex ? "bg-slate-800 text-white" : "text-slate-200"}`}
              >
                <span className="block">{option.label}</span>
                {option.detail ? (
                  <span className="block text-xs text-slate-400">
                    {option.detail}
                  </span>
                ) : null}
              </button>
            ))
          ) : (
            <p className="p-2 text-xs text-slate-400">No matches found.</p>
          )}
          {createAction ? (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                createAction.onSelect();
                setOpen(false);
              }}
              className="mt-1 block w-full border-t border-slate-800 px-2 py-2 text-left text-sm font-semibold text-blue-300"
            >
              + {createAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
