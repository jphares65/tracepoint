"use client";

import {
  useEffect,
  useState,
} from "react";

import SaveStatus, { type SaveResult } from "./SaveStatus";

export type OffDutyRules = {
  requireInspection: boolean;
  requireQualification: boolean;
  renewalDays: number;
  inspectionIntervalDays: number;
  inspectionDueSoonDays: number;
};

async function requestJson<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
  });

  const payload =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload?.error ||
        `Request failed (${response.status}).`,
    );
  }

  return payload as T;
}

const DEFAULT_RULES: OffDutyRules = {
  requireInspection: true,
  requireQualification: true,
  renewalDays: 365,
  inspectionIntervalDays: 180,
  inspectionDueSoonDays: 30,
};

function sameRules(a: OffDutyRules, b: OffDutyRules) {
  return (Object.keys(DEFAULT_RULES) as Array<keyof OffDutyRules>).every((key) => a[key] === b[key]);
}

export default function OffDutyRulesPanel({
  onSaved,
  onDirtyChange,
}: {
  /** The rules as the server stored them, after a save. */
  onSaved?: (rules: OffDutyRules) => void;
  /** Whether this panel has unsaved changes (E-06). */
  onDirtyChange?: (dirty: boolean) => void;
} = {}) {
  const [rules, setRules] =
    useState<OffDutyRules>(DEFAULT_RULES);
  // The rules as last loaded from or saved to the server.
  const [savedRules, setSavedRules] =
    useState<OffDutyRules>(DEFAULT_RULES);

  const [loadState, setLoadState] = useState<"loading" | "loaded" | "failed">("loading");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveResult>(null);

  const dirty = loadState === "loaded" && !sameRules(rules, savedRules);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Leaving with unsaved edits is guarded by the page; unmounting discards them.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  async function load() {
    setLoadState("loading");
    setLoadError("");

    try {
      const payload =
        await requestJson<{
          rules: OffDutyRules;
        }>(
          "/api/settings/off-duty-rules",
        );

      setRules(payload.rules);
      setSavedRules(payload.rules);
      setLoadState("loaded");
    }
    catch (loadError) {
      // Never show (or save) defaults in place of rules that did not load.
      setLoadError(
        loadError instanceof Error
          ? loadError.message
          : "Off-duty rules could not be loaded.",
      );
      setLoadState("failed");
    }
  }

  useEffect(() => {
    // Loading is an external request made once when the panel opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  function edit(patch: Partial<OffDutyRules>) {
    setResult(null);
    const next = { ...rules, ...patch };
    setRules(next);
    // Tell the page at once, so a tab change in the same moment is guarded.
    onDirtyChange?.(!sameRules(next, savedRules));
  }

  async function save() {
    if (loadState !== "loaded" || saving) return;
    setSaving(true);
    setResult(null);

    try {
      const payload =
        await requestJson<{
          rules: OffDutyRules;
        }>(
          "/api/settings/off-duty-rules",
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify(rules),
          },
        );

      // Show what the server stored, not what was sent.
      setRules(payload.rules);
      setSavedRules(payload.rules);
      onDirtyChange?.(false);
      setResult({ tone: "success", message: "Off-duty firearm rules saved." });
      onSaved?.(payload.rules);
    }
    catch (saveError) {
      setResult({
        tone: "error",
        message: `${
          saveError instanceof Error && saveError.message
            ? saveError.message
            : "Off-duty rules could not be saved."
        } Your changes are still on this form.`,
      });
    }
    finally {
      setSaving(false);
    }
  }

  if (loadState === "loading") {
    return (
      <div className="py-8 text-sm text-slate-400">
        Loading off-duty firearm rules…
      </div>
    );
  }

  if (loadState === "failed") {
    return (
      <div role="alert" className="space-y-3 rounded-xl border border-red-800 bg-red-950/30 p-4 text-sm text-red-200">
        <p>
          {loadError} The current off-duty rules are unchanged; nothing can be
          saved until they load.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl border border-red-700 px-3 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-900/40"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-800 bg-slate-950/30 p-5">
        <label className="flex items-start justify-between gap-5">
          <div>
            <div className="text-sm font-semibold text-white">
              Require Department Inspection
            </div>

            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
              When enabled, an off-duty firearm must have a
              current passing department inspection before
              command approval. When disabled, inspection is
              optional and does not block approval.
            </p>
          </div>

          <input
            type="checkbox"
            checked={rules.requireInspection}
            onChange={(event) =>
              edit({ requireInspection: event.target.checked })
            }
            className="mt-1 h-5 w-5"
          />
        </label>

        {!rules.requireInspection ? (
          <div className="mt-4 rounded-xl border border-blue-900/60 bg-blue-950/20 p-3 text-xs leading-5 text-blue-200">
            Inspection is optional. Existing inspection history
            remains preserved, but a missing or expired inspection
            will not prevent approval.
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/30 p-5">
        <label className="flex items-start justify-between gap-5">
          <div>
            <div className="text-sm font-semibold text-white">
              Require Independent Qualification
            </div>

            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
              When enabled, the officer must have a current
              qualifying record before command may approve the
              off-duty firearm. When disabled, qualification
              readiness remains visible but does not block
              command approval.
            </p>
          </div>

          <input
            type="checkbox"
            checked={rules.requireQualification}
            onChange={(event) =>
              edit({ requireQualification: event.target.checked })
            }
            className="mt-1 h-5 w-5"
          />
        </label>

        {!rules.requireQualification ? (
          <div className="mt-4 rounded-xl border border-blue-900/60 bg-blue-950/20 p-3 text-xs leading-5 text-blue-200">
            Independent qualification is not required by agency
            policy. Missing, expired, or failed qualification
            readiness will not block command approval.
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <label className="text-xs text-slate-400">
          Authorization renewal
          <input
            type="number"
            min={1}
            max={3650}
            value={rules.renewalDays}
            onChange={(event) =>
              edit({ renewalDays: Number(event.target.value) })
            }
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
          />
          <span className="mt-1 block text-slate-500">
            Days
          </span>
        </label>

        <label
          className={`text-xs text-slate-400 ${
            rules.requireInspection
              ? ""
              : "opacity-50"
          }`}
        >
          Inspection validity
          <input
            type="number"
            min={1}
            max={3650}
            disabled={!rules.requireInspection}
            value={rules.inspectionIntervalDays}
            onChange={(event) =>
              edit({ inspectionIntervalDays: Number(event.target.value) })
            }
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white disabled:cursor-not-allowed"
          />
          <span className="mt-1 block text-slate-500">
            Days · the same setting as the Armory inspection interval
          </span>
        </label>

        <label
          className={`text-xs text-slate-400 ${
            rules.requireInspection
              ? ""
              : "opacity-50"
          }`}
        >
          Inspection due-soon warning
          <input
            type="number"
            min={0}
            disabled={!rules.requireInspection}
            value={rules.inspectionDueSoonDays}
            onChange={(event) =>
              edit({ inspectionDueSoonDays: Number(event.target.value) })
            }
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white disabled:cursor-not-allowed"
          />
          <span className="mt-1 block text-slate-500">
            Days before expiration
          </span>
        </label>
      </section>

      <div className="rounded-xl border border-slate-800 bg-slate-950/20 p-4 text-xs leading-5 text-slate-500">
        Changing this requirement does not retroactively revoke
        already approved off-duty firearms. Existing inspection
        history remains part of the record regardless of policy.
      </div>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/90 p-3 backdrop-blur">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Off-Duty Rules"}
        </button>
        <SaveStatus name="Off-Duty Rules" result={result} dirty={dirty} />
      </div>
    </div>
  );
}