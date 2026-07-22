"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  History,
  Loader2,
  Save,
  Send,
} from "lucide-react";

import ArmorySectionShell from "@/app/components/ArmorySectionShell";
import TracePointShell from "@/app/components/TracePointShell";

type ReconciliationStatus = "Draft" | "Submitted" | "Certified";

type LotSnapshot = {
  lotId: string;
  category: "Duty" | "Training";
  caliber: string;
  manufacturer: string;
  lotNumber: string;
  expectedQuantity: number;
  physicalQuantity: number | null;
  variance: number | null;
  explanation: string;
};

type Reconciliation = {
  id: string;
  cycleName: string;
  cycleYear: number;
  cycleStart: string;
  cycleEnd: string;
  status: ReconciliationStatus;
  notes: string | null;
  createdAt: string;
  submittedAt: string | null;
  certifiedAt: string | null;
  createdByName: string;
  submittedByName: string | null;
  certifiedByName: string | null;
  items: LotSnapshot[];
};

type Payload = {
  access: {
    canManage: boolean;
    canCertify: boolean;
  };
  currentCycle: {
    name: string;
    year: number;
    start: string;
    end: string;
    isOpen: boolean;
  };
  active: Reconciliation | null;
  history: Reconciliation[];
};

function formatDate(value?: string | null) {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Not set";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? "The reconciliation request failed.";
  } catch {
    return "The reconciliation request failed.";
  }
}

export default function AmmunitionReconciliationPage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [items, setItems] = useState<LotSnapshot[]>([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/armory/ammunition/reconciliations",
        { cache: "no-store" },
      );

      if (!response.ok) throw new Error(await readError(response));

      const next = (await response.json()) as Payload;
      setPayload(next);
      setItems(next.active?.items ?? []);
      setNotes(next.active?.notes ?? "");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "The reconciliation workspace could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const totals = useMemo(() => {
    return items.reduce(
      (accumulator, item) => {
        accumulator.expected += item.expectedQuantity;
        accumulator.physical += item.physicalQuantity ?? 0;
        accumulator.variance += item.variance ?? 0;
        if ((item.variance ?? 0) !== 0) accumulator.discrepancies += 1;
        return accumulator;
      },
      { expected: 0, physical: 0, variance: 0, discrepancies: 0 },
    );
  }, [items]);

  function updatePhysical(lotId: string, value: string) {
    const parsed =
      value.trim() === "" ? null : Number.parseInt(value, 10);

    setItems((current) =>
      current.map((item) => {
        if (item.lotId !== lotId) return item;

        const physicalQuantity =
          parsed !== null && Number.isFinite(parsed) && parsed >= 0
            ? parsed
            : null;

        return {
          ...item,
          physicalQuantity,
          variance:
            physicalQuantity === null
              ? null
              : physicalQuantity - item.expectedQuantity,
        };
      }),
    );
  }

  function updateExplanation(lotId: string, explanation: string) {
    setItems((current) =>
      current.map((item) =>
        item.lotId === lotId ? { ...item, explanation } : item,
      ),
    );
  }

  async function save(action: "save" | "submit" | "certify") {
    const incomplete = items.some(
      (item) => item.physicalQuantity === null,
    );

    if (action !== "save" && incomplete) {
      setError(
        "Every ammunition lot requires a physical count before submission.",
      );
      return;
    }

    const unexplainedVariance = items.some(
      (item) =>
        (item.variance ?? 0) !== 0 && !item.explanation.trim(),
    );

    if (action !== "save" && unexplainedVariance) {
      setError(
        "Every discrepancy requires an explanation before submission.",
      );
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        "/api/armory/ammunition/reconciliations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            reconciliationId: payload?.active?.id ?? null,
            notes,
            items,
          }),
        },
      );

      if (!response.ok) throw new Error(await readError(response));

      setMessage(
        action === "save"
          ? "Reconciliation draft saved."
          : action === "submit"
            ? "Reconciliation submitted."
            : "Reconciliation certified.",
      );

      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The reconciliation could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <TracePointShell activePage="Armory">
      <div className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-6 lg:p-8">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
          <ArmorySectionShell
            title="Ammunition Reconciliation"
            description="Seasonal physical inventory reconciliation with retained variance history."
            backHref="/firearms/ammunition"
            backLabel="Back to Ammunition"
          />

          {loading ? (
            <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-12 text-center text-slate-400">
              <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />
              Loading reconciliation workspace...
            </section>
          ) : payload ? (
            <>
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Current Cycle
                  </p>
                  <p className="mt-2 text-xl font-bold text-white">
                    {payload.currentCycle.name} {payload.currentCycle.year}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatDate(payload.currentCycle.start)}–{" "}
                    {formatDate(payload.currentCycle.end)}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Status
                  </p>
                  <p className="mt-2 text-xl font-bold text-white">
                    {payload.active?.status ?? "Not Started"}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Expected Rounds
                  </p>
                  <p className="mt-2 text-3xl font-bold text-white">
                    {totals.expected.toLocaleString()}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Discrepancies
                  </p>
                  <p
                    className={`mt-2 text-3xl font-bold ${
                      totals.discrepancies > 0
                        ? "text-amber-300"
                        : "text-emerald-300"
                    }`}
                  >
                    {totals.discrepancies}
                  </p>
                </div>
              </section>

              {!payload.currentCycle.isOpen && !payload.active ? (
                <section className="rounded-2xl border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-200">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <p>
                      The seasonal reconciliation window is closed. The next
                      cycle will open automatically during the Spring or Fall
                      window.
                    </p>
                  </div>
                </section>
              ) : null}

              {(error || message) && (
                <section
                  className={`rounded-2xl border p-4 text-sm font-medium ${
                    error
                      ? "border-red-800 bg-red-950/40 text-red-200"
                      : "border-emerald-800 bg-emerald-950/40 text-emerald-200"
                  }`}
                >
                  {error ?? message}
                </section>
              )}

              {(payload.currentCycle.isOpen || payload.active) && (
                <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 text-blue-300" />
                    <h2 className="text-lg font-bold text-white">
                      Physical Count
                    </h2>
                  </div>

                  <div className="mt-5 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 text-xs uppercase tracking-[0.15em] text-slate-500">
                          <th className="px-3 py-3">Lot</th>
                          <th className="px-3 py-3">Category</th>
                          <th className="px-3 py-3">Expected</th>
                          <th className="px-3 py-3">Physical</th>
                          <th className="px-3 py-3">Variance</th>
                          <th className="px-3 py-3">Explanation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr
                            key={item.lotId}
                            className="border-b border-slate-800/70"
                          >
                            <td className="px-3 py-4">
                              <p className="font-bold text-white">
                                {item.caliber} · {item.manufacturer}
                              </p>
                              <p className="mt-1 font-mono text-xs text-slate-500">
                                {item.lotNumber}
                              </p>
                            </td>
                            <td className="px-3 py-4 text-slate-300">
                              {item.category}
                            </td>
                            <td className="px-3 py-4 font-bold text-white">
                              {item.expectedQuantity.toLocaleString()}
                            </td>
                            <td className="px-3 py-4">
                              <input
                                value={item.physicalQuantity ?? ""}
                                onChange={(event) =>
                                  updatePhysical(
                                    item.lotId,
                                    event.target.value,
                                  )
                                }
                                type="number"
                                min="0"
                                disabled={
                                  payload.active?.status === "Certified"
                                }
                                className="w-28 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                              />
                            </td>
                            <td className="px-3 py-4">
                              <span
                                className={`font-bold ${
                                  (item.variance ?? 0) === 0
                                    ? "text-emerald-300"
                                    : "text-amber-300"
                                }`}
                              >
                                {item.variance === null
                                  ? "—"
                                  : `${item.variance > 0 ? "+" : ""}${item.variance}`}
                              </span>
                            </td>
                            <td className="px-3 py-4">
                              <input
                                value={item.explanation}
                                onChange={(event) =>
                                  updateExplanation(
                                    item.lotId,
                                    event.target.value,
                                  )
                                }
                                placeholder={
                                  (item.variance ?? 0) !== 0
                                    ? "Required for discrepancy"
                                    : "Optional"
                                }
                                disabled={
                                  payload.active?.status === "Certified"
                                }
                                className="min-w-64 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={3}
                    placeholder="Reconciliation notes"
                    disabled={payload.active?.status === "Certified"}
                    className="mt-5 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  />

                  {payload.active?.status !== "Certified" && (
                    <div className="mt-5 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => void save("save")}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-2xl bg-slate-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-600 disabled:opacity-50"
                      >
                        {saving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        Save Draft
                      </button>

                      {payload.active?.status !== "Submitted" ? (
                        <button
                          type="button"
                          onClick={() => void save("submit")}
                          disabled={saving}
                          className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50"
                        >
                          <Send className="h-4 w-4" />
                          Submit Reconciliation
                        </button>
                      ) : payload.access.canCertify ? (
                        <button
                          type="button"
                          onClick={() => void save("certify")}
                          disabled={saving}
                          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          <BadgeCheck className="h-4 w-4" />
                          Certify Reconciliation
                        </button>
                      ) : (
                        <div className="rounded-2xl border border-amber-800 bg-amber-950/35 px-4 py-2.5 text-sm text-amber-200">
                          Submitted for command certification.
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}

              <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5">
                <div className="flex items-center gap-2">
                  <History className="h-5 w-5 text-slate-400" />
                  <h2 className="text-lg font-bold text-white">
                    Reconciliation History
                  </h2>
                </div>

                <div className="mt-4 space-y-3">
                  {payload.history.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
                      No reconciliation history.
                    </div>
                  ) : (
                    payload.history.map((reconciliation) => (
                      <article
                        key={reconciliation.id}
                        className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-bold text-white">
                              {reconciliation.cycleName}{" "}
                              {reconciliation.cycleYear}
                            </p>
                            <p className="mt-1 text-sm text-slate-400">
                              Created by {reconciliation.createdByName}
                            </p>
                            {reconciliation.certifiedByName ? (
                              <p className="mt-1 text-xs text-slate-600">
                                Certified by{" "}
                                {reconciliation.certifiedByName} on{" "}
                                {formatDateTime(
                                  reconciliation.certifiedAt,
                                )}
                              </p>
                            ) : null}
                          </div>

                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-bold ${
                              reconciliation.status === "Certified"
                                ? "border-emerald-700 bg-emerald-950/60 text-emerald-200"
                                : reconciliation.status === "Submitted"
                                  ? "border-blue-700 bg-blue-950/60 text-blue-200"
                                  : "border-slate-700 bg-slate-900 text-slate-300"
                            }`}
                          >
                            {reconciliation.status}
                          </span>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </TracePointShell>
  );
}
