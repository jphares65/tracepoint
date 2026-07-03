"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Crosshair,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  UserPlus,
  Wrench,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";

type ArmoryMember = {
  user_id: string;
  full_name: string;
  email: string;
  rank_title?: string | null;
  badge_number?: string | null;
};

type ActiveAssignment = {
  id: string;
  assigned_to_user_id: string;
  assigned_to_name: string;
  assigned_at: string;
};

type ArmoryFirearm = {
  id: string;
  department_id: string;
  make: string;
  model: string;
  serial_number: string;
  firearm_type: string;
  caliber?: string | null;
  asset_number?: string | null;
  condition_status?: FirearmStatus | string | null;
  notes?: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  active_assignment?: ActiveAssignment | null;
};

type ArmoryPayload = {
  departmentId: string;
  firearms: ArmoryFirearm[];
  members: ArmoryMember[];
};

type FirearmStatus =
  | "In Service"
  | "Out of Service"
  | "Maintenance"
  | "Inspection Required"
  | "Retired";

type FirearmType =
  | "handgun"
  | "rifle"
  | "shotgun"
  | "less_lethal"
  | "other";

type NewFirearmForm = {
  make: string;
  model: string;
  serialNumber: string;
  firearmType: FirearmType;
  caliber: string;
  assetNumber: string;
  conditionStatus: FirearmStatus;
  notes: string;
};

const FIREARM_STATUSES: FirearmStatus[] = [
  "In Service",
  "Out of Service",
  "Maintenance",
  "Inspection Required",
  "Retired",
];

const FIREARM_TYPES: { value: FirearmType; label: string }[] = [
  { value: "handgun", label: "Handgun" },
  { value: "rifle", label: "Rifle" },
  { value: "shotgun", label: "Shotgun" },
  { value: "less_lethal", label: "Less Lethal" },
  { value: "other", label: "Other" },
];

const EMPTY_FORM: NewFirearmForm = {
  make: "",
  model: "",
  serialNumber: "",
  firearmType: "handgun",
  caliber: "",
  assetNumber: "",
  conditionStatus: "In Service",
  notes: "",
};

const STATUS_CLASS: Record<FirearmStatus, string> = {
  "In Service": "border-emerald-800 bg-emerald-950/40 text-emerald-300",
  "Out of Service": "border-red-800 bg-red-950/40 text-red-300",
  Maintenance: "border-amber-800 bg-amber-950/40 text-amber-700",
  "Inspection Required": "border-orange-800 bg-orange-950/40 text-orange-300",
  Retired: "border-slate-200 bg-slate-800/80 text-slate-600",
};

function normalizeStatus(status?: string | null): FirearmStatus {
  if (FIREARM_STATUSES.includes(status as FirearmStatus)) {
    return status as FirearmStatus;
  }

  return "In Service";
}

function formatFirearmType(type?: string | null) {
  const match = FIREARM_TYPES.find((item) => item.value === type);

  return match?.label ?? "Other";
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not recorded";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Not recorded";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getFirearmLabel(firearm: ArmoryFirearm) {
  return `${firearm.make} ${firearm.model}`.trim();
}

function sortFirearms(firearms: ArmoryFirearm[]) {
  return [...firearms].sort((left, right) => {
    const leftAssigned = Boolean(left.active_assignment);
    const rightAssigned = Boolean(right.active_assignment);

    if (leftAssigned !== rightAssigned) return leftAssigned ? -1 : 1;

    return getFirearmLabel(left).localeCompare(getFirearmLabel(right));
  });
}

function matchesSearch(firearm: ArmoryFirearm, query: string) {
  if (!query.trim()) return true;

  const normalized = query.toLowerCase();
  const fields = [
    firearm.make,
    firearm.model,
    firearm.serial_number,
    firearm.asset_number,
    firearm.caliber,
    firearm.firearm_type,
    firearm.condition_status,
    firearm.active_assignment?.assigned_to_name,
  ];

  return fields.some((field) =>
    typeof field === "string" && field.toLowerCase().includes(normalized),
  );
}

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? "The Armory request failed.";
  } catch {
    return "The Armory request failed.";
  }
}

export default function FirearmsPage() {
  const [firearms, setFirearms] = useState<ArmoryFirearm[]>([]);
  const [members, setMembers] = useState<ArmoryMember[]>([]);
  const [selectedFirearmId, setSelectedFirearmId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | FirearmStatus>("All");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newFirearm, setNewFirearm] = useState<NewFirearmForm>(EMPTY_FORM);
  const [assignmentOfficerId, setAssignmentOfficerId] = useState("");
  const [assignmentNotes, setAssignmentNotes] = useState("");
  const [statusDraft, setStatusDraft] = useState<FirearmStatus>("In Service");
  const [statusNotes, setStatusNotes] = useState("");

  const selectedFirearm = useMemo(
    () => firearms.find((firearm) => firearm.id === selectedFirearmId) ?? null,
    [firearms, selectedFirearmId],
  );

  const filteredFirearms = useMemo(() => {
    return sortFirearms(firearms).filter((firearm) => {
      const status = normalizeStatus(firearm.condition_status);
      const statusMatches = statusFilter === "All" || status === statusFilter;

      return statusMatches && matchesSearch(firearm, query);
    });
  }, [firearms, query, statusFilter]);

  const inventoryCounts = useMemo(() => {
    const assigned = firearms.filter((firearm) => firearm.active_assignment).length;
    const outOfService = firearms.filter((firearm) =>
      ["Out of Service", "Maintenance", "Inspection Required"].includes(
        normalizeStatus(firearm.condition_status),
      ),
    ).length;

    return {
      total: firearms.length,
      assigned,
      available: Math.max(firearms.length - assigned, 0),
      outOfService,
    };
  }, [firearms]);

  async function loadArmory(options?: { preserveSelection?: boolean }) {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/armory/firearms", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const payload = (await response.json()) as ArmoryPayload;

      setFirearms(Array.isArray(payload.firearms) ? payload.firearms : []);
      setMembers(Array.isArray(payload.members) ? payload.members : []);

      if (!options?.preserveSelection) {
        const firstFirearm = payload.firearms?.[0];
        setSelectedFirearmId(firstFirearm?.id ?? null);
      } else if (
        selectedFirearmId &&
        !payload.firearms?.some((firearm) => firearm.id === selectedFirearmId)
      ) {
        setSelectedFirearmId(payload.firearms?.[0]?.id ?? null);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "The Armory inventory could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadArmory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedFirearm) return;

    setAssignmentOfficerId("");
    setAssignmentNotes("");
    setStatusDraft(normalizeStatus(selectedFirearm.condition_status));
    setStatusNotes("");
  }, [selectedFirearm]);

  async function handleAddFirearm() {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/armory/firearms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newFirearm),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const payload = (await response.json()) as { firearmId?: string };

      setMessage("Firearm added to Armory.");
      setNewFirearm(EMPTY_FORM);

      await loadArmory({ preserveSelection: true });

      if (payload.firearmId) {
        setSelectedFirearmId(payload.firearmId);
      }
    } catch (addError) {
      setError(
        addError instanceof Error
          ? addError.message
          : "The firearm could not be added.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignFirearm() {
    if (!selectedFirearm) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/armory/firearms/${selectedFirearm.id}/assignments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            assignedToUserId: assignmentOfficerId,
            notes: assignmentNotes,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setMessage("Firearm assignment recorded.");
      await loadArmory({ preserveSelection: true });
    } catch (assignError) {
      setError(
        assignError instanceof Error
          ? assignError.message
          : "The firearm could not be assigned.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleReturnFirearm() {
    if (!selectedFirearm) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/armory/firearms/${selectedFirearm.id}/assignments`,
        {
          method: "PATCH",
        },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setMessage("Firearm return recorded.");
      await loadArmory({ preserveSelection: true });
    } catch (returnError) {
      setError(
        returnError instanceof Error
          ? returnError.message
          : "The firearm could not be returned.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateStatus() {
    if (!selectedFirearm) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/armory/firearms/${selectedFirearm.id}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status: statusDraft,
            notes: statusNotes,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setMessage("Firearm status updated.");
      await loadArmory({ preserveSelection: true });
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : "The firearm status could not be updated.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <TracePointShell activePage="Armory">
      <div className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-6 lg:p-8">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
          <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-6 shadow-sm">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                  TracePoint Armory
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">
                  Firearms Inventory
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                  Live Supabase-backed firearm inventory, current custody, and
                  condition status for the pilot workspace.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void loadArmory({ preserveSelection: true })}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/90 px-4 py-2 text-sm font-semibold text-slate-200 shadow-sm transition hover:bg-slate-200/70"
              >
                <RotateCcw className="h-4 w-4" />
                Refresh
              </button>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Inventory
                </p>
                <p className="mt-2 text-3xl font-bold text-white">
                  {inventoryCounts.total}
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-800 bg-emerald-950/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
                  Assigned
                </p>
                <p className="mt-2 text-3xl font-bold text-emerald-200">
                  {inventoryCounts.assigned}
                </p>
              </div>
              <div className="rounded-2xl border border-sky-800 bg-sky-950/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300">
                  Available
                </p>
                <p className="mt-2 text-3xl font-bold text-sky-200">
                  {inventoryCounts.available}
                </p>
              </div>
              <div className="rounded-2xl border border-red-800 bg-red-950/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-300">
                  Needs Attention
                </p>
                <p className="mt-2 text-3xl font-bold text-red-200">
                  {inventoryCounts.outOfService}
                </p>
              </div>
            </div>
          </section>

          {(error || message) && (
            <section
              className={`rounded-2xl border p-4 text-sm font-medium ${
                error
                  ? "border-red-800 bg-red-950/40 text-red-300"
                  : "border-emerald-800 bg-emerald-950/40 text-emerald-300"
              }`}
            >
              {error ?? message}
            </section>
          )}

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(420px,0.9fr)]">
            <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white">
                    Inventory
                  </h2>
                  <p className="text-sm text-slate-500">
                    Select a firearm to manage custody and condition.
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search firearms..."
                      className="w-full rounded-2xl border border-slate-800 bg-slate-900/90 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-slate-500 sm:w-64"
                    />
                  </label>

                  <select
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(event.target.value as "All" | FirearmStatus)
                    }
                    className="rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm font-medium text-slate-200 outline-none transition focus:border-slate-500"
                  >
                    <option value="All">All Statuses</option>
                    {FIREARM_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {loading ? (
                <div className="mt-6 flex items-center justify-center rounded-3xl border border-dashed border-slate-700 p-12 text-slate-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading Armory inventory...
                </div>
              ) : filteredFirearms.length === 0 ? (
                <div className="mt-6 rounded-3xl border border-dashed border-slate-700 p-10 text-center">
                  <Crosshair className="mx-auto h-10 w-10 text-slate-600" />
                  <h3 className="mt-3 text-lg font-bold text-slate-100">
                    No firearms found
                  </h3>
                  <p className="mt-2 text-sm text-slate-500">
                    Add a firearm below or clear your search/filter.
                  </p>
                </div>
              ) : (
                <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200">
                  <div className="max-h-[620px] overflow-auto">
                    <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
                      <thead className="sticky top-0 bg-slate-950 text-xs uppercase tracking-[0.18em] text-slate-500">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Firearm</th>
                          <th className="px-4 py-3 font-semibold">Serial</th>
                          <th className="px-4 py-3 font-semibold">Status</th>
                          <th className="px-4 py-3 font-semibold">Custody</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 bg-slate-900">
                        {filteredFirearms.map((firearm) => {
                          const status = normalizeStatus(
                            firearm.condition_status,
                          );
                          const selected = firearm.id === selectedFirearmId;

                          return (
                            <tr
                              key={firearm.id}
                              onClick={() => setSelectedFirearmId(firearm.id)}
                              className={`cursor-pointer transition hover:bg-slate-200/70 ${
                                selected ? "bg-slate-800/80" : ""
                              }`}
                            >
                              <td className="px-4 py-4">
                                <p className="font-bold text-white">
                                  {getFirearmLabel(firearm)}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {formatFirearmType(firearm.firearm_type)}
                                  {firearm.caliber ? ` • ${firearm.caliber}` : ""}
                                </p>
                              </td>
                              <td className="px-4 py-4 font-mono text-xs text-slate-600">
                                {firearm.serial_number}
                              </td>
                              <td className="px-4 py-4">
                                <span
                                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_CLASS[status]}`}
                                >
                                  {status}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-sm text-slate-600">
                                {firearm.active_assignment ? (
                                  <span className="font-semibold text-slate-100">
                                    {firearm.active_assignment.assigned_to_name}
                                  </span>
                                ) : (
                                  <span className="text-slate-500">
                                    Unassigned
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-6">
              <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-white">
                      Selected Firearm
                    </h2>
                    <p className="text-sm text-slate-500">
                      Assignment, status, and condition controls.
                    </p>
                  </div>
                  <ShieldCheck className="h-6 w-6 text-slate-500" />
                </div>

                {!selectedFirearm ? (
                  <div className="mt-5 rounded-3xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
                    Select a firearm from the inventory table.
                  </div>
                ) : (
                  <div className="mt-5 flex flex-col gap-5">
                    <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4">
                      <p className="text-2xl font-bold text-white">
                        {getFirearmLabel(selectedFirearm)}
                      </p>
                      <p className="mt-1 font-mono text-xs text-slate-500">
                        Serial: {selectedFirearm.serial_number}
                      </p>
                      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Type
                          </p>
                          <p className="font-semibold text-slate-100">
                            {formatFirearmType(selectedFirearm.firearm_type)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Caliber
                          </p>
                          <p className="font-semibold text-slate-100">
                            {selectedFirearm.caliber || "Not recorded"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Asset
                          </p>
                          <p className="font-semibold text-slate-100">
                            {selectedFirearm.asset_number || "Not recorded"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Updated
                          </p>
                          <p className="font-semibold text-slate-100">
                            {formatDateTime(selectedFirearm.updated_at)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 p-4">
                      <div className="flex items-center gap-2">
                        <ClipboardList className="h-5 w-5 text-slate-500" />
                        <h3 className="font-bold text-white">
                          Current Custody
                        </h3>
                      </div>

                      {selectedFirearm.active_assignment ? (
                        <div className="mt-4 rounded-2xl border border-emerald-800 bg-emerald-950/40 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                            Assigned To
                          </p>
                          <p className="mt-1 text-lg font-bold text-emerald-100">
                            {selectedFirearm.active_assignment.assigned_to_name}
                          </p>
                          <p className="mt-1 text-xs text-emerald-300">
                            Assigned {formatDateTime(selectedFirearm.active_assignment.assigned_at)}
                          </p>
                          <button
                            type="button"
                            onClick={() => void handleReturnFirearm()}
                            disabled={saving}
                            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-950/400 px-4 py-2 text-sm font-bold text-emerald-100 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {saving ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                            Record Return
                          </button>
                        </div>
                      ) : (
                        <div className="mt-4 flex flex-col gap-3">
                          <select
                            value={assignmentOfficerId}
                            onChange={(event) =>
                              setAssignmentOfficerId(event.target.value)
                            }
                            className="rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm outline-none focus:border-slate-500"
                          >
                            <option value="">Select officer...</option>
                            {members.map((member) => (
                              <option key={member.user_id} value={member.user_id}>
                                {member.full_name}
                                {member.badge_number
                                  ? ` #${member.badge_number}`
                                  : ""}
                              </option>
                            ))}
                          </select>
                          <textarea
                            value={assignmentNotes}
                            onChange={(event) =>
                              setAssignmentNotes(event.target.value)
                            }
                            rows={3}
                            placeholder="Issue notes..."
                            className="rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm outline-none focus:border-slate-500"
                          />
                          <button
                            type="button"
                            onClick={() => void handleAssignFirearm()}
                            disabled={saving || !assignmentOfficerId}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {saving ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <UserPlus className="h-4 w-4" />
                            )}
                            Assign Firearm
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="rounded-3xl border border-slate-200 p-4">
                      <div className="flex items-center gap-2">
                        <Wrench className="h-5 w-5 text-slate-500" />
                        <h3 className="font-bold text-white">
                          Condition Status
                        </h3>
                      </div>

                      <div className="mt-4 flex flex-col gap-3">
                        <select
                          value={statusDraft}
                          onChange={(event) =>
                            setStatusDraft(event.target.value as FirearmStatus)
                          }
                          className="rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm outline-none focus:border-slate-500"
                        >
                          {FIREARM_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                        <textarea
                          value={statusNotes}
                          onChange={(event) => setStatusNotes(event.target.value)}
                          rows={3}
                          placeholder="Status/change notes..."
                          className="rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm outline-none focus:border-slate-500"
                        />
                        <button
                          type="button"
                          onClick={() => void handleUpdateStatus()}
                          disabled={
                            saving ||
                            statusDraft ===
                              normalizeStatus(selectedFirearm.condition_status)
                          }
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {saving ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                          Save Status
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <Plus className="h-5 w-5 text-slate-500" />
                  <h2 className="text-lg font-bold text-white">
                    Add Firearm
                  </h2>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <input
                    value={newFirearm.make}
                    onChange={(event) =>
                      setNewFirearm((current) => ({
                        ...current,
                        make: event.target.value,
                      }))
                    }
                    placeholder="Make"
                    className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 text-sm outline-none focus:border-slate-500"
                  />
                  <input
                    value={newFirearm.model}
                    onChange={(event) =>
                      setNewFirearm((current) => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                    placeholder="Model"
                    className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 text-sm outline-none focus:border-slate-500"
                  />
                  <input
                    value={newFirearm.serialNumber}
                    onChange={(event) =>
                      setNewFirearm((current) => ({
                        ...current,
                        serialNumber: event.target.value,
                      }))
                    }
                    placeholder="Serial number"
                    className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 text-sm outline-none focus:border-slate-500"
                  />
                  <input
                    value={newFirearm.assetNumber}
                    onChange={(event) =>
                      setNewFirearm((current) => ({
                        ...current,
                        assetNumber: event.target.value,
                      }))
                    }
                    placeholder="Asset number"
                    className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 text-sm outline-none focus:border-slate-500"
                  />
                  <select
                    value={newFirearm.firearmType}
                    onChange={(event) =>
                      setNewFirearm((current) => ({
                        ...current,
                        firearmType: event.target.value as FirearmType,
                      }))
                    }
                    className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 text-sm outline-none focus:border-slate-500"
                  >
                    {FIREARM_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={newFirearm.caliber}
                    onChange={(event) =>
                      setNewFirearm((current) => ({
                        ...current,
                        caliber: event.target.value,
                      }))
                    }
                    placeholder="Caliber"
                    className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 text-sm outline-none focus:border-slate-500"
                  />
                  <select
                    value={newFirearm.conditionStatus}
                    onChange={(event) =>
                      setNewFirearm((current) => ({
                        ...current,
                        conditionStatus: event.target.value as FirearmStatus,
                      }))
                    }
                    className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 text-sm outline-none focus:border-slate-500 sm:col-span-2"
                  >
                    {FIREARM_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={newFirearm.notes}
                    onChange={(event) =>
                      setNewFirearm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="Notes"
                    rows={3}
                    className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 text-sm outline-none focus:border-slate-500 sm:col-span-2"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => void handleAddFirearm()}
                  disabled={
                    saving ||
                    !newFirearm.make.trim() ||
                    !newFirearm.model.trim() ||
                    !newFirearm.serialNumber.trim()
                  }
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Add Firearm
                </button>

                {members.length === 0 && !loading && (
                  <div className="mt-4 flex gap-2 rounded-2xl border border-amber-800 bg-amber-950/40 p-3 text-xs font-medium text-amber-200">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    No active department members were returned for assignment.
                  </div>
                )}

                {firearms.length > 0 && (
                  <div className="mt-4 flex gap-2 rounded-2xl border border-emerald-800 bg-emerald-950/40 p-3 text-xs font-medium text-emerald-800">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                    Armory inventory is loading from Supabase.
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </TracePointShell>
  );
}
