"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

type CertificationType = {
  id: string;
  name: string;
  category?: string | null;
  default_valid_days?: number | null;
  default_due_soon_days?: number | null;
  is_active?: boolean;
};

type Requirement = {
  certification_type_id: string;
  is_required?: boolean;
  valid_days?: number | null;
  due_soon_days?: number | null;
  is_active?: boolean;
  notes?: string | null;
};

type Capability = {
  capability_code: string;
  certification_type_id: string;
  is_active: boolean;
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

export default function CertificationRulesPanel() {
  const [types, setTypes] =
    useState<CertificationType[]>([]);

  const [requirements, setRequirements] =
    useState<Requirement[]>([]);

  const [capabilities, setCapabilities] =
    useState<Capability[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] =
    useState<string | null>(null);

  const [message, setMessage] =
    useState<string | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const [typeData, requirementData, capabilityData] =
        await Promise.all([
          requestJson<{ items?: CertificationType[] }>(
            "/api/training/certification-types",
          ),
          requestJson<{ items?: Requirement[] }>(
            "/api/training/certification-requirements",
          ),
          requestJson<{ items?: Capability[] }>(
            "/api/settings/certification-capabilities",
          ),
        ]);

      setTypes(typeData.items ?? []);
      setRequirements(requirementData.items ?? []);
      setCapabilities(capabilityData.items ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Certification rules could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const requirementMap = useMemo(
    () =>
      new Map(
        requirements.map((requirement) => [
          requirement.certification_type_id,
          requirement,
        ]),
      ),
    [requirements],
  );

  const inspectionCapability =
    capabilities.find(
      (capability) =>
        capability.capability_code ===
          "perform_firearm_inspections" &&
        capability.is_active !== false,
    );

  async function saveRequirement(
    type: CertificationType,
  ) {
    const requirement = requirementMap.get(type.id);

    setSaving(`requirement-${type.id}`);
    setMessage(null);
    setError(null);

    try {
      await requestJson(
        "/api/training/certification-requirements",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            certificationTypeId: type.id,
            isRequired:
              requirement?.is_required ?? true,
            validDays:
              requirement?.valid_days ??
              type.default_valid_days ??
              null,
            dueSoonDays:
              requirement?.due_soon_days ??
              type.default_due_soon_days ??
              30,
            isActive:
              requirement?.is_active ?? true,
            notes: requirement?.notes ?? null,
          }),
        },
      );

      setMessage(`${type.name} requirement saved.`);
      await load();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Requirement could not be saved.",
      );
    } finally {
      setSaving(null);
    }
  }

  function patchRequirement(
    typeId: string,
    patch: Partial<Requirement>,
  ) {
    setRequirements((current) => {
      const existing = current.find(
        (item) =>
          item.certification_type_id === typeId,
      );

      const rest = current.filter(
        (item) =>
          item.certification_type_id !== typeId,
      );

      return [
        ...rest,
        {
          certification_type_id: typeId,
          ...existing,
          ...patch,
        },
      ];
    });
  }

  async function saveCapability(
    certificationTypeId: string,
  ) {
    setSaving("inspection-capability");
    setMessage(null);
    setError(null);

    try {
      await requestJson(
        "/api/settings/certification-capabilities",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            capabilityCode:
              "perform_firearm_inspections",
            certificationTypeId:
              certificationTypeId || null,
          }),
        },
      );

      setMessage(
        certificationTypeId
          ? "Firearm inspection eligibility rule saved."
          : "Firearm inspection certification gate disabled.",
      );

      await load();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Capability rule could not be saved.",
      );
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="py-10 text-sm text-slate-400">
        Loading certification rules…
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
          Operational Eligibility
        </div>

        <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
          Permissions authorize a user to perform a function.
          Certification rules determine whether that user is
          currently qualified to exercise that permission.
        </p>

        <label className="mt-5 block max-w-xl">
          <span className="text-xs font-semibold text-slate-300">
            Certification required to perform firearm inspections
          </span>

          <select
            value={
              inspectionCapability?.certification_type_id ??
              ""
            }
            disabled={
              saving === "inspection-capability"
            }
            onChange={(event) =>
              void saveCapability(event.target.value)
            }
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
          >
            <option value="">
              No certification requirement
            </option>

            {types
              .filter(
                (type) => type.is_active !== false,
              )
              .map((type) => (
                <option
                  key={type.id}
                  value={type.id}
                >
                  {type.name}
                </option>
              ))}
          </select>

          <p className="mt-2 text-xs leading-5 text-slate-500">
            Current and due-soon credentials remain eligible.
            Missing or expired credentials suspend inspection
            eligibility. Existing permissions are still required.
          </p>
        </label>
      </div>

      <div>
        <div className="mb-3">
          <div className="text-sm font-semibold text-white">
            Agency Certification Requirements
          </div>

          <p className="mt-1 text-xs text-slate-500">
            Configure which certifications affect readiness and
            their agency-specific validity and warning periods.
          </p>
        </div>

        <div className="space-y-3">
          {types.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">
              No certification types configured.
            </div>
          ) : (
            types.map((type) => {
              const requirement =
                requirementMap.get(type.id);

              return (
                <div
                  key={type.id}
                  className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {type.name}
                      </div>

                      <div className="mt-1 text-xs text-slate-500">
                        {type.category || "General"}
                      </div>
                    </div>

                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                      <input
                        type="checkbox"
                        checked={
                          requirement?.is_required ??
                          false
                        }
                        onChange={(event) =>
                          patchRequirement(
                            type.id,
                            {
                              is_required:
                                event.target.checked,
                              is_active: true,
                            },
                          )
                        }
                      />
                      Required
                    </label>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-slate-400">
                      Validity days
                      <input
                        type="number"
                        min={1}
                        value={
                          requirement?.valid_days ??
                          type.default_valid_days ??
                          ""
                        }
                        onChange={(event) =>
                          patchRequirement(
                            type.id,
                            {
                              valid_days:
                                event.target.value
                                  ? Number(
                                      event.target.value,
                                    )
                                  : null,
                            },
                          )
                        }
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                      />
                    </label>

                    <label className="text-xs text-slate-400">
                      Due-soon warning days
                      <input
                        type="number"
                        min={0}
                        value={
                          requirement?.due_soon_days ??
                          type.default_due_soon_days ??
                          30
                        }
                        onChange={(event) =>
                          patchRequirement(
                            type.id,
                            {
                              due_soon_days:
                                event.target.value
                                  ? Number(
                                      event.target.value,
                                    )
                                  : 0,
                            },
                          )
                        }
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    disabled={
                      saving ===
                      `requirement-${type.id}`
                    }
                    onClick={() =>
                      void saveRequirement(type)
                    }
                    className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    Save Requirement
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}