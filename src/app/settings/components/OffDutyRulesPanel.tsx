"use client";

import {
  useEffect,
  useState,
} from "react";

type OffDutyRules = {
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

export default function OffDutyRulesPanel() {
  const [rules, setRules] =
    useState<OffDutyRules>({
      requireInspection: true,
      requireQualification: true,
      renewalDays: 365,
      inspectionIntervalDays: 180,
      inspectionDueSoonDays: 30,
    });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setError("");

    try {
      const payload =
        await requestJson<{
          rules: OffDutyRules;
        }>(
          "/api/settings/off-duty-rules",
        );

      setRules(payload.rules);
    }
    catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Off-duty rules could not be loaded.",
      );
    }
    finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");

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

      setRules(payload.rules);
      setMessage("Off-duty firearm policy saved.");
    }
    catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Off-duty rules could not be saved.",
      );
    }
    finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="py-8 text-sm text-slate-400">
        Loading off-duty firearm rules…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-xl border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">
          {message}
        </div>
      ) : null}

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
              setRules((current) => ({
                ...current,
                requireInspection:
                  event.target.checked,
              }))
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
              setRules((current) => ({
                ...current,
                requireQualification:
                  event.target.checked,
              }))
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
              setRules((current) => ({
                ...current,
                renewalDays:
                  Number(event.target.value),
              }))
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
              setRules((current) => ({
                ...current,
                inspectionIntervalDays:
                  Number(event.target.value),
              }))
            }
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white disabled:cursor-not-allowed"
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
          Inspection due-soon warning
          <input
            type="number"
            min={0}
            disabled={!rules.requireInspection}
            value={rules.inspectionDueSoonDays}
            onChange={(event) =>
              setRules((current) => ({
                ...current,
                inspectionDueSoonDays:
                  Number(event.target.value),
              }))
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

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save Off-Duty Rules"}
      </button>
    </div>
  );
}