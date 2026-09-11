"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  LoaderCircle,
  Info,
  Plus,
  RotateCcw,
  Save,
  X,
} from "lucide-react";

import {
  mergeAnalyticsDashboardConfiguration,
  normalizeAnalyticsDashboardConfiguration,
  resetAnalyticsDashboardConfiguration,
  type AnalyticsDashboardConfiguration,
  type CommandDashboardCardSize,
} from "@/lib/tracepoint/analytics-dashboard-config";

function clearCustomizeQuery() {
  const url = new URL(window.location.href);
  url.searchParams.delete("customize");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function useVisualConfigurationEditor({
  configuration,
  departmentId,
  canAdminister,
  editorName,
  onSaved,
}: {
  configuration: AnalyticsDashboardConfiguration;
  departmentId: string;
  canAdminister: boolean;
  editorName: "dashboard" | "analytics";
  onSaved: (configuration: AnalyticsDashboardConfiguration) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() =>
    normalizeAnalyticsDashboardConfiguration(configuration),
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!canAdminister) return;
    const requestedEditor = new URLSearchParams(window.location.search).get(
      "customize",
    );
    if (requestedEditor !== editorName) return;

    const frame = window.requestAnimationFrame(() => {
      setDraft(normalizeAnalyticsDashboardConfiguration(configuration));
      setEditing(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [canAdminister, configuration, editorName]);

  const begin = useCallback(() => {
    if (!canAdminister) return;
    setDraft(normalizeAnalyticsDashboardConfiguration(configuration));
    setNotice(null);
    setEditing(true);
  }, [canAdminister, configuration]);

  const cancel = useCallback(() => {
    setDraft(normalizeAnalyticsDashboardConfiguration(configuration));
    setNotice(null);
    setEditing(false);
    clearCustomizeQuery();
  }, [configuration]);

  const reset = useCallback(() => {
    setDraft(resetAnalyticsDashboardConfiguration());
    setNotice("Recommended defaults are previewed. Save to apply them.");
  }, []);

  const save = useCallback(async () => {
    if (!canAdminister || !departmentId) return;
    setSaving(true);
    setNotice(null);

    try {
      if (process.env.NEXT_PUBLIC_TRACEPOINT_PROVIDER_MODE === "aws-native") throw new Error("View customization is isolated until its PostgreSQL write endpoint is enabled.");
      const supabase = (await import("@/lib/supabase/client")).createClient();
      // The generated database types do not yet expose this existing JSON column.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const table = (supabase as any).from("department_rules");
      const { data, error: loadError } = await table
        .select("range_qualification_rules")
        .eq("department_id", departmentId)
        .maybeSingle();

      if (loadError) throw loadError;

      const normalized = normalizeAnalyticsDashboardConfiguration(draft);
      const { error: saveError } = await (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase as any
      ).from("department_rules").upsert(
        {
          department_id: departmentId,
          range_qualification_rules: mergeAnalyticsDashboardConfiguration(
            data?.range_qualification_rules,
            normalized,
          ),
        },
        { onConflict: "department_id" },
      );

      if (saveError) throw saveError;

      setDraft(normalized);
      onSaved(normalized);
      setEditing(false);
      clearCustomizeQuery();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The view could not be saved. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }, [canAdminister, departmentId, draft, onSaved]);

  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify(normalizeAnalyticsDashboardConfiguration(configuration));

  return {
    editing,
    draft,
    setDraft,
    saving,
    notice,
    dirty,
    begin,
    cancel,
    reset,
    save,
  };
}

export function CustomizationBar({
  title,
  description,
  addLabel,
  addOpen,
  dirty,
  saving,
  notice,
  onToggleAdd,
  onReset,
  onCancel,
  onSave,
  children,
}: {
  title: string;
  description: string;
  addLabel: string;
  addOpen: boolean;
  dirty: boolean;
  saving: boolean;
  notice?: string | null;
  onToggleAdd: () => void;
  onReset: () => void;
  onCancel: () => void;
  onSave: () => void;
  children?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-blue-500/30 bg-gradient-to-br from-blue-950/70 via-slate-900 to-slate-900 shadow-xl shadow-blue-950/10">
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300 ring-1 ring-blue-400/20">
            <LayoutGrid size={19} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-white">{title}</p>
              <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-blue-300">
                Live preview
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-400">
              {description}
            </p>
            {notice ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-blue-200">
                <Info size={12} /> {notice}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onToggleAdd}
            className="inline-flex items-center gap-2 rounded-xl border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-100 transition hover:bg-blue-500/20"
          >
            {addOpen ? <ChevronDown size={14} /> : <Plus size={14} />}
            {addLabel}
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-600 hover:text-white disabled:opacity-50"
          >
            <RotateCcw size={14} /> Reset to default
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-600 hover:text-white disabled:opacity-50"
          >
            <X size={14} /> Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
      {addOpen && children ? (
        <div className="border-t border-blue-500/20 bg-slate-950/35 p-4 sm:p-5">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function ReorderButtons({
  label,
  first,
  last,
  onPrevious,
  onNext,
}: {
  label: string;
  first: boolean;
  last: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <span className="inline-flex overflow-hidden rounded-lg border border-slate-700 bg-slate-950/80">
      <button
        type="button"
        aria-label={`Move ${label} earlier`}
        title="Move earlier"
        disabled={first}
        onClick={onPrevious}
        className="p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-25"
      >
        <ChevronLeft size={13} />
      </button>
      <button
        type="button"
        aria-label={`Move ${label} later`}
        title="Move later"
        disabled={last}
        onClick={onNext}
        className="border-l border-slate-700 p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-25"
      >
        <ChevronRight size={13} />
      </button>
    </span>
  );
}

export function CardSizeControl({
  value,
  onChange,
}: {
  value: CommandDashboardCardSize;
  onChange: (value: CommandDashboardCardSize) => void;
}) {
  return (
    <span className="inline-flex rounded-lg border border-slate-700 bg-slate-950/80 p-0.5">
      {(["compact", "standard", "wide"] as const).map((size) => (
        <button
          key={size}
          type="button"
          onClick={() => onChange(size)}
          className={`rounded-md px-2 py-1 text-[9px] font-semibold capitalize transition ${
            value === size
              ? "bg-blue-600 text-white"
              : "text-slate-500 hover:text-slate-200"
          }`}
        >
          {size}
        </button>
      ))}
    </span>
  );
}

export function AdvancedSettings({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <details className="rounded-2xl border border-slate-800 bg-slate-950/30">
      <summary className="cursor-pointer list-none px-4 py-3 text-xs font-semibold text-slate-300 marker:hidden">
        <span className="inline-flex items-center gap-2">
          <ChevronDown size={14} className="text-slate-500" /> Advanced Settings
        </span>
      </summary>
      <div className="border-t border-slate-800 p-4">{children}</div>
    </details>
  );
}

export function AdvancedSettingControl({
  setting,
  value,
  onChange,
}: {
  setting: {
    key: string;
    label: string;
    description: string;
    guidance?: string;
    unit: string;
    recommended: string;
    min: number;
    max: number;
  };
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label
      data-advanced-setting-key={setting.key}
      className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-3"
    >
      <span className="flex flex-wrap items-start justify-between gap-2">
        <span className="text-xs font-semibold text-slate-200">
          {setting.label}
        </span>
        <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-1 text-[9px] font-semibold text-slate-400">
          Recommended: {setting.recommended}
        </span>
      </span>
      <span className="mt-1.5 block text-[10px] leading-4 text-slate-500">
        {setting.description}
      </span>
      {setting.guidance ? (
        <span className="mt-2 block border-l-2 border-blue-500/30 pl-2 text-[10px] leading-4 text-slate-400">
          {setting.guidance}
        </span>
      ) : null}
      <span className="mt-auto flex items-center gap-2 pt-3">
        <input
          type="number"
          aria-label={`${setting.label} in ${setting.unit}`}
          min={setting.min}
          max={setting.max}
          value={value}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (!Number.isFinite(parsed)) return;
            onChange(Math.max(setting.min, Math.min(setting.max, parsed)));
          }}
          className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500"
        />
        <span className="text-[10px] text-slate-500">{setting.unit}</span>
      </span>
    </label>
  );
}
