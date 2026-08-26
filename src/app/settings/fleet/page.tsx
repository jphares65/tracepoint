"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Save, Settings2 } from "lucide-react";
import TracePointShell from "@/app/components/TracePointShell";

const DEFAULTS: any = {
  status_automation_enabled: true,
  due_soon_days: 30,
  default_service_miles: "",
  default_service_hours: "",
  default_service_days: "",
  inspection_warning_days: 30,
  warranty_warning_days: 60,
  registration_warning_days: 30,
  critical_issue_out_of_service: true,
  critical_equipment_out_of_service: true,
  require_return_to_service_approval: true,
  notify_by_email: true,
  escalation_hours: 24,
  fleet_manager_role_codes: ["fleet_manager"],
  mechanic_role_codes: ["mechanic", "fleet_mechanic"],
  inspection_frequency_days: 1,
  inspection_types: ["Pre-Shift", "Post-Shift", "Weekly"],
  inspection_role_codes: [],
  inspection_checklist: [
    { id: "body", label: "Body, windshield and mirrors" },
    { id: "tires", label: "Tires and wheels" },
    { id: "lights", label: "Lights, signals and siren" },
    { id: "controls", label: "Brakes, steering and controls" },
    { id: "fluids", label: "Fluids and visible leaks" },
    { id: "interior", label: "Seatbelts and interior condition" },
  ],
  inspection_include_required_equipment: true,
  inspection_defect_creates_work_order: true,
  inspection_critical_out_of_service: true,
  notify_mechanic_on_issue_report: true,
  notify_mechanic_on_inspection_defect: true,
  notify_fleet_manager_on_status_change: true,
};

function Toggle({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <span>
        <span className="block text-sm font-semibold text-white">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">
          {detail}
        </span>
      </span>
      <input
        type="checkbox"
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-5 w-5 accent-blue-600"
      />
    </label>
  );
}

export default function FleetRulesPage() {
  const [rules, setRules] = useState<any>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/fleet/rules", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        setRules({ ...DEFAULTS, ...payload.rules });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/fleet/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rules),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setRules(payload.rules);
      setMessage("Fleet rules saved and recorded in the audit log.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Fleet rules could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }
  const input =
    "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500";
  return (
    <TracePointShell activePage="Settings">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
          <Link
            href="/settings?tab=rules"
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white"
          >
            <ArrowLeft size={14} />
            Settings & Rules
          </Link>
          <div className="mt-4 flex items-center gap-3">
            <Settings2 className="text-blue-300" />
            <div>
              <h1 className="text-2xl font-bold text-white">
                Fleet Readiness Rules
              </h1>
              <p className="mt-1 text-xs text-slate-400">
                Configure status automation, maintenance intervals, warnings,
                notifications, escalation, and responsible agency roles.
              </p>
            </div>
          </div>
        </header>
        {error ? (
          <div className="rounded-xl border border-red-700 bg-red-950/30 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="rounded-xl border border-emerald-700 bg-emerald-950/30 p-4 text-sm text-emerald-200">
            {message}
          </div>
        ) : null}
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <RefreshCw className="animate-spin text-blue-300" />
          </div>
        ) : (
          <>
            <section className="grid gap-3">
              <Toggle
                label="Automatic vehicle status"
                detail="Evaluate open work, critical issues, and critical missing equipment after every change."
                value={rules.status_automation_enabled}
                onChange={(v) =>
                  setRules({ ...rules, status_automation_enabled: v })
                }
              />
              <Toggle
                label="Critical issues remove vehicles from service"
                detail="Critical defects and availability-affecting work automatically produce Out of Service status."
                value={rules.critical_issue_out_of_service}
                onChange={(v) =>
                  setRules({ ...rules, critical_issue_out_of_service: v })
                }
              />
              <Toggle
                label="Critical missing equipment removes vehicles from service"
                detail="Required safety equipment marked Missing or Out of Service affects vehicle availability."
                value={rules.critical_equipment_out_of_service}
                onChange={(v) =>
                  setRules({ ...rules, critical_equipment_out_of_service: v })
                }
              />
              <Toggle
                label="Add each vehicle's required equipment to inspections"
                detail="Show the actual assigned equipment and serial number instead of one broad equipment checkbox."
                value={rules.inspection_include_required_equipment}
                onChange={(v) =>
                  setRules({
                    ...rules,
                    inspection_include_required_equipment: v,
                  })
                }
              />
              <Toggle
                label="Inspection defects create work orders"
                detail="Route inspection exceptions directly to the configured mechanic role."
                value={rules.inspection_defect_creates_work_order}
                onChange={(v) =>
                  setRules({
                    ...rules,
                    inspection_defect_creates_work_order: v,
                  })
                }
              />
              <Toggle
                label="Critical inspection defects remove vehicles from service"
                detail="A critical inspection exception immediately affects vehicle readiness."
                value={rules.inspection_critical_out_of_service}
                onChange={(v) =>
                  setRules({ ...rules, inspection_critical_out_of_service: v })
                }
              />
              <Toggle
                label="Notify mechanics about officer issue reports"
                detail="Create mechanic Inbox items for new vehicle issues."
                value={rules.notify_mechanic_on_issue_report}
                onChange={(v) =>
                  setRules({ ...rules, notify_mechanic_on_issue_report: v })
                }
              />
              <Toggle
                label="Notify mechanics about inspection defects"
                detail="Create mechanic Inbox items when an inspection has an exception."
                value={rules.notify_mechanic_on_inspection_defect}
                onChange={(v) =>
                  setRules({
                    ...rules,
                    notify_mechanic_on_inspection_defect: v,
                  })
                }
              />
              <Toggle
                label="Notify Fleet Managers about vehicle status"
                detail="Show Attention, Maintenance, and Out of Service status changes in the unified Inbox until resolved."
                value={rules.notify_fleet_manager_on_status_change}
                onChange={(v) =>
                  setRules({
                    ...rules,
                    notify_fleet_manager_on_status_change: v,
                  })
                }
              />
              <Toggle
                label="Require Return-to-Service approval"
                detail="Completed repairs remain controlled until an authorized fleet manager approves operational return."
                value={rules.require_return_to_service_approval}
                onChange={(v) =>
                  setRules({ ...rules, require_return_to_service_approval: v })
                }
              />
              <Toggle
                label="Fleet email notifications"
                detail="Allow critical Fleet Inbox items to follow the department's email-notification policy."
                value={rules.notify_by_email}
                onChange={(v) => setRules({ ...rules, notify_by_email: v })}
              />
            </section>
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h2 className="font-bold text-white">Intervals and warnings</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ["Due-soon warning days", "due_soon_days"],
                  ["Default service miles", "default_service_miles"],
                  ["Default service hours", "default_service_hours"],
                  ["Default service days", "default_service_days"],
                  ["Inspection warning days", "inspection_warning_days"],
                  ["Warranty warning days", "warranty_warning_days"],
                  ["Registration warning days", "registration_warning_days"],
                  ["Escalate unresolved after hours", "escalation_hours"],
                ].map(([label, key]) => (
                  <label key={key}>
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {label}
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={rules[key] ?? ""}
                      onChange={(e) =>
                        setRules({ ...rules, [key]: e.target.value })
                      }
                      className={input}
                    />
                  </label>
                ))}
              </div>
            </section>
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h2 className="font-bold text-white">Responsibility routing</h2>
              <p className="mt-1 text-xs text-slate-500">
                Use the agency's own role codes. Titles are never hard-coded.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Fleet Manager Roles
                  </span>
                  <input
                    value={(rules.fleet_manager_role_codes ?? []).join(", ")}
                    onChange={(e) =>
                      setRules({
                        ...rules,
                        fleet_manager_role_codes: e.target.value
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean),
                      })
                    }
                    className={input}
                  />
                </label>
                <label>
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Mechanic Roles
                  </span>
                  <input
                    value={(rules.mechanic_role_codes ?? []).join(", ")}
                    onChange={(e) =>
                      setRules({
                        ...rules,
                        mechanic_role_codes: e.target.value
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean),
                      })
                    }
                    className={input}
                  />
                </label>
              </div>
            </section>
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h2 className="font-bold text-white">
                Quick inspection configuration
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Configure vehicle-condition checks here. Required equipment
                assigned to each vehicle is appended automatically, so personnel
                verify the specific item while touching only exceptions.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Inspection types
                  </span>
                  <input
                    value={(rules.inspection_types ?? []).join(", ")}
                    onChange={(e) =>
                      setRules({
                        ...rules,
                        inspection_types: e.target.value
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean),
                      })
                    }
                    className={input}
                  />
                </label>
                <label>
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Next inspection due after days
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={rules.inspection_frequency_days ?? 1}
                    onChange={(e) =>
                      setRules({
                        ...rules,
                        inspection_frequency_days: e.target.value,
                      })
                    }
                    className={input}
                  />
                </label>
                <label>
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Permitted inspector role codes
                  </span>
                  <input
                    value={(rules.inspection_role_codes ?? []).join(", ")}
                    onChange={(e) =>
                      setRules({
                        ...rules,
                        inspection_role_codes: e.target.value
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="Blank allows all agency users"
                    className={input}
                  />
                </label>
                <div className="sm:col-span-2">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Inspection Template
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Build the checklist officers will complete during a
                        vehicle inspection. Critical items can be used to
                        identify conditions that may affect vehicle
                        availability.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const current = Array.isArray(
                          rules.inspection_checklist,
                        )
                          ? rules.inspection_checklist
                          : [];

                        setRules({
                          ...rules,
                          inspection_checklist: [
                            ...current,
                            {
                              id: `item-${Date.now()}`,
                              label: "",
                              category: "Vehicle Condition",
                              required: true,
                              critical: false,
                              active: true,
                              sort_order: current.length + 1,
                            },
                          ],
                        });
                      }}
                      className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      + Add Item
                    </button>
                  </div>

                  <div className="space-y-3">
                    {(rules.inspection_checklist ?? []).map(
                      (item: any, index: number) => (
                        <div
                          key={item.id ?? `inspection-item-${index}`}
                          className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                        >
                          <div className="grid gap-3 sm:grid-cols-12">
                            <label className="sm:col-span-5">
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                Inspection Item
                              </span>
                              <input
                                value={item.label ?? ""}
                                placeholder="Example: Emergency lights operational"
                                onChange={(e) => {
                                  const next = [
                                    ...(rules.inspection_checklist ?? []),
                                  ];
                                  next[index] = {
                                    ...next[index],
                                    label: e.target.value,
                                  };
                                  setRules({
                                    ...rules,
                                    inspection_checklist: next,
                                  });
                                }}
                                className={input}
                              />
                            </label>

                            <label className="sm:col-span-4">
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                Category
                              </span>
                              <input
                                value={item.category ?? "Vehicle Condition"}
                                placeholder="Vehicle Condition"
                                onChange={(e) => {
                                  const next = [
                                    ...(rules.inspection_checklist ?? []),
                                  ];
                                  next[index] = {
                                    ...next[index],
                                    category: e.target.value,
                                  };
                                  setRules({
                                    ...rules,
                                    inspection_checklist: next,
                                  });
                                }}
                                className={input}
                              />
                            </label>

                            <label className="sm:col-span-3">
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                Order
                              </span>
                              <input
                                type="number"
                                min="1"
                                value={item.sort_order ?? index + 1}
                                onChange={(e) => {
                                  const next = [
                                    ...(rules.inspection_checklist ?? []),
                                  ];
                                  next[index] = {
                                    ...next[index],
                                    sort_order:
                                      Number(e.target.value) || index + 1,
                                  };
                                  setRules({
                                    ...rules,
                                    inspection_checklist: next,
                                  });
                                }}
                                className={input}
                              />
                            </label>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                            <label className="flex items-center gap-2 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                checked={item.required !== false}
                                onChange={(e) => {
                                  const next = [
                                    ...(rules.inspection_checklist ?? []),
                                  ];
                                  next[index] = {
                                    ...next[index],
                                    required: e.target.checked,
                                  };
                                  setRules({
                                    ...rules,
                                    inspection_checklist: next,
                                  });
                                }}
                              />
                              Required
                            </label>

                            <label className="flex items-center gap-2 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                checked={item.critical === true}
                                onChange={(e) => {
                                  const next = [
                                    ...(rules.inspection_checklist ?? []),
                                  ];
                                  next[index] = {
                                    ...next[index],
                                    critical: e.target.checked,
                                  };
                                  setRules({
                                    ...rules,
                                    inspection_checklist: next,
                                  });
                                }}
                              />
                              Critical item
                            </label>

                            <label className="flex items-center gap-2 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                checked={item.active !== false}
                                onChange={(e) => {
                                  const next = [
                                    ...(rules.inspection_checklist ?? []),
                                  ];
                                  next[index] = {
                                    ...next[index],
                                    active: e.target.checked,
                                  };
                                  setRules({
                                    ...rules,
                                    inspection_checklist: next,
                                  });
                                }}
                              />
                              Active
                            </label>

                            <button
                              type="button"
                              onClick={() => {
                                const next = (
                                  rules.inspection_checklist ?? []
                                ).filter(
                                  (_: any, itemIndex: number) =>
                                    itemIndex !== index,
                                );

                                setRules({
                                  ...rules,
                                  inspection_checklist: next.map(
                                    (entry: any, itemIndex: number) => ({
                                      ...entry,
                                      sort_order: itemIndex + 1,
                                    }),
                                  ),
                                });
                              }}
                              className="ml-auto text-xs font-semibold text-rose-600 hover:text-rose-700"
                            >
                              Remove
                            </button>
                          </div>

                          {item.critical === true && (
                            <p className="mt-2 text-xs text-amber-700">
                              Critical identifies an item capable of affecting
                              vehicle readiness. The inspection result still
                              determines whether an actual critical defect
                              exists.
                            </p>
                          )}
                        </div>
                      ),
                    )}

                    {!(rules.inspection_checklist ?? []).length && (
                      <div className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
                        No inspection items configured. Add an item to build the
                        agency template.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
            <div className="flex justify-end">
              <button
                onClick={() => void save()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {saving ? (
                  <RefreshCw size={15} className="animate-spin" />
                ) : (
                  <Save size={15} />
                )}
                Save Fleet Rules
              </button>
            </div>
          </>
        )}
      </div>
    </TracePointShell>
  );
}
