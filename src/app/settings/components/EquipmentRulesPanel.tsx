"use client";

import {
  useEffect,
  useState,
} from "react";

type EquipmentType = {
  id: string;
  name: string;
  category?: string | null;
};

type EquipmentRequirement = {
  id?: string;
  equipment_type_id: string;
  scope_type: string;
  scope_value?: string | null;
  required_quantity?: number;
  affects_readiness?: boolean;
  valid_days?: number | null;
  due_soon_days?: number | null;
  inspection_interval_days?: number | null;
  inspection_due_soon_days?: number | null;
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
    await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload?.error ||
        `Request failed (${response.status}).`,
    );
  }

  return payload as T;
}

export default function EquipmentRulesPanel() {
  const [types, setTypes] =
    useState<EquipmentType[]>([]);

  const [requirements, setRequirements] =
    useState<EquipmentRequirement[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] =
    useState<string | null>(null);

  const [message, setMessage] =
    useState<string | null>(null);

  const [form, setForm] = useState({
    equipmentTypeId: "",
    scopeType: "all",
    scopeValue: "",
    requiredQuantity: 1,
    affectsReadiness: true,
    validDays: "",
    dueSoonDays: "30",
    inspectionIntervalDays: "",
    inspectionDueSoonDays: "30",
  });

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const [typePayload, requirementPayload] =
        await Promise.all([
          requestJson<any>("/api/equipment/types"),
          requestJson<any>(
            "/api/equipment/requirements",
          ),
        ]);

      setTypes(
        typePayload.items ??
          typePayload.types ??
          typePayload.equipmentTypes ??
          [],
      );

      setRequirements(
        requirementPayload.items ??
          requirementPayload.requirements ??
          [],
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Equipment rules could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function numberOrNull(value: string) {
    if (!value.trim()) return null;

    const parsed = Number(value);

    return Number.isInteger(parsed)
      ? parsed
      : null;
  }

  async function saveRequirement() {
    if (!form.equipmentTypeId) {
      setError("Select an equipment type.");
      return;
    }

    if (
      form.scopeType !== "all" &&
      !form.scopeValue.trim()
    ) {
      setError(
        "Enter the rank or unit this requirement applies to.",
      );
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      await requestJson(
        "/api/equipment/requirements",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            equipmentTypeId:
              form.equipmentTypeId,
            scopeType: form.scopeType,
            scopeValue:
              form.scopeType === "all"
                ? ""
                : form.scopeValue.trim(),
            requiredQuantity:
              form.requiredQuantity,
            isRequired: true,
            affectsReadiness:
              form.affectsReadiness,
            validDays:
              numberOrNull(form.validDays),
            dueSoonDays:
              numberOrNull(form.dueSoonDays),
            inspectionIntervalDays:
              numberOrNull(
                form.inspectionIntervalDays,
              ),
            inspectionDueSoonDays:
              numberOrNull(
                form.inspectionDueSoonDays,
              ),
            isActive: true,
          }),
        },
      );

      setMessage("Equipment requirement saved.");
      await load();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Equipment requirement could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="py-10 text-sm text-slate-400">
        Loading equipment rules…
      </div>
    );
  }

  return (
    <div className="space-y-6">
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

      <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-5">
        <div className="text-sm font-semibold text-white">
          Add Equipment Requirement
        </div>

        <p className="mt-1 text-xs leading-5 text-slate-500">
          Define required equipment, applicable personnel,
          expiration rules, inspections, and readiness impact.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-slate-400">
            Equipment type
            <select
              value={form.equipmentTypeId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  equipmentTypeId:
                    event.target.value,
                }))
              }
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            >
              <option value="">Select type</option>

              {types.map((type) => (
                <option
                  key={type.id}
                  value={type.id}
                >
                  {type.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-slate-400">
            Applies to
            <select
              value={form.scopeType}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  scopeType:
                    event.target.value,
                  scopeValue: "",
                }))
              }
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            >
              <option value="all">
                All personnel
              </option>
              <option value="rank">
                Rank / title
              </option>
              <option value="unit">
                Unit
              </option>
            </select>
          </label>

          {form.scopeType !== "all" ? (
            <label className="text-xs text-slate-400">
              {form.scopeType === "rank"
                ? "Rank / title"
                : "Unit"}

              <input
                value={form.scopeValue}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    scopeValue:
                      event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
          ) : null}

          <label className="text-xs text-slate-400">
            Required quantity
            <input
              type="number"
              min={1}
              max={100}
              value={form.requiredQuantity}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  requiredQuantity:
                    Math.max(
                      1,
                      Number(event.target.value),
                    ),
                }))
              }
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="text-xs text-slate-400">
            Validity days
            <input
              type="number"
              min={1}
              value={form.validDays}
              placeholder="Optional"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  validDays:
                    event.target.value,
                }))
              }
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="text-xs text-slate-400">
            Expiration warning days
            <input
              type="number"
              min={0}
              value={form.dueSoonDays}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  dueSoonDays:
                    event.target.value,
                }))
              }
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="text-xs text-slate-400">
            Inspection interval days
            <input
              type="number"
              min={1}
              value={
                form.inspectionIntervalDays
              }
              placeholder="Optional"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  inspectionIntervalDays:
                    event.target.value,
                }))
              }
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="text-xs text-slate-400">
            Inspection warning days
            <input
              type="number"
              min={0}
              value={
                form.inspectionDueSoonDays
              }
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  inspectionDueSoonDays:
                    event.target.value,
                }))
              }
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            />
          </label>
        </div>

        <label className="mt-4 flex items-center gap-2 text-xs font-semibold text-slate-300">
          <input
            type="checkbox"
            checked={form.affectsReadiness}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                affectsReadiness:
                  event.target.checked,
              }))
            }
          />

          Missing or non-compliant equipment affects readiness
        </label>

        <button
          type="button"
          disabled={saving}
          onClick={() =>
            void saveRequirement()
          }
          className="mt-5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Save Equipment Requirement
        </button>
      </div>

      <div>
        <div className="text-sm font-semibold text-white">
          Current Equipment Requirements
        </div>

        <div className="mt-3 space-y-2">
          {requirements.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">
              No equipment requirements configured.
            </div>
          ) : (
            requirements.map(
              (requirement, index) => {
                const type = types.find(
                  (item) =>
                    item.id ===
                    requirement.equipment_type_id,
                );

                return (
                  <div
                    key={
                      requirement.id ??
                      `${requirement.equipment_type_id}-${index}`
                    }
                    className="rounded-xl border border-slate-800 bg-slate-950/30 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-200">
                          {type?.name ??
                            "Equipment"}
                        </div>

                        <div className="mt-1 text-xs text-slate-500">
                          {requirement.scope_type ===
                          "all"
                            ? "All personnel"
                            : `${requirement.scope_type}: ${requirement.scope_value ?? ""}`}
                        </div>
                      </div>

                      <div className="text-xs text-slate-400">
                        Qty{" "}
                        {requirement.required_quantity ??
                          1}
                        {" · "}
                        {requirement.affects_readiness !==
                        false
                          ? "Readiness"
                          : "Informational"}
                      </div>
                    </div>
                  </div>
                );
              },
            )
          )}
        </div>
      </div>
    </div>
  );
}