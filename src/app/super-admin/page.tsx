"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Loader2,
  Shield,
  SlidersHorizontal,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";
import { useTracePointAccess } from "@/lib/tracepoint/useTracePointAccess";

type Department = {
  id: string;
  name: string;
  short_name?: string | null;
};

type Feature = {
  code: string;
  display_name: string;
  description?: string | null;
  sort_order: number;
};

type Entitlement = {
  department_id: string;
  feature_code: string;
  is_enabled: boolean;
};

type SuperAdminPayload = {
  departments: Department[];
  features: Feature[];
  entitlements: Entitlement[];
};

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as {
      error?: string;
    };

    return payload.error || "Request failed.";
  } catch {
    return "Request failed.";
  }
}

export default function SuperAdminPage() {
  const access = useTracePointAccess();

  const [payload, setPayload] =
    useState<SuperAdminPayload | null>(null);

  const [departmentId, setDepartmentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingFeature, setSavingFeature] =
    useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/super-admin", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const nextPayload =
        (await response.json()) as SuperAdminPayload;

      setPayload(nextPayload);

      setDepartmentId((current) => {
        if (
          current &&
          nextPayload.departments.some(
            (department) => department.id === current,
          )
        ) {
          return current;
        }

        return nextPayload.departments[0]?.id ?? "";
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Super Admin could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (access.loading) return;

    if (!access.isSuperAdmin) {
      setLoading(false);
      return;
    }

    void load();
  }, [access.loading, access.isSuperAdmin]);

  const entitlementMap = useMemo(() => {
    const map = new Map<string, boolean>();

    for (const entitlement of payload?.entitlements ?? []) {
      map.set(
        `${entitlement.department_id}:${entitlement.feature_code}`,
        entitlement.is_enabled,
      );
    }

    return map;
  }, [payload]);

  const selectedDepartment = useMemo(
    () =>
      payload?.departments.find(
        (department) => department.id === departmentId,
      ) ?? null,
    [payload, departmentId],
  );

  async function setFeatureEnabled(
    featureCode: string,
    isEnabled: boolean,
  ) {
    if (!departmentId) return;

    setSavingFeature(featureCode);
    setError(null);

    try {
      const response = await fetch("/api/super-admin", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          departmentId,
          featureCode,
          isEnabled,
        }),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setPayload((current) => {
        if (!current) return current;

        const exists = current.entitlements.some(
          (row) =>
            row.department_id === departmentId &&
            row.feature_code === featureCode,
        );

        const entitlements = exists
          ? current.entitlements.map((row) =>
              row.department_id === departmentId &&
              row.feature_code === featureCode
                ? {
                    ...row,
                    is_enabled: isEnabled,
                  }
                : row,
            )
          : [
              ...current.entitlements,
              {
                department_id: departmentId,
                feature_code: featureCode,
                is_enabled: isEnabled,
              },
            ];

        return {
          ...current,
          entitlements,
        };
      });

      if (departmentId === access.departmentId) {
        await access.refresh();
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Module access could not be updated.",
      );
    } finally {
      setSavingFeature(null);
    }
  }

  if (access.loading) {
    return (
      <TracePointShell activePage="Super Admin">
        <div className="flex min-h-[420px] items-center justify-center">
          <Loader2
            size={22}
            className="animate-spin text-blue-300"
          />
        </div>
      </TracePointShell>
    );
  }

  if (!access.isSuperAdmin) {
    return (
      <TracePointShell activePage="Super Admin">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-5">
            <h1 className="text-base font-bold text-white">
              Platform Administrator Access Required
            </h1>

            <p className="mt-2 text-sm text-slate-400">
              This area is restricted to TracePoint platform
              administrators.
            </p>
          </div>
        </div>
      </TracePointShell>
    );
  }

  return (
    <TracePointShell activePage="Super Admin">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-blue-500/25 bg-blue-500/10 p-2">
              <Shield
                size={18}
                className="text-blue-300"
              />
            </div>

            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-400">
                TracePoint Platform
              </div>

              <h1 className="mt-1 text-xl font-bold text-white">
                Super Admin
              </h1>

              <p className="mt-1 text-sm text-slate-400">
                Manage agency module access.
              </p>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center gap-2">
            <Building2
              size={16}
              className="text-slate-400"
            />

            <h2 className="text-sm font-semibold text-white">
              Agency
            </h2>
          </div>

          <select
            value={departmentId}
            onChange={(event) =>
              setDepartmentId(event.target.value)
            }
            disabled={loading}
            className="mt-3 w-full max-w-xl rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-blue-500"
          >
            {(payload?.departments ?? []).map(
              (department) => (
                <option
                  key={department.id}
                  value={department.id}
                >
                  {department.name}
                </option>
              ),
            )}
          </select>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
          <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
            <SlidersHorizontal
              size={16}
              className="text-blue-300"
            />

            <div>
              <h2 className="text-sm font-semibold text-white">
                Module Access
              </h2>

              <p className="mt-0.5 text-xs text-slate-500">
                {selectedDepartment?.name ||
                  "Select an agency"}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center">
              <Loader2
                size={22}
                className="animate-spin text-blue-300"
              />
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {(payload?.features ?? []).map(
                (feature) => {
                  const key =
                    `${departmentId}:${feature.code}`;

                  const enabled =
                    entitlementMap.get(key) !== false;

                  const saving =
                    savingFeature === feature.code;

                  return (
                    <div
                      key={feature.code}
                      className="flex items-center justify-between gap-5 px-4 py-4"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-semibold text-white">
                            {feature.display_name}
                          </div>

                          {enabled ? (
                            <CheckCircle2
                              size={14}
                              className="text-emerald-400"
                            />
                          ) : null}
                        </div>

                        {feature.description ? (
                          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
                            {feature.description}
                          </p>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        aria-pressed={enabled}
                        aria-label={`${feature.display_name} ${
                          enabled ? "enabled" : "disabled"
                        }`}
                        disabled={
                          saving ||
                          !departmentId
                        }
                        onClick={() =>
                          void setFeatureEnabled(
                            feature.code,
                            !enabled,
                          )
                        }
                        className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                          enabled
                            ? "bg-blue-600"
                            : "bg-slate-700"
                        } ${
                          saving
                            ? "cursor-wait opacity-60"
                            : ""
                        }`}
                      >
                        <span
                          className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
                            enabled
                              ? "left-6"
                              : "left-1"
                          }`}
                        />
                      </button>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </section>
      </div>
    </TracePointShell>
  );
}
