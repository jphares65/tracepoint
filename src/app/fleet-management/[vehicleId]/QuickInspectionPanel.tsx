"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  PackageCheck,
  RefreshCw,
  RotateCcw,
} from "lucide-react";

const DEFAULT_ITEMS = [
  ["body", "Body, windshield and mirrors"],
  ["tires", "Tires and wheels"],
  ["lights", "Lights, signals and siren"],
  ["controls", "Brakes, steering and controls"],
  ["fluids", "Fluids and visible leaks"],
  ["interior", "Seatbelts and interior condition"],
].map(([id, label], index) => ({
  id,
  label,
  category: "Vehicle Condition",
  required: true,
  critical: false,
  active: true,
  sort_order: index + 1,
}));

type Condition = "Pass" | "Defect" | "Critical";

type Item = {
  id: string;
  label: string;
  category: string;
  condition: Condition;
  note: string;
  required: boolean;
  critical: boolean;
  sort_order: number;
  equipmentId?: string;
  equipmentStatus?: string;
};

function badge(result: string) {
  return result === "Passed"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : result === "Failed"
      ? "border-red-500/30 bg-red-500/10 text-red-300"
      : "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

export default function QuickInspectionPanel({
  vehicleId,
  vehicle,
  inspections,
  rules,
  equipment,
  onSaved,
}: {
  vehicleId: string;
  vehicle: any;
  inspections: any[];
  rules: any;
  equipment: any[];
  onSaved: () => Promise<void>;
}) {
  const configuredSource =
    Array.isArray(rules?.inspection_checklist) &&
    rules.inspection_checklist.length
      ? rules.inspection_checklist
      : DEFAULT_ITEMS;

  const configured = configuredSource
    .filter((item: any) => item?.active !== false)
    .sort(
      (a: any, b: any) =>
        Number(a?.sort_order ?? 0) - Number(b?.sort_order ?? 0),
    );

  const requiredEquipment =
    rules?.inspection_include_required_equipment === false
      ? []
      : (equipment ?? []).filter(
          (item) =>
            (item.is_required || item.is_critical) && item.status !== "Removed",
        );

  const types =
    Array.isArray(rules?.inspection_types) && rules.inspection_types.length
      ? rules.inspection_types
      : ["Pre-Shift", "Post-Shift", "Weekly"];

  const makeItems = (): Item[] => [
    ...configured.map((item: any, index: number) => ({
      id: String(item.id || `item-${index + 1}`),
      label: String(item.label || `Item ${index + 1}`),
      category: String(item.category || "Vehicle Condition"),
      required: item.required !== false,
      critical: item.critical === true,
      sort_order: Number(item.sort_order ?? index + 1),
      condition: "Pass" as Condition,
      note: "",
    })),

    ...requiredEquipment.map((item: any, index: number) => ({
      id: `equipment:${item.id}`,
      equipmentId: item.id,
      label: `${item.name}${item.serial_number ? ` · Serial ${item.serial_number}` : ""}`,
      category: item.category || "Required Equipment",
      equipmentStatus: item.status,
      required: true,
      critical: item.is_critical === true,
      sort_order: 1000 + index,
      condition:
        item.status === "Out of Service"
          ? ("Critical" as Condition)
          : ["Missing", "Attention"].includes(item.status)
            ? item.is_critical === true
              ? ("Critical" as Condition)
              : ("Defect" as Condition)
            : ("Pass" as Condition),
      note:
        item.status === "Current"
          ? ""
          : `Previously recorded as ${item.status}`,
    })),
  ];

  const [active, setActive] = useState(false);
  const [items, setItems] = useState<Item[]>(makeItems);
  const [inspectionType, setInspectionType] = useState(types[0]);
  const [mileage, setMileage] = useState(String(vehicle.current_mileage ?? 0));
  const [hours, setHours] = useState(String(vehicle.current_hours ?? 0));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [previewRecords, setPreviewRecords] = useState<any[]>([]);

  const allInspections = [...previewRecords, ...inspections];

  const exceptionCount = useMemo(
    () => items.filter((item) => item.condition !== "Pass").length,
    [items],
  );

  const categories = useMemo(() => {
    const grouped = new Map<string, Item[]>();

    for (const item of items) {
      const category = item.category || "Vehicle Condition";
      const current = grouped.get(category) ?? [];
      current.push(item);
      grouped.set(category, current);
    }

    return Array.from(grouped.entries());
  }, [items]);

  function setCondition(id: string, condition: Condition) {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;

        const effectiveCondition =
          condition === "Defect" && item.critical ? "Critical" : condition;

        return {
          ...item,
          condition: effectiveCondition,
          note: effectiveCondition === "Pass" ? "" : item.note,
        };
      }),
    );
  }

  function reset() {
    setItems(makeItems());
    setNotes("");
    setError("");
  }

  async function submit() {
    const missingNote = items.find(
      (item) => item.condition !== "Pass" && !item.note.trim(),
    );

    if (missingNote) {
      setError(`Add a short note for ${missingNote.label}.`);
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const result = items.some((item) => item.condition === "Critical")
        ? "Failed"
        : exceptionCount
          ? "Passed with Defects"
          : "Passed";

      if (vehicleId === "preview") {
        setPreviewRecords((current) => [
          {
            id: `preview-${Date.now()}`,
            inspection_type: inspectionType,
            result,
            mileage: Number(mileage),
            hours: Number(hours),
            defect_count: exceptionCount,
            inspected_at: new Date().toISOString(),
            checklist: items,
          },
          ...current,
        ]);

        setMessage(
          exceptionCount
            ? "Preview inspection completed. Defects would create mechanic work and update readiness."
            : "Preview inspection completed in seconds with all items passing.",
        );

        setActive(false);
        reset();
        return;
      }

      const response = await fetch(
        `/api/fleet/vehicles/${vehicleId}/inspections`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inspectionType,
            mileage,
            hours,
            notes,
            checklist: items,
          }),
        },
      );

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Inspection could not be submitted.");
      }

      setMessage(
        payload.workOrder
          ? "Inspection saved. Defects were routed to the mechanic."
          : "Inspection saved. Vehicle remains ready.",
      );

      setActive(false);
      reset();
      await onSaved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Inspection could not be submitted.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-bold text-white">Quick Vehicle Inspection</h2>
            <p className="mt-1 text-xs text-slate-500">
              Agency checks and this vehicle&apos;s required equipment are
              preloaded. Touch only exceptions.
            </p>
          </div>

          <button
            onClick={() => setActive((value) => !value)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-500"
          >
            <ClipboardCheck size={15} />
            {active ? "Close Inspection" : "Start Inspection"}
          </button>
        </div>

        {message ? (
          <div className="mt-4 rounded-xl border border-emerald-700 bg-emerald-950/30 p-3 text-xs text-emerald-200">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-red-700 bg-red-950/30 p-3 text-xs text-red-200">
            {error}
          </div>
        ) : null}

        {active ? (
          <div className="mt-5 space-y-4 border-t border-slate-800 pt-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <label>
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">
                  Inspection
                </span>
                <select
                  value={inspectionType}
                  onChange={(e) => setInspectionType(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  {types.map((type: string) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>

              <label>
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">
                  Mileage
                </span>
                <input
                  type="number"
                  min="0"
                  value={mileage}
                  onChange={(e) => setMileage(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </label>

              <label>
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">
                  Engine Hours
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </label>
            </div>

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200">
              <CheckCircle2 size={15} className="mr-2 inline" />
              All {items.length} items start as Pass unless a tracked equipment
              record already needs attention. Mark only what changed.
            </div>

            <div className="space-y-4">
              {categories.map(([category, categoryItems]) => (
                <section
                  key={category}
                  className="rounded-2xl border border-slate-800 bg-slate-950/20 p-3"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-blue-300">
                      {category}
                    </h3>
                    <span className="text-[9px] text-slate-600">
                      {categoryItems.length} check
                      {categoryItems.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="grid gap-2 lg:grid-cols-2">
                    {categoryItems.map((item) => (
                      <div
                        key={item.id}
                        className={`rounded-xl border p-3 ${
                          item.condition === "Pass"
                            ? "border-slate-800 bg-slate-950/40"
                            : item.condition === "Critical"
                              ? "border-red-700 bg-red-950/20"
                              : "border-amber-700 bg-amber-950/20"
                        }`}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <span className="text-sm font-semibold text-slate-200">
                              {item.equipmentId ? (
                                <PackageCheck
                                  size={14}
                                  className="mr-2 inline text-blue-300"
                                />
                              ) : null}
                              {item.label}
                            </span>

                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {item.required ? (
                                <span className="rounded-full border border-blue-500/30 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-blue-300">
                                  Required
                                </span>
                              ) : (
                                <span className="rounded-full border border-slate-700 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-slate-500">
                                  Optional
                                </span>
                              )}

                              {item.critical ? (
                                <span className="rounded-full border border-red-500/30 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-red-300">
                                  Critical
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex gap-1">
                            {(
                              ["Pass", "Defect", "Critical"] as Condition[]
                            ).map((condition) => (
                              <button
                                type="button"
                                key={condition}
                                onClick={() => setCondition(item.id, condition)}
                                className={`rounded-lg border px-2 py-1 text-[9px] font-bold uppercase ${
                                  item.condition === condition
                                    ? condition === "Pass"
                                      ? "border-emerald-500 bg-emerald-500/15 text-emerald-200"
                                      : condition === "Critical"
                                        ? "border-red-500 bg-red-500/15 text-red-200"
                                        : "border-amber-500 bg-amber-500/15 text-amber-200"
                                    : "border-slate-700 text-slate-500"
                                }`}
                              >
                                {condition}
                              </button>
                            ))}
                          </div>
                        </div>

                        {item.equipmentId ? (
                          <p className="mt-1 text-[9px] uppercase tracking-wide text-slate-600">
                            Assigned equipment · Current record:{" "}
                            {item.equipmentStatus}
                          </p>
                        ) : null}

                        {item.critical && item.condition === "Defect" ? (
                          <p className="mt-2 text-[9px] text-red-300">
                            This agency-defined critical item will be treated as
                            a critical defect.
                          </p>
                        ) : null}

                        {item.condition !== "Pass" ? (
                          <input
                            autoFocus
                            placeholder="Brief defect note (required)"
                            value={item.note}
                            onChange={(e) =>
                              setItems((current) =>
                                current.map((entry) =>
                                  entry.id === item.id
                                    ? {
                                        ...entry,
                                        note: e.target.value,
                                      }
                                    : entry,
                                ),
                              )
                            }
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional overall notes"
              className="min-h-20 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p
                className={`text-xs font-semibold ${
                  exceptionCount ? "text-amber-300" : "text-emerald-300"
                }`}
              >
                {exceptionCount
                  ? `${exceptionCount} exception${
                      exceptionCount === 1 ? "" : "s"
                    } will be routed automatically.`
                  : "Ready for one-tap submission."}
              </p>

              <div className="flex gap-2">
                <button
                  onClick={reset}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300"
                >
                  <RotateCcw size={14} />
                  Reset
                </button>

                <button
                  disabled={saving}
                  onClick={() => void submit()}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                  {saving ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : exceptionCount ? (
                    <AlertTriangle size={14} />
                  ) : (
                    <CheckCircle2 size={14} />
                  )}
                  Submit Inspection
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
        <div className="border-b border-slate-800 p-4">
          <h2 className="font-bold text-white">Inspection History</h2>
        </div>

        <div className="divide-y divide-slate-800">
          {allInspections.length ? (
            allInspections.map((item) => (
              <article
                key={item.id}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-white">
                    {item.inspection_type}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {new Date(item.inspected_at).toLocaleString()} ·{" "}
                    {Number(item.mileage || 0).toLocaleString()} mi ·{" "}
                    {Number(item.hours || 0).toLocaleString()} hrs ·{" "}
                    {item.defect_count || 0} defects
                  </p>
                </div>

                <span
                  className={`self-start rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase ${badge(
                    item.result,
                  )}`}
                >
                  {item.result}
                </span>
              </article>
            ))
          ) : (
            <div className="p-10 text-center text-sm text-slate-500">
              No inspections recorded.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
