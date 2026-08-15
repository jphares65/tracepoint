"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ClipboardList,
  Crosshair,
  Loader2,
  Plus,
  Save,
  Search,
  ShieldCheck,
  UserPlus,
  Wrench,
  RotateCcw,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";
import ArmorySectionShell from "@/app/components/ArmorySectionShell";
import FirearmAttachments from "@/app/components/FirearmAttachments";

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
  magazines_issued: number;
  magazine_description?: string | null;
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
  archived_at?: string | null;
  archived_by_user_id?: string | null;
  archive_reason?: string | null;
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

type FirearmType = "handgun" | "rifle" | "shotgun" | "less_lethal" | "other";
type FirearmWorkspaceTab = "custody" | "documents" | "edit" | "status";

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

  return fields.some(
    (field) =>
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

function StatInline({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "emerald" | "sky" | "red";
}) {
  const valueClass = {
    slate: "text-white",
    emerald: "text-emerald-300",
    sky: "text-sky-300",
    red: "text-red-300",
  }[tone];

  return (
    <div className="min-w-[58px] text-center">
      <p className={`text-lg font-black leading-none ${valueClass}`}>{value}</p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</p>
    </div>
  );
}

export default function FirearmsPage() {
  const [firearms, setFirearms] = useState<ArmoryFirearm[]>([]);
  const [members, setMembers] = useState<ArmoryMember[]>([]);
  const [selectedFirearmId, setSelectedFirearmId] = useState<string | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"All" | FirearmStatus>(
    "All",
  );
  const [workspaceTab, setWorkspaceTab] = useState<FirearmWorkspaceTab>("custody");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddFirearm, setShowAddFirearm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newFirearm, setNewFirearm] = useState<NewFirearmForm>(EMPTY_FORM);
  const [assignmentOfficerId, setAssignmentOfficerId] = useState("");
  const [assignmentNotes, setAssignmentNotes] = useState("");
  const [magazinesIssued, setMagazinesIssued] = useState(3);
  const [magazineDescription, setMagazineDescription] = useState("");
  const [magazinesReturned, setMagazinesReturned] = useState(3);
  const [magazineDiscrepancyReason, setMagazineDiscrepancyReason] =
    useState("");
  const [statusDraft, setStatusDraft] = useState<FirearmStatus>("In Service");
  const [statusNotes, setStatusNotes] = useState("");
  const [archiveReason, setArchiveReason] = useState("");

  const [editMake, setEditMake] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editSerialNumber, setEditSerialNumber] = useState("");
  const [editFirearmType, setEditFirearmType] =
    useState<FirearmType>("handgun");
  const [editCaliber, setEditCaliber] = useState("");
  const [editAssetNumber, setEditAssetNumber] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editChangeNote, setEditChangeNote] = useState("");

  const selectedFirearm = useMemo(
    () => firearms.find((firearm) => firearm.id === selectedFirearmId) ?? null,
    [firearms, selectedFirearmId],
  );

  const filteredFirearms = useMemo(() => {
    return sortFirearms(firearms).filter((firearm) => {
      const archiveMatches = showArchived ? !firearm.is_active : firearm.is_active;
      const status = normalizeStatus(firearm.condition_status);
      const statusMatches = statusFilter === "All" || status === statusFilter;

      return archiveMatches && statusMatches && matchesSearch(firearm, query);
    });
  }, [firearms, query, showArchived, statusFilter]);

  const inventoryCounts = useMemo(() => {
    const activeFirearms = firearms.filter((firearm) => firearm.is_active);
    const assigned = activeFirearms.filter(
      (firearm) => firearm.active_assignment,
    ).length;
    const outOfService = activeFirearms.filter((firearm) =>
      ["Out of Service", "Maintenance", "Inspection Required"].includes(
        normalizeStatus(firearm.condition_status),
      ),
    ).length;

    return {
      total: activeFirearms.length,
      assigned,
      available: Math.max(activeFirearms.length - assigned, 0),
      outOfService,
    };
  }, [firearms]);

  async function loadArmory(options?: { preserveSelection?: boolean }) {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/armory/firearms?includeArchived=${showArchived}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const payload = (await response.json()) as ArmoryPayload;
      const loadedFirearms = Array.isArray(payload.firearms) ? payload.firearms : [];
      const viewFirearms = loadedFirearms.filter((firearm) =>
        showArchived ? !firearm.is_active : firearm.is_active,
      );

      setFirearms(loadedFirearms);
      setMembers(Array.isArray(payload.members) ? payload.members : []);

      if (!options?.preserveSelection) {
        setSelectedFirearmId(viewFirearms[0]?.id ?? null);
      } else if (
        selectedFirearmId &&
        !viewFirearms.some((firearm) => firearm.id === selectedFirearmId)
      ) {
        setSelectedFirearmId(viewFirearms[0]?.id ?? null);
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
  }, [showArchived]);

  useEffect(() => {
    if (!selectedFirearm) return;

    setAssignmentOfficerId("");
    setAssignmentNotes("");
    setMagazinesIssued(3);
    setMagazineDescription("");
    setMagazinesReturned(
      selectedFirearm.active_assignment?.magazines_issued ?? 3,
    );
    setMagazineDiscrepancyReason("");
    setStatusDraft(normalizeStatus(selectedFirearm.condition_status));
    setStatusNotes("");
    setArchiveReason("");

    setEditMake(selectedFirearm.make);
    setEditModel(selectedFirearm.model);
    setEditSerialNumber(selectedFirearm.serial_number);
    setEditFirearmType(
      FIREARM_TYPES.some(
        (item) => item.value === selectedFirearm.firearm_type,
      )
        ? (selectedFirearm.firearm_type as FirearmType)
        : "other",
    );
    setEditCaliber(selectedFirearm.caliber ?? "");
    setEditAssetNumber(selectedFirearm.asset_number ?? "");
    setEditNotes(selectedFirearm.notes ?? "");
    setEditChangeNote("");
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

    if (!Number.isInteger(magazinesIssued) || magazinesIssued < 0) {
      setError("Magazines issued must be a whole number of zero or greater.");
      return;
    }

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
            magazinesIssued,
            magazineDescription: magazineDescription.trim() || null,
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
    if (!selectedFirearm?.active_assignment) return;

    const expectedMagazines =
      selectedFirearm.active_assignment.magazines_issued ?? 0;

    if (!Number.isInteger(magazinesReturned) || magazinesReturned < 0) {
      setError("Magazines returned must be a whole number of zero or greater.");
      return;
    }

    if (
      magazinesReturned !== expectedMagazines &&
      !magazineDiscrepancyReason.trim()
    ) {
      setError(
        "A discrepancy reason is required when returned magazines do not match the expected quantity.",
      );
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/armory/firearms/${selectedFirearm.id}/assignments`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            magazinesReturned,
            discrepancyReason:
              magazinesReturned !== expectedMagazines
                ? magazineDiscrepancyReason.trim()
                : null,
          }),
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

  async function handleEditFirearm() {
    if (!selectedFirearm) return;

    if (
      !editMake.trim() ||
      !editModel.trim() ||
      !editSerialNumber.trim()
    ) {
      setError("Make, model, and serial number are required.");
      return;
    }

    if (!editChangeNote.trim()) {
      setError("Enter a reason for the firearm changes.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/armory/firearms/${selectedFirearm.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            make: editMake,
            model: editModel,
            serialNumber: editSerialNumber,
            firearmType: editFirearmType,
            caliber: editCaliber,
            assetNumber: editAssetNumber,
            notes: editNotes,
            changeNote: editChangeNote,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setMessage("Firearm details updated and recorded in the audit log.");
      setEditChangeNote("");

      await loadArmory({ preserveSelection: true });
    } catch (editError) {
      setError(
        editError instanceof Error
          ? editError.message
          : "The firearm could not be updated.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRestoreFirearm() {
    if (!selectedFirearm) return;

    const confirmed = window.confirm(
      `Restore ${getFirearmLabel(selectedFirearm)} (${selectedFirearm.serial_number})?

The firearm will return to active inventory and may again be used in operational workflows.`,
    );

    if (!confirmed) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/armory/firearms/${selectedFirearm.id}/restore`,
        {
          method: "PATCH",
        },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setMessage("Firearm restored to active inventory.");
      setSelectedFirearmId(null);

      await loadArmory();
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "The firearm could not be restored.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveFirearm() {
    if (!selectedFirearm) return;

    const reason = archiveReason.trim();

    if (!reason) {
      setError("Enter a reason before archiving the firearm.");
      return;
    }

    if (selectedFirearm.active_assignment) {
      setError(
        "This firearm is currently assigned. Record its return before archiving it.",
      );
      return;
    }

    const confirmed = window.confirm(
      `Archive ${getFirearmLabel(selectedFirearm)} (${selectedFirearm.serial_number})?

The firearm will be removed from active inventory and future operational selections. Historical records will remain preserved.`,
    );

    if (!confirmed) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/armory/firearms/${selectedFirearm.id}/archive`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            archiveReason: reason,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setArchiveReason("");
      setSelectedFirearmId(null);
      setMessage("Firearm archived. Historical records remain preserved.");

      await loadArmory();
    } catch (archiveError) {
      setError(
        archiveError instanceof Error
          ? archiveError.message
          : "The firearm could not be archived.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <TracePointShell activePage="Armory">
      <div className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-5 lg:p-6">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
          <ArmorySectionShell
            title="Department Firearms"
            description="Inventory, custody, condition, documents, and accountability."
            actions={
              <button
                type="button"
                onClick={() => setShowAddFirearm((current) => !current)}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-slate-200"
              >
                <Plus className="h-4 w-4" />
                {showAddFirearm ? "Close Add Form" : "Add Firearm"}
              </button>
            }
          />

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
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-white">Inventory</h2>
                    <p className="text-sm text-slate-500">
                      Select a firearm to manage custody and condition.
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-1.5">
                    <StatInline label="Inventory" value={inventoryCounts.total} />
                    <span className="h-6 w-px bg-slate-800" />
                    <StatInline label="Assigned" value={inventoryCounts.assigned} tone="emerald" />
                    <span className="h-6 w-px bg-slate-800" />
                    <StatInline label="Available" value={inventoryCounts.available} tone="sky" />
                    <span className="h-6 w-px bg-slate-800" />
                    <StatInline label="Attention" value={inventoryCounts.outOfService} tone="red" />
                  </div>
                </div>

                <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_180px_150px]">
                  <label className="relative min-w-0">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search firearms..."
                      className="w-full min-w-0 rounded-2xl border border-slate-800 bg-slate-900/90 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-slate-500"
                    />
                  </label>

                  <select
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(
                        event.target.value as "All" | FirearmStatus,
                      )
                    }
                    className="w-full min-w-0 rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm font-medium text-slate-200 outline-none transition focus:border-slate-500"
                  >
                    <option value="All">All Statuses</option>
                    {FIREARM_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>

                  <label className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm font-semibold text-slate-300">
                    <input
                      type="checkbox"
                      checked={showArchived}
                      onChange={(event) =>
                        setShowArchived(event.target.checked)
                      }
                      className="h-4 w-4 rounded border-slate-700 bg-slate-950"
                    />
                    Archived Only
                  </label>
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
                                  {firearm.caliber
                                    ? ` | ${firearm.caliber}`
                                    : ""}
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

                      {!selectedFirearm.is_active && (
                        <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-900 p-3">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-300">
                            Archived
                          </p>
                          <p className="mt-1 text-sm text-slate-400">
                            {selectedFirearm.archive_reason ||
                              "No archive reason recorded."}
                          </p>
                          <p className="mt-2 text-xs text-slate-500">
                            Archived{" "}
                            {formatDateTime(selectedFirearm.archived_at)}
                          </p>
                        </div>
                      )}

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

                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-1.5">
                      <div className="grid grid-cols-4 gap-1">
                        {([
                          ["custody", "Custody"],
                          ["documents", "Documents"],
                          ["edit", "Edit"],
                          ["status", "Status"],
                        ] as const).map(([tab, label]) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setWorkspaceTab(tab)}
                            className={`rounded-xl px-2 py-2 text-xs font-bold transition ${
                              workspaceTab === tab
                                ? "bg-blue-600 text-white shadow-sm"
                                : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {workspaceTab === "documents" && (
                      <FirearmAttachments firearmId={selectedFirearm.id} />
                    )}

                    {workspaceTab === "custody" && (
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
                            Assigned{" "}
                            {formatDateTime(
                              selectedFirearm.active_assignment.assigned_at,
                            )}
                          </p>

                          <div className="mt-4 grid gap-3 rounded-2xl border border-emerald-800/70 bg-slate-950/40 p-3 sm:grid-cols-2">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                                Magazines Issued
                              </p>
                              <p className="mt-1 text-lg font-bold text-emerald-100">
                                {selectedFirearm.active_assignment
                                  .magazines_issued ?? 0}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                                Magazine Description
                              </p>
                              <p className="mt-1 text-sm font-semibold text-emerald-100">
                                {selectedFirearm.active_assignment
                                  .magazine_description || "Not recorded"}
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 space-y-3 border-t border-emerald-800/70 pt-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="space-y-1">
                                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                                  Expected Magazines
                                </span>
                                <input
                                  value={
                                    selectedFirearm.active_assignment
                                      .magazines_issued ?? 0
                                  }
                                  readOnly
                                  className="w-full rounded-2xl border border-emerald-800/70 bg-slate-950/70 px-3 py-2 text-sm font-semibold text-emerald-100 outline-none"
                                />
                              </label>
                              <label className="space-y-1">
                                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                                  Magazines Returned
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={magazinesReturned}
                                  onChange={(event) =>
                                    setMagazinesReturned(
                                      Number(event.target.value),
                                    )
                                  }
                                  className="w-full rounded-2xl border border-emerald-800/70 bg-slate-950/70 px-3 py-2 text-sm font-semibold text-emerald-100 outline-none focus:border-emerald-500"
                                />
                              </label>
                            </div>

                            {magazinesReturned !==
                              (selectedFirearm.active_assignment
                                .magazines_issued ?? 0) && (
                              <label className="block space-y-1">
                                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
                                  Discrepancy Reason
                                </span>
                                <textarea
                                  value={magazineDiscrepancyReason}
                                  onChange={(event) =>
                                    setMagazineDiscrepancyReason(
                                      event.target.value,
                                    )
                                  }
                                  rows={3}
                                  placeholder="Explain the missing, additional, retained, damaged, or otherwise discrepant magazines..."
                                  className="w-full rounded-2xl border border-amber-800 bg-amber-950/20 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500"
                                />
                              </label>
                            )}

                            <button
                              type="button"
                              onClick={() => void handleReturnFirearm()}
                              disabled={saving}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {saving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4" />
                              )}
                              Record Return
                            </button>
                          </div>
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
                              <option
                                key={member.user_id}
                                value={member.user_id}
                              >
                                {member.full_name}
                                {member.badge_number
                                  ? ` #${member.badge_number}`
                                  : ""}
                              </option>
                            ))}
                          </select>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                Magazines Issued
                              </span>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={magazinesIssued}
                                onChange={(event) =>
                                  setMagazinesIssued(Number(event.target.value))
                                }
                                className="w-full rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm outline-none focus:border-slate-500"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                Magazine Description
                              </span>
                              <input
                                value={magazineDescription}
                                onChange={(event) =>
                                  setMagazineDescription(event.target.value)
                                }
                                placeholder="Glock OEM 17-round"
                                className="w-full rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm outline-none focus:border-slate-500"
                              />
                            </label>
                          </div>
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
                    )}

                    {workspaceTab === "edit" && (
                    <div className="rounded-3xl border border-slate-800 bg-slate-950/30 p-4">
                      <div className="flex items-center gap-2">
                        <Save className="h-5 w-5 text-slate-400" />
                        <h3 className="font-bold text-white">
                          Edit Firearm Details
                        </h3>
                      </div>

                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        Every saved change requires a reason and is permanently
                        recorded in the immutable audit log.
                      </p>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Make
                          </span>
                          <input
                            value={editMake}
                            onChange={(event) =>
                              setEditMake(event.target.value)
                            }
                            className="w-full rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm outline-none focus:border-slate-500"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Model
                          </span>
                          <input
                            value={editModel}
                            onChange={(event) =>
                              setEditModel(event.target.value)
                            }
                            className="w-full rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm outline-none focus:border-slate-500"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Serial Number
                          </span>
                          <input
                            value={editSerialNumber}
                            onChange={(event) =>
                              setEditSerialNumber(event.target.value)
                            }
                            className="w-full rounded-2xl border border-amber-900/70 bg-amber-950/10 px-3 py-2 text-sm outline-none focus:border-amber-500"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Firearm Type
                          </span>
                          <select
                            value={editFirearmType}
                            onChange={(event) =>
                              setEditFirearmType(
                                event.target.value as FirearmType,
                              )
                            }
                            className="w-full rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm outline-none focus:border-slate-500"
                          >
                            {FIREARM_TYPES.map((type) => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Caliber
                          </span>
                          <input
                            value={editCaliber}
                            onChange={(event) =>
                              setEditCaliber(event.target.value)
                            }
                            className="w-full rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm outline-none focus:border-slate-500"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Asset Number
                          </span>
                          <input
                            value={editAssetNumber}
                            onChange={(event) =>
                              setEditAssetNumber(event.target.value)
                            }
                            className="w-full rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm outline-none focus:border-slate-500"
                          />
                        </label>
                      </div>

                      <label className="mt-3 block space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Firearm Notes
                        </span>
                        <textarea
                          value={editNotes}
                          onChange={(event) =>
                            setEditNotes(event.target.value)
                          }
                          rows={3}
                          className="w-full rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm outline-none focus:border-slate-500"
                        />
                      </label>

                      <label className="mt-3 block space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
                          Reason for Change
                        </span>
                        <textarea
                          value={editChangeNote}
                          onChange={(event) =>
                            setEditChangeNote(event.target.value)
                          }
                          rows={3}
                          placeholder="Explain why these firearm details are being corrected or updated..."
                          className="w-full rounded-2xl border border-blue-900/70 bg-blue-950/20 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => void handleEditFirearm()}
                        disabled={saving || !editChangeNote.trim()}
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {saving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        Save Firearm Changes
                      </button>
                    </div>
                    )}

                    {workspaceTab === "status" && (
                      <div className="flex flex-col gap-5">
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
                          onChange={(event) =>
                            setStatusNotes(event.target.value)
                          }
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

                    {!selectedFirearm.is_active ? (
                      <div className="rounded-3xl border border-blue-900/70 bg-blue-950/20 p-4">
                        <div className="flex items-center gap-2">
                          <RotateCcw className="h-5 w-5 text-blue-400" />
                          <h3 className="font-bold text-white">
                            Restore Firearm
                          </h3>
                        </div>

                        <p className="mt-2 text-sm leading-6 text-slate-400">
                          Return this firearm to active inventory. Its prior
                          archive information and historical records remain part
                          of the system history.
                        </p>

                        <button
                          type="button"
                          onClick={() => void handleRestoreFirearm()}
                          disabled={saving}
                          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {saving ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="h-4 w-4" />
                          )}
                          Restore Firearm
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-red-900/70 bg-red-950/20 p-4">
                        <div className="flex items-center gap-2">
                          <Archive className="h-5 w-5 text-red-400" />
                          <h3 className="font-bold text-white">
                            Archive Firearm
                          </h3>
                        </div>

                        <p className="mt-2 text-sm leading-6 text-slate-400">
                          Remove this firearm from active inventory and future
                          operational selections while preserving its assignments,
                          qualifications, inspections, maintenance, and other
                          historical records.
                        </p>

                        {selectedFirearm.active_assignment ? (
                          <div className="mt-4 rounded-2xl border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">
                            This firearm is currently assigned to{" "}
                            <span className="font-bold">
                              {selectedFirearm.active_assignment.assigned_to_name}
                            </span>
                            . Record its return before archiving it.
                          </div>
                        ) : (
                          <div className="mt-4 flex flex-col gap-3">
                            <label className="space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-red-300">
                                Archive Reason
                              </span>
                              <textarea
                                value={archiveReason}
                                onChange={(event) =>
                                  setArchiveReason(event.target.value)
                                }
                                rows={3}
                                placeholder="Example: Replaced during department-wide transition to new duty firearms."
                                className="w-full rounded-2xl border border-red-900/70 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-red-500"
                              />
                            </label>

                            <button
                              type="button"
                              onClick={() => void handleArchiveFirearm()}
                              disabled={saving || !archiveReason.trim()}
                              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {saving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Archive className="h-4 w-4" />
                              )}
                              Archive Firearm
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {showAddFirearm && (
              <div className="rounded-[2rem] border border-slate-700 bg-slate-900/90 p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Plus className="h-5 w-5 text-slate-400" />
                    <div>
                      <h2 className="text-lg font-bold text-white">Add Firearm</h2>
                      <p className="text-xs text-slate-500">Create a new department-owned firearm record.</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setShowAddFirearm(false)} className="rounded-xl border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800">Close</button>
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
                  <div className="mt-4 flex gap-2 rounded-2xl border border-emerald-800 bg-emerald-950/40 p-3 text-xs font-medium text-emerald-300">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                    Armory inventory is loading from Supabase.
                  </div>
                )}
              </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </TracePointShell>
  );
}








