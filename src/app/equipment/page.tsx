"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Clock3,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
  Wrench,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";

type ReadinessStatus =
  | "current"
  | "due_soon"
  | "expired"
  | "inspection_due_soon"
  | "inspection_overdue"
  | "missing"
  | "out_of_service";

type EquipmentReadinessSummary = {
  totalRequiredChecks: number;
  current: number;
  dueSoon: number;
  expired: number;
  inspectionDueSoon: number;
  inspectionOverdue: number;
  missing: number;
  outOfService: number;
  ready: number;
  notReady: number;
  readinessPercent: number;
};

type EquipmentReadinessRow = {
  userId: string;
  officerName: string;
  badgeNumber?: string | null;
  rankTitle?: string | null;
  unitName?: string | null;

  equipmentTypeId: string;
  equipmentName: string;
  equipmentCategory: string;

  scopeType: "all" | "rank" | "unit" | "officer";
  scopeValue: string;
  affectsReadiness: boolean;

  requiredQuantity: number;
  assignedQuantity: number;
  readyQuantity: number;

  status: ReadinessStatus;
  statusReason: string;

  assets: Array<{
    assetId: string;
    status: ReadinessStatus;
    expirationDate: string | null;
    expirationDaysRemaining: number | null;
    nextInspectionDate: string | null;
    inspectionDaysRemaining: number | null;
    reason: string;
  }>;
};

type ReadinessPayload = {
  scope: "department" | "self";
  summary: EquipmentReadinessSummary;
  rows: EquipmentReadinessRow[];
};

type EquipmentType = {
  id: string;
  name: string;
  category: string;
  description?: string | null;

  expiration_required: boolean;
  default_valid_days?: number | null;
  default_due_soon_days: number;

  inspection_required: boolean;
  default_inspection_interval_days?: number | null;
  default_inspection_due_soon_days: number;

  is_active: boolean;
};

type EquipmentRequirement = {
  id: string;
  equipment_type_id: string;
  is_required: boolean;
  required_quantity: number;

  scope_type: "all" | "rank" | "unit" | "officer";
  scope_value: string;
  affects_readiness: boolean;

  valid_days?: number | null;
  due_soon_days?: number | null;

  inspection_interval_days?: number | null;
  inspection_due_soon_days?: number | null;

  is_active: boolean;
  notes?: string | null;
};

type EquipmentAsset = {
  id: string;
  equipment_type_id: string;

  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  asset_number?: string | null;
  lot_number?: string | null;

  assigned_user_id?: string | null;
  assigned_vehicle_id?: string | null;
  assigned_location?: string | null;

  issue_date?: string | null;
  expiration_date?: string | null;

  last_inspection_date?: string | null;
  next_inspection_date?: string | null;

  lifecycle_status: "active" | "out_of_service" | "removed";

  notes?: string | null;
  document_url?: string | null;
};

type Member = {
  userId: string;
  fullName: string;
  badgeNumber?: string | null;
  rankTitle?: string | null;
  unitName?: string | null;
};

type EquipmentVehicle = {
  id: string;
  unit_number: string;
  make?: string | null;
  model?: string | null;
};

type StatusFilter =
  | "all"
  | ReadinessStatus;

function emptySummary(): EquipmentReadinessSummary {
  return {
    totalRequiredChecks: 0,
    current: 0,
    dueSoon: 0,
    expired: 0,
    inspectionDueSoon: 0,
    inspectionOverdue: 0,
    missing: 0,
    outOfService: 0,
    ready: 0,
    notReady: 0,
    readinessPercent: 100,
  };
}

function statusLabel(status: ReadinessStatus) {
  switch (status) {
    case "current":
      return "Current";
    case "due_soon":
      return "Due Soon";
    case "expired":
      return "Expired";
    case "inspection_due_soon":
      return "Inspection Due Soon";
    case "inspection_overdue":
      return "Inspection Overdue";
    case "missing":
      return "Missing";
    case "out_of_service":
      return "Out of Service";
  }
}

function statusClasses(status: ReadinessStatus) {
  switch (status) {
    case "current":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";

    case "due_soon":
    case "inspection_due_soon":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";

    default:
      return "border-red-500/30 bg-red-500/10 text-red-300";
  }
}

function formatDate(value?: string | null) {
  if (!value) return "—";

  const parsed = new Date(`${value}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function responseError(response: Response) {
  const payload = await response.json().catch(() => ({}));
  return payload?.error || "The request could not be completed.";
}

function SummaryCard({
  label,
  value,
  detail,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: "green" | "amber" | "red" | "slate";
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-500/25 bg-emerald-500/[0.06]"
      : tone === "amber"
        ? "border-amber-500/25 bg-amber-500/[0.06]"
        : tone === "red"
          ? "border-red-500/25 bg-red-500/[0.06]"
          : "border-slate-800 bg-slate-900/70";

  return (
    <div className={`rounded-2xl border p-3 ${toneClass}`}>
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>

      <p className="mt-1.5 text-2xl font-bold text-white">
        {value}
      </p>

      <p className="mt-1 text-[10px] leading-4 text-slate-500">
        {detail}
      </p>
    </div>
  );
}

export default function EquipmentPage() {
  const [readiness, setReadiness] =
    useState<ReadinessPayload>({
      scope: "self",
      summary: emptySummary(),
      rows: [],
    });

  const [types, setTypes] = useState<EquipmentType[]>([]);
  const [requirements, setRequirements] =
    useState<EquipmentRequirement[]>([]);
  const [assets, setAssets] = useState<EquipmentAsset[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [vehicles, setVehicles] = useState<EquipmentVehicle[]>([]);

  const [canManage, setCanManage] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("all");

  const [search, setSearch] = useState("");

  const [showTypeForm, setShowTypeForm] =
    useState(false);
  const [editingType, setEditingType] = useState<EquipmentType | null>(null);

  const [showRequirementForm, setShowRequirementForm] =
    useState(false);

  const [showAssetForm, setShowAssetForm] =
    useState(false);
  const [editingAsset, setEditingAsset] = useState<EquipmentAsset | null>(null);
  const [detailAsset, setDetailAsset] = useState<EquipmentAsset | null>(null);
  const [activeView, setActiveView] =
    useState<"equipment" | "readiness">("equipment");
const [typeForm, setTypeForm] = useState({
    name: "",
    category: "General",
    description: "",
    expirationRequired: false,
    defaultValidDays: "",
    defaultDueSoonDays: "30",
    inspectionRequired: false,
    defaultInspectionIntervalDays: "",
    defaultInspectionDueSoonDays: "30",
  });

  const [requirementForm, setRequirementForm] =
    useState({
      equipmentTypeId: "",
      scopeType: "all" as "all" | "rank" | "unit" | "officer",
      scopeValue: "",
      isRequired: true,
      affectsReadiness: true,
      requiredQuantity: "1",
      validDays: "",
      dueSoonDays: "",
      inspectionIntervalDays: "",
      inspectionDueSoonDays: "",
      notes: "",
    });

  const [assetForm, setAssetForm] = useState({
    equipmentTypeId: "",
    assignedUserId: "",
    assignedVehicleId: "",
    assignedLocation: "",
    manufacturer: "",
    model: "",
    serialNumber: "",
    assetNumber: "",
    lotNumber: "",
    issueDate: "",
    expirationDate: "",
    lastInspectionDate: "",
    nextInspectionDate: "",
    notes: "",
    lifecycleStatus: "active" as EquipmentAsset["lifecycle_status"],
  });

  async function loadAll() {
    setLoading(true);
    setError("");

    try {
      const [
        readinessResponse,
        typesResponse,
        requirementsResponse,
        assetsResponse,
      ] = await Promise.all([
        fetch("/api/readiness/equipment", {
          cache: "no-store",
        }),

        fetch("/api/equipment/types", {
          cache: "no-store",
        }),

        fetch("/api/equipment/requirements", {
          cache: "no-store",
        }),

        fetch("/api/equipment/assets", {
          cache: "no-store",
        }),
      ]);

      if (!typesResponse.ok) {
        throw new Error(
          await responseError(typesResponse),
        );
      }

      if (!requirementsResponse.ok) {
        throw new Error(
          await responseError(requirementsResponse),
        );
      }

      if (!assetsResponse.ok) {
        throw new Error(
          await responseError(assetsResponse),
        );
      }

      const typesPayload =
        (await typesResponse.json()) as {
          items?: EquipmentType[];
          canManage?: boolean;
        };

      const requirementsPayload =
        (await requirementsResponse.json()) as {
          items?: EquipmentRequirement[];
          canManage?: boolean;
        };

      const assetsPayload =
        (await assetsResponse.json()) as {
          items?: EquipmentAsset[];
          members?: Member[];
          vehicles?: EquipmentVehicle[];
          canManage?: boolean;
        };

      setTypes(typesPayload.items ?? []);

      setRequirements(
        requirementsPayload.items ?? [],
      );

      setAssets(assetsPayload.items ?? []);

      setMembers(assetsPayload.members ?? []);
      setVehicles(assetsPayload.vehicles ?? []);

      setCanManage(
        Boolean(
          typesPayload.canManage ||
            requirementsPayload.canManage ||
            assetsPayload.canManage,
        ),
      );

      // Inventory is authoritative for the equipment table. Keep successfully
      // loaded assets visible even if the derived readiness aggregation fails.
      if (!readinessResponse.ok) {
        throw new Error(
          await responseError(readinessResponse),
        );
      }

      const readinessPayload =
        (await readinessResponse.json()) as ReadinessPayload;

      setReadiness(readinessPayload);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Equipment Readiness could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(loadAll);
  }, []);

  const typeMap = useMemo(
    () =>
      new Map(
        types.map((type) => [type.id, type]),
      ),
    [types],
  );

  const memberMap = useMemo(
    () =>
      new Map(
        members.map((member) => [
          member.userId,
          member,
        ]),
      ),
    [members],
  );
  const availableRanks = useMemo(
    () =>
      Array.from(
        new Set(
          members
            .map((member) => member.rankTitle?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [members],
  );

  const availableUnits = useMemo(
    () =>
      Array.from(
        new Set(
          members
            .map((member) => member.unitName?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [members],
  );
const filteredReadiness = useMemo(() => {
    const normalized = search.trim().toLowerCase();

    return readiness.rows.filter((row) => {
      if (
        statusFilter !== "all" &&
        row.status !== statusFilter
      ) {
        return false;
      }

      if (!normalized) return true;

      return [
        row.officerName,
        row.badgeNumber,
        row.rankTitle,
        row.unitName,
        row.equipmentName,
        row.equipmentCategory,
        row.statusReason,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [
    readiness.rows,
    search,
    statusFilter,
  ]);

  const officerReadinessGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        userId: string;
        officerName: string;
        badgeNumber?: string | null;
        rankTitle?: string | null;
        unitName?: string | null;
        rows: EquipmentReadinessRow[];
        requiredQuantity: number;
        assignedQuantity: number;
        missingQuantity: number;
        attentionCount: number;
        criticalCount: number;
        affectsReadinessCount: number;
        readinessReadyCount: number;
      }
    >();

    filteredReadiness.forEach((row) => {
      const existing = groups.get(row.userId);

      const group =
        existing ??
        {
          userId: row.userId,
          officerName: row.officerName,
          badgeNumber: row.badgeNumber,
          rankTitle: row.rankTitle,
          unitName: row.unitName,
          rows: [],
          requiredQuantity: 0,
          assignedQuantity: 0,
          missingQuantity: 0,
          attentionCount: 0,
          criticalCount: 0,
          affectsReadinessCount: 0,
          readinessReadyCount: 0,
        };

      group.rows.push(row);
      group.requiredQuantity += row.requiredQuantity;
      group.assignedQuantity += Math.min(
        row.assignedQuantity,
        row.requiredQuantity,
      );

      group.missingQuantity += Math.max(
        0,
        row.requiredQuantity - row.assignedQuantity,
      );

      if (
        row.status !== "current" &&
        row.status !== "due_soon" &&
        row.status !== "inspection_due_soon"
      ) {
        group.criticalCount += 1;
      }

      if (row.status !== "current") {
        group.attentionCount += 1;
      }

      if (row.affectsReadiness) {
        group.affectsReadinessCount += 1;

        if (
          row.status === "current" ||
          row.status === "due_soon" ||
          row.status === "inspection_due_soon"
        ) {
          group.readinessReadyCount += 1;
        }
      }

      groups.set(row.userId, group);
    });

    return Array.from(groups.values()).sort((a, b) => {
      if (a.criticalCount !== b.criticalCount) {
        return b.criticalCount - a.criticalCount;
      }

      if (a.attentionCount !== b.attentionCount) {
        return b.attentionCount - a.attentionCount;
      }

      return a.officerName.localeCompare(b.officerName);
    });
  }, [filteredReadiness]);


  async function saveType() {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        "/api/equipment/types",
        {
          method: editingType ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...typeForm, id: editingType?.id, isActive: editingType?.is_active ?? true }),
        },
      );

      if (!response.ok) {
        throw new Error(await responseError(response));
      }

      setTypeForm({
        name: "",
        category: "General",
        description: "",
        expirationRequired: false,
        defaultValidDays: "",
        defaultDueSoonDays: "30",
        inspectionRequired: false,
        defaultInspectionIntervalDays: "",
        defaultInspectionDueSoonDays: "30",
      });

      setShowTypeForm(false);
      setEditingType(null);
      await loadAll();
      setSuccess(editingType ? "Equipment type updated. Existing equipment relationships were preserved." : "Equipment type created. You can now add individual equipment to inventory.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Equipment type could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  function editType(type: EquipmentType) {
    setEditingType(type);
    setTypeForm({
      name: type.name,
      category: type.category,
      description: type.description ?? "",
      expirationRequired: type.expiration_required,
      defaultValidDays: type.default_valid_days == null ? "" : String(type.default_valid_days),
      defaultDueSoonDays: String(type.default_due_soon_days),
      inspectionRequired: type.inspection_required,
      defaultInspectionIntervalDays: type.default_inspection_interval_days == null ? "" : String(type.default_inspection_interval_days),
      defaultInspectionDueSoonDays: String(type.default_inspection_due_soon_days),
    });
    setShowTypeForm(true);
  }

  async function archiveType(type: EquipmentType) {
    const response = await fetch("/api/equipment/types", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: type.id, name: type.name, category: type.category, description: type.description,
        expirationRequired: type.expiration_required, defaultValidDays: type.default_valid_days,
        defaultDueSoonDays: type.default_due_soon_days, inspectionRequired: type.inspection_required,
        defaultInspectionIntervalDays: type.default_inspection_interval_days,
        defaultInspectionDueSoonDays: type.default_inspection_due_soon_days, isActive: false,
      }),
    });
    if (!response.ok) throw new Error(await responseError(response));
  }

  async function deleteType(type: EquipmentType) {
    if (!window.confirm(`Permanently delete ${type.name}? This cannot be undone.`)) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/equipment/types", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: type.id }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; canArchive?: boolean };
      if (!response.ok) {
        if (response.status === 409 && payload.canArchive && type.is_active &&
            window.confirm(`${payload.error}\n\nArchive this type instead?`)) {
          await archiveType(type);
          await loadAll();
          setSuccess(`${type.name} archived. It remains on historical records and is hidden from new-item selectors.`);
          return;
        }
        throw new Error(payload.error || "Equipment type could not be deleted.");
      }
      setTypes((current) => current.filter((item) => item.id !== type.id));
      setSuccess(`${type.name} permanently deleted.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Equipment type could not be deleted.");
    } finally { setSaving(false); }
  }

  async function saveRequirement() {
    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        "/api/equipment/requirements",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requirementForm),
        },
      );

      if (!response.ok) {
        throw new Error(await responseError(response));
      }

      setShowRequirementForm(false);

      setRequirementForm({
        equipmentTypeId: "",
      scopeType: "all" as "all" | "rank" | "unit" | "officer",
      scopeValue: "",
      isRequired: true,
      affectsReadiness: true,
      requiredQuantity: "1",
        validDays: "",
        dueSoonDays: "",
        inspectionIntervalDays: "",
        inspectionDueSoonDays: "",
        notes: "",
      });

      await loadAll();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Equipment requirement could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveAsset() {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        "/api/equipment/assets",
        {
          method: editingAsset ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...assetForm, id: editingAsset?.id }),
        },
      );

      if (!response.ok) {
        throw new Error(await responseError(response));
      }

      setAssetForm({
        equipmentTypeId: "",
        assignedUserId: "",
        assignedVehicleId: "",
        assignedLocation: "",
        manufacturer: "",
        model: "",
        serialNumber: "",
        assetNumber: "",
        lotNumber: "",
        issueDate: "",
        expirationDate: "",
        lastInspectionDate: "",
        nextInspectionDate: "",
        notes: "",
        lifecycleStatus: "active",
      });

      setShowAssetForm(false);
      setEditingAsset(null);

      await loadAll();
      setSuccess(editingAsset ? "Equipment updated successfully." : "Equipment added successfully.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Equipment asset could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  function editAsset(asset: EquipmentAsset) {
    setEditingAsset(asset);
    setAssetForm({
      equipmentTypeId: asset.equipment_type_id,
      assignedUserId: asset.assigned_user_id ?? "",
      assignedVehicleId: asset.assigned_vehicle_id ?? "",
      assignedLocation: asset.assigned_location ?? "",
      manufacturer: asset.manufacturer ?? "",
      model: asset.model ?? "",
      serialNumber: asset.serial_number ?? "",
      assetNumber: asset.asset_number ?? "",
      lotNumber: asset.lot_number ?? "",
      issueDate: asset.issue_date ?? "",
      expirationDate: asset.expiration_date ?? "",
      lastInspectionDate: asset.last_inspection_date ?? "",
      nextInspectionDate: asset.next_inspection_date ?? "",
      notes: asset.notes ?? "",
      lifecycleStatus: asset.lifecycle_status,
    });
    setError("");
    setSuccess("");
    setShowAssetForm(true);
  }

  async function updateAssetStatus(
    asset: EquipmentAsset,
    lifecycleStatus:
      | "active"
      | "out_of_service"
      | "removed",
  ) {
    let removalReason = "";

    if (lifecycleStatus === "removed") {
      removalReason =
        window.prompt(
          "Enter the reason this equipment is being removed:",
        )?.trim() ?? "";

      if (!removalReason) return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        "/api/equipment/assets",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: asset.id,
            lifecycleStatus,
            removalReason:
              lifecycleStatus === "removed"
                ? removalReason
                : undefined,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await responseError(response));
      }

      await loadAll();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Equipment status could not be updated.",
      );
    } finally {
      setSaving(false);
    }
  }

    const assetReadinessMap = useMemo(() => {
    const map = new Map<string, ReadinessStatus>();

    readiness.rows.forEach((row) => {
      row.assets.forEach((asset) => {
        map.set(asset.assetId, asset.status);
      });
    });

    return map;
  }, [readiness.rows]);

  const filteredAssets = useMemo(() => {
    const normalized = search.trim().toLowerCase();

    if (!normalized) return assets;

    return assets.filter((asset) => {
      const type = typeMap.get(asset.equipment_type_id);
      const member = asset.assigned_user_id
        ? memberMap.get(asset.assigned_user_id)
        : undefined;

      return [
        type?.name,
        type?.category,
        member?.fullName,
        member?.badgeNumber,
        member?.rankTitle,
        member?.unitName,
        asset.manufacturer,
        asset.model,
        asset.serial_number,
        asset.lot_number,
        asset.lifecycle_status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [assets, memberMap, search, typeMap]);
  const summary = readiness.summary;

  const criticalCount =
    summary.expired +
    summary.inspectionOverdue;

  const unavailableCount =
    summary.missing +
    summary.outOfService;

  return (
    <TracePointShell activePage="Equipment">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-400">
                Readiness
              </p>

              <h1 className="mt-1 text-2xl font-bold text-white">
                Equipment
              </h1>

              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
                Track issued equipment, assignments, expirations,
                inspections, and officer readiness.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canManage ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingType(null);
                      setTypeForm({ name: "", category: "General", description: "", expirationRequired: false, defaultValidDays: "", defaultDueSoonDays: "30", inspectionRequired: false, defaultInspectionIntervalDays: "", defaultInspectionDueSoonDays: "30" });
                      setShowTypeForm(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:border-slate-600 hover:text-white"
                  >
                    <Plus size={14} />
                    Create Equipment Category/Type
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowRequirementForm(true)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:border-slate-600 hover:text-white"
                  >
                    <Settings2 size={14} />
                    Requirement
                  </button>

                  <button
                  type="button"
                  onClick={() => {
                    setEditingAsset(null);
                    setAssetForm({ equipmentTypeId: "", assignedUserId: "", assignedVehicleId: "", assignedLocation: "", manufacturer: "", model: "", serialNumber: "", assetNumber: "", lotNumber: "", issueDate: "", expirationDate: "", lastInspectionDate: "", nextInspectionDate: "", notes: "", lifecycleStatus: "active" });
                    setShowAssetForm(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500"
                >
                  <PackagePlus size={15} />
                  Assign/Add to Inventory
                </button>
                </>
              ) : null}

              <button
                type="button"
                onClick={() => void loadAll()}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white disabled:opacity-50"
              >
                <RefreshCw
                  size={14}
                  className={loading ? "animate-spin" : ""}
                />
                Refresh
              </button>
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-red-700 bg-red-950/30 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {success ? (
          <div role="status" className="rounded-2xl border border-emerald-700 bg-emerald-950/30 p-4 text-sm text-emerald-200">
            {success}
          </div>
        ) : null}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard
            label="Current"
            value={summary.current}
            detail="Required equipment currently ready"
            tone="green"
          />

          <SummaryCard
            label="Due Soon"
            value={
              summary.dueSoon +
              summary.inspectionDueSoon
            }
            detail="Expiration or inspection approaching"
            tone="amber"
          />

          <SummaryCard
            label="Expired / Overdue"
            value={criticalCount}
            detail="Expired equipment or overdue inspections"
            tone={criticalCount > 0 ? "red" : "slate"}
          />

          <SummaryCard
            label="Missing / OOS"
            value={unavailableCount}
            detail="Required equipment unavailable"
            tone={unavailableCount > 0 ? "red" : "slate"}
          />
        </section>

        {canManage ? (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="mb-3">
              <h2 className="text-sm font-bold text-white">Equipment Types</h2>
              <p className="mt-1 text-xs text-slate-500">Edit active definitions, or delete unused types. Archived types remain visible here and on historical records.</p>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {types.map((type) => (
                <div key={type.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{type.name}</p>
                    <p className="text-[11px] text-slate-500">{type.category}{type.is_active ? "" : " · Archived"}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={saving} onClick={() => editType(type)} className="inline-flex items-center gap-1 rounded-lg border border-blue-700 px-2 py-1.5 text-[10px] font-semibold text-blue-300">
                      <Pencil size={11} /> Edit
                    </button>
                    <button type="button" disabled={saving} onClick={() => void deleteType(type)} className="inline-flex items-center gap-1 rounded-lg border border-red-800 px-2 py-1.5 text-[10px] font-semibold text-red-300">
                      <Trash2 size={11} /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
          <div className="flex flex-col gap-3 border-b border-slate-800 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1">
              <button
                type="button"
                onClick={() => setActiveView("equipment")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeView === "equipment"
                    ? "bg-slate-800 text-white"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Equipment
              </button>

              <button
                type="button"
                onClick={() => setActiveView("readiness")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeView === "readiness"
                    ? "bg-slate-800 text-white"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Officer Readiness
              </button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder={
                  activeView === "equipment"
                    ? "Search equipment, officer, serial..."
                    : "Search officer or equipment..."
                }
                className="min-w-[250px] rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500"
              />

              {activeView === "readiness" ? (
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(
                      event.target.value as StatusFilter,
                    )
                  }
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500"
                >
                  <option value="all">All statuses</option>
                  <option value="current">Current</option>
                  <option value="due_soon">Due Soon</option>
                  <option value="inspection_due_soon">
                    Inspection Due Soon
                  </option>
                  <option value="missing">Missing</option>
                  <option value="expired">Expired</option>
                  <option value="inspection_overdue">
                    Inspection Overdue
                  </option>
                  <option value="out_of_service">
                    Out of Service
                  </option>
                </select>
              ) : null}
            </div>
          </div>

          {activeView === "equipment" ? (
            loading ? (
              <div className="flex min-h-[280px] items-center justify-center">
                <RefreshCw
                  size={24}
                  className="animate-spin text-blue-300"
                />
              </div>
            ) : filteredAssets.length === 0 ? (
              <div className="flex min-h-[240px] flex-col items-center justify-center p-6 text-center">
                <Boxes size={34} className="text-slate-600" />
                <p className="mt-3 font-semibold text-white">
                  No equipment inventory found
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Add equipment to department inventory and optionally assign it to an officer, vehicle, unit, or location.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1050px] text-left">
                  <thead className="border-b border-slate-800 bg-slate-950/40">
                    <tr className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-3">Equipment</th>
                      <th className="px-4 py-3">Assigned To</th>
                      <th className="px-4 py-3">Serial / Lot</th>
                      <th className="px-4 py-3">Expires</th>
                      <th className="px-4 py-3">Inspection</th>
                      <th className="px-4 py-3">Status</th>
                      {canManage ? (
                        <th className="px-4 py-3 text-right">
                          Actions
                        </th>
                      ) : null}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-800">
                    {filteredAssets.map((asset) => {
                      const type =
                        typeMap.get(asset.equipment_type_id);

                      const member = asset.assigned_user_id
                        ? memberMap.get(asset.assigned_user_id)
                        : undefined;
                      const vehicle = asset.assigned_vehicle_id
                        ? vehicles.find((item) => item.id === asset.assigned_vehicle_id)
                        : undefined;

                      const readinessStatus =
                        assetReadinessMap.get(asset.id);

                      return (
                        <tr
                          key={asset.id}
                          className="align-top transition hover:bg-slate-950/40"
                        >
                          <td className="px-4 py-3">
                            <button type="button" onClick={() => setDetailAsset(asset)} className="text-left text-sm font-semibold text-white hover:text-blue-300">
                              {type?.name ?? "Equipment"}
                            </button>
                            <p className="mt-1 text-[11px] text-slate-500">
                              {[asset.manufacturer, asset.model]
                                .filter(Boolean)
                                .join(" ") || "No make/model recorded"}
                            </p>
                          </td>

                          <td className="px-4 py-3">
                            <p className="text-xs font-medium text-slate-300">
                              {member?.fullName ?? (vehicle ? `Vehicle ${vehicle.unit_number}` : asset.assigned_location ?? "Unassigned")}
                            </p>
                            <p className="mt-1 text-[10px] text-slate-500">
                              {member?.badgeNumber
                                ? `Badge ${member.badgeNumber}`
                                : ""}
                            </p>
                          </td>

                          <td className="px-4 py-3 text-xs text-slate-400">
                            <div>
                              {asset.serial_number
                                ? `SN ${asset.serial_number}`
                                : "—"}
                            </div>

                            {asset.asset_number ? (
                              <div className="mt-1 text-[10px] text-slate-500">
                                Asset {asset.asset_number}
                              </div>
                            ) : null}

                            {asset.lot_number ? (
                              <div className="mt-1 text-[10px] text-slate-500">
                                Lot {asset.lot_number}
                              </div>
                            ) : null}
                          </td>

                          <td className="px-4 py-3 text-xs text-slate-400">
                            {formatDate(asset.expiration_date)}
                          </td>

                          <td className="px-4 py-3 text-xs text-slate-400">
                            {formatDate(asset.next_inspection_date)}
                          </td>

                          <td className="px-4 py-3">
                            {asset.lifecycle_status === "removed" ? (
                              <span className="inline-flex rounded-full border border-slate-700 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                                Removed
                              </span>
                            ) : asset.lifecycle_status ===
                              "out_of_service" ? (
                              <span className="inline-flex rounded-full border border-red-500/30 bg-red-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-red-300">
                                Out of Service
                              </span>
                            ) : readinessStatus ? (
                              <span
                                className={`inline-flex rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${statusClasses(
                                  readinessStatus,
                                )}`}
                              >
                                {statusLabel(readinessStatus)}
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full border border-slate-700 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">
                                Active
                              </span>
                            )}
                          </td>

                          {canManage ? (
                            <td className="px-4 py-3">
                              {asset.lifecycle_status !== "removed" ? (
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => editAsset(asset)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-blue-700 px-2 py-1.5 text-[10px] font-semibold text-blue-300"
                                  >
                                    <Pencil size={11} /> Edit
                                  </button>
                                  {asset.lifecycle_status === "active" ? (
                                    <button
                                      type="button"
                                      disabled={saving}
                                      onClick={() =>
                                        void updateAssetStatus(
                                          asset,
                                          "out_of_service",
                                        )
                                      }
                                      className="rounded-lg border border-amber-700 px-2 py-1.5 text-[10px] font-semibold text-amber-300"
                                    >
                                      OOS
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={saving}
                                      onClick={() =>
                                        void updateAssetStatus(
                                          asset,
                                          "active",
                                        )
                                      }
                                      className="rounded-lg border border-emerald-700 px-2 py-1.5 text-[10px] font-semibold text-emerald-300"
                                    >
                                      Return
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() =>
                                      void updateAssetStatus(
                                        asset,
                                        "removed",
                                      )
                                    }
                                    className="rounded-lg border border-red-800 px-2 py-1.5 text-[10px] font-semibold text-red-300"
                                  >
                                    Remove
                                  </button>
                                </div>
                              ) : null}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : loading ? (
            <div className="flex min-h-[280px] items-center justify-center">
              <RefreshCw
                size={24}
                className="animate-spin text-blue-300"
              />
            </div>
          ) : filteredReadiness.length === 0 ? (
            <div className="flex min-h-[240px] flex-col items-center justify-center p-6 text-center">
              <ShieldCheck
                size={34}
                className="text-emerald-400"
              />
              <p className="mt-3 font-semibold text-white">
                No officer readiness records found
              </p>
              <p className="mt-1 text-xs text-slate-500">
                No officers match the current readiness filters.
              </p>
            </div>
          ) : (
            <div className="space-y-3 p-4">
              {officerReadinessGroups.map((group) => {
                const readinessPercent =
                  group.affectsReadinessCount > 0
                    ? Math.round(
                        (group.readinessReadyCount /
                          group.affectsReadinessCount) *
                          100,
                      )
                    : 100;

                const ready =
                  group.criticalCount === 0 &&
                  group.missingQuantity === 0;

                return (
                  <article
                    key={group.userId}
                    className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/35"
                  >
                    <div className="flex flex-col gap-4 border-b border-slate-800 p-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex items-start gap-3">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                            ready
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                              : "border-red-500/30 bg-red-500/10 text-red-300"
                          }`}
                        >
                          {ready ? (
                            <ShieldCheck size={19} />
                          ) : (
                            <ShieldAlert size={19} />
                          )}
                        </div>

                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-bold text-white">
                              {group.officerName}
                            </h3>

                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                                ready
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                  : "border-red-500/30 bg-red-500/10 text-red-300"
                              }`}
                            >
                              {ready
                                ? "Ready"
                                : "Needs Attention"}
                            </span>
                          </div>

                          <p className="mt-1 text-[10px] text-slate-500">
                            {[
                              group.rankTitle,
                              group.unitName,
                              group.badgeNumber
                                ? `Badge ${group.badgeNumber}`
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                          <p className="text-[8px] font-semibold uppercase tracking-wider text-slate-500">
                            Required
                          </p>
                          <p className="mt-1 text-base font-bold text-white">
                            {group.requiredQuantity}
                          </p>
                        </div>

                        <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                          <p className="text-[8px] font-semibold uppercase tracking-wider text-slate-500">
                            Issued
                          </p>
                          <p className="mt-1 text-base font-bold text-white">
                            {group.assignedQuantity}
                          </p>
                        </div>

                        <div
                          className={`rounded-xl border px-3 py-2 ${
                            group.missingQuantity > 0
                              ? "border-red-500/30 bg-red-500/[0.07]"
                              : "border-slate-800 bg-slate-900/70"
                          }`}
                        >
                          <p className="text-[8px] font-semibold uppercase tracking-wider text-slate-500">
                            Missing
                          </p>
                          <p
                            className={`mt-1 text-base font-bold ${
                              group.missingQuantity > 0
                                ? "text-red-300"
                                : "text-white"
                            }`}
                          >
                            {group.missingQuantity}
                          </p>
                        </div>

                        <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                          <p className="text-[8px] font-semibold uppercase tracking-wider text-slate-500">
                            Readiness
                          </p>
                          <p
                            className={`mt-1 text-base font-bold ${
                              readinessPercent === 100
                                ? "text-emerald-300"
                                : readinessPercent >= 80
                                  ? "text-amber-300"
                                  : "text-red-300"
                            }`}
                          >
                            {readinessPercent}%
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="divide-y divide-slate-800">
                      {group.rows
                        .slice()
                        .sort((a, b) => {
                          const order: Record<
                            ReadinessStatus,
                            number
                          > = {
                            missing: 0,
                            out_of_service: 1,
                            expired: 2,
                            inspection_overdue: 3,
                            due_soon: 4,
                            inspection_due_soon: 5,
                            current: 6,
                          };

                          return (
                            order[a.status] - order[b.status]
                          );
                        })
                        .map((row) => (
                          <div
                            key={`${row.userId}-${row.equipmentTypeId}-${row.scopeType}-${row.scopeValue}`}
                            className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(220px,1.3fr)_120px_160px_minmax(260px,2fr)] lg:items-center"
                          >
                            <div>
                              <p className="text-xs font-semibold text-slate-200">
                                {row.equipmentName}
                              </p>

                              <p className="mt-1 text-[10px] text-slate-500">
                                {row.equipmentCategory}
                                {!row.affectsReadiness
                                  ? " · Tracked only"
                                  : ""}
                              </p>
                            </div>

                            <div>
                              <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-600">
                                Issued
                              </p>
                              <p className="mt-1 text-xs text-slate-300">
                                {row.assignedQuantity}/
                                {row.requiredQuantity}
                              </p>
                            </div>

                            <div>
                              <span
                                className={`inline-flex rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${statusClasses(
                                  row.status,
                                )}`}
                              >
                                {statusLabel(row.status)}
                              </span>
                            </div>

                            <p className="text-xs leading-5 text-slate-400">
                              {row.statusReason}
                            </p>
                          </div>
                        ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
{showTypeForm && canManage ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5">
              <h2 className="text-lg font-bold text-white">
                {editingType ? "Edit Equipment Category/Type" : "Create Equipment Category/Type"}
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Create a reusable equipment category or type before adding individual items to inventory.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <input
                  value={typeForm.name}
                  onChange={(event) =>
                    setTypeForm({
                      ...typeForm,
                      name: event.target.value,
                    })
                  }
                  placeholder="Equipment type name"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <input
                  value={typeForm.category}
                  onChange={(event) =>
                    setTypeForm({
                      ...typeForm,
                      category: event.target.value,
                    })
                  }
                  placeholder="Category"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <textarea
                  value={typeForm.description}
                  onChange={(event) =>
                    setTypeForm({
                      ...typeForm,
                      description:
                        event.target.value,
                    })
                  }
                  placeholder="Description"
                  className="sm:col-span-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={
                      typeForm.expirationRequired
                    }
                    onChange={(event) =>
                      setTypeForm({
                        ...typeForm,
                        expirationRequired:
                          event.target.checked,
                      })
                    }
                  />
                  Expiration required
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={
                      typeForm.inspectionRequired
                    }
                    onChange={(event) =>
                      setTypeForm({
                        ...typeForm,
                        inspectionRequired:
                          event.target.checked,
                      })
                    }
                  />
                  Inspection required
                </label>

                <input
                  type="number"
                  value={typeForm.defaultValidDays}
                  onChange={(event) =>
                    setTypeForm({
                      ...typeForm,
                      defaultValidDays:
                        event.target.value,
                    })
                  }
                  placeholder="Default validity days"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <input
                  type="number"
                  value={
                    typeForm.defaultDueSoonDays
                  }
                  onChange={(event) =>
                    setTypeForm({
                      ...typeForm,
                      defaultDueSoonDays:
                        event.target.value,
                    })
                  }
                  placeholder="Expiration warning days"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <input
                  type="number"
                  value={
                    typeForm.defaultInspectionIntervalDays
                  }
                  onChange={(event) =>
                    setTypeForm({
                      ...typeForm,
                      defaultInspectionIntervalDays:
                        event.target.value,
                    })
                  }
                  placeholder="Inspection interval days"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <input
                  type="number"
                  value={
                    typeForm.defaultInspectionDueSoonDays
                  }
                  onChange={(event) =>
                    setTypeForm({
                      ...typeForm,
                      defaultInspectionDueSoonDays:
                        event.target.value,
                    })
                  }
                  placeholder="Inspection warning days"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    (setShowTypeForm(false), setEditingType(null))
                  }
                  className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveType()}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {editingType ? "Save Equipment Category/Type" : "Create Equipment Category/Type"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showRequirementForm && canManage ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5">
              <h2 className="text-lg font-bold text-white">
                Agency Equipment Requirement
              </h2>

              <p className="mt-1 text-xs text-slate-500">
                Define who should receive this equipment and whether the requirement affects operational readiness.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <select
                  value={
                    requirementForm.equipmentTypeId
                  }
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      equipmentTypeId: event.target.value,
                    })
                  }
                  className="sm:col-span-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                >
                  <option value="">
                    Select equipment type
                  </option>

                  {types
                    .filter(
                      (type) => type.is_active,
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

                <label className="space-y-1 text-[10px] text-slate-500">
                  <span>Applies To</span>
                  <select
                    value={requirementForm.scopeType}
                    onChange={(event) =>
                      setRequirementForm({
                        ...requirementForm,
                        scopeType: event.target.value as
                          | "all"
                          | "rank"
                          | "unit"
                          | "officer",
                        scopeValue: "",
                      })
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  >
                    <option value="all">Everyone</option>
                    <option value="rank">Rank / Title</option>
                    <option value="unit">Unit</option>
                    <option value="officer">Specific Officer</option>
                  </select>
                </label>

                {requirementForm.scopeType === "rank" ? (
                  <label className="space-y-1 text-[10px] text-slate-500">
                    <span>Rank / Title</span>
                    <select
                      value={requirementForm.scopeValue}
                      onChange={(event) =>
                        setRequirementForm({
                          ...requirementForm,
                          scopeValue: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                    >
                      <option value="">Select rank/title</option>

                      {availableRanks.map((rank) => (
                        <option key={rank} value={rank}>
                          {rank}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {requirementForm.scopeType === "unit" ? (
                  <label className="space-y-1 text-[10px] text-slate-500">
                    <span>Unit</span>
                    <select
                      value={requirementForm.scopeValue}
                      onChange={(event) =>
                        setRequirementForm({
                          ...requirementForm,
                          scopeValue: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                    >
                      <option value="">Select unit</option>

                      {availableUnits.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {requirementForm.scopeType === "officer" ? (
                  <label className="space-y-1 text-[10px] text-slate-500">
                    <span>Officer</span>
                    <select
                      value={requirementForm.scopeValue}
                      onChange={(event) =>
                        setRequirementForm({
                          ...requirementForm,
                          scopeValue: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                    >
                      <option value="">Select officer</option>

                      {members.map((member) => (
                        <option
                          key={member.userId}
                          value={member.userId}
                        >
                          {member.fullName}
                          {member.badgeNumber
                            ? ` · ${member.badgeNumber}`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={
                      requirementForm.isRequired
                    }
                    onChange={(event) =>
                      setRequirementForm({
                        ...requirementForm,
                        isRequired:
                          event.target.checked,
                      })
                    }
                  />
                  Required equipment
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={requirementForm.affectsReadiness}
                    onChange={(event) =>
                      setRequirementForm({
                        ...requirementForm,
                        affectsReadiness: event.target.checked,
                      })
                    }
                  />
                  Affects readiness
                </label>

                <input
                  type="number"
                  min="1"
                  value={
                    requirementForm.requiredQuantity
                  }
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      requiredQuantity:
                        event.target.value,
                    })
                  }
                  placeholder="Required quantity"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <input
                  type="number"
                  value={requirementForm.validDays}
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      validDays:
                        event.target.value,
                    })
                  }
                  placeholder="Validity override days"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <input
                  type="number"
                  value={
                    requirementForm.dueSoonDays
                  }
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      dueSoonDays:
                        event.target.value,
                    })
                  }
                  placeholder="Expiration warning override"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <input
                  type="number"
                  value={
                    requirementForm.inspectionIntervalDays
                  }
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      inspectionIntervalDays:
                        event.target.value,
                    })
                  }
                  placeholder="Inspection interval override"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <input
                  type="number"
                  value={
                    requirementForm.inspectionDueSoonDays
                  }
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      inspectionDueSoonDays:
                        event.target.value,
                    })
                  }
                  placeholder="Inspection warning override"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <textarea
                  value={requirementForm.notes}
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      notes: event.target.value,
                    })
                  }
                  placeholder="Requirement notes"
                  className="sm:col-span-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setShowRequirementForm(false)
                  }
                  className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={
                    saving ||
                    !requirementForm.equipmentTypeId ||
                    (requirementForm.scopeType !== "all" &&
                      !requirementForm.scopeValue)
                  }
                  onClick={() =>
                    void saveRequirement()
                  }
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Save Requirement
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {detailAsset ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-950 p-5">
              <div className="flex items-start justify-between gap-4">
                <div><h2 className="text-lg font-bold text-white">{typeMap.get(detailAsset.equipment_type_id)?.name ?? "Equipment details"}</h2><p className="mt-1 text-sm text-slate-400">{[detailAsset.manufacturer, detailAsset.model].filter(Boolean).join(" ") || "No make/model recorded"}</p></div>
                <button type="button" onClick={() => setDetailAsset(null)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300">Close</button>
              </div>
              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                {[["Serial number", detailAsset.serial_number], ["Asset number", detailAsset.asset_number], ["Lot number", detailAsset.lot_number], ["Status", detailAsset.lifecycle_status], ["Issue date", formatDate(detailAsset.issue_date)], ["Expiration", formatDate(detailAsset.expiration_date)], ["Last inspection", formatDate(detailAsset.last_inspection_date)], ["Next inspection", formatDate(detailAsset.next_inspection_date)], ["Notes", detailAsset.notes]].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-800 p-3"><dt className="text-[10px] uppercase text-slate-500">{label}</dt><dd className="mt-1 text-slate-200">{value || "—"}</dd></div>)}
              </dl>
              {canManage ? <div className="mt-5 flex justify-end"><button type="button" onClick={() => { setDetailAsset(null); editAsset(detailAsset); }} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white"><Pencil size={13}/> Edit Equipment</button></div> : null}
            </div>
          </div>
        ) : null}

        {showAssetForm && canManage ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5">
              <h2 className="text-lg font-bold text-white">
                {editingAsset ? "Edit Equipment" : "Assign/Add to Inventory"}
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                {editingAsset ? "Update configurable details and custody. System identifiers and agency ownership cannot be changed." : "Add equipment to department inventory and optionally assign it to an officer, vehicle, or location."}
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <select
                  value={assetForm.equipmentTypeId}
                  onChange={(event) =>
                    setAssetForm({
                      ...assetForm,
                      equipmentTypeId:
                        event.target.value,
                    })
                  }
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                >
                  <option value="">
                    Select equipment type
                  </option>

                  {types
                    .filter(
                      (type) => type.is_active,
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

                <select
                  value={assetForm.assignedUserId}
                  onChange={(event) =>
                    setAssetForm({
                      ...assetForm,
                      assignedUserId:
                        event.target.value,
                      assignedVehicleId: "",
                      assignedLocation: "",
                    })
                  }
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                >
                  <option value="">
                    Unassigned
                  </option>

                  {members.map((member) => (
                    <option
                      key={member.userId}
                      value={member.userId}
                    >
                      {member.fullName}
                      {member.badgeNumber
                        ? ` · ${member.badgeNumber}`
                        : ""}
                    </option>
                  ))}
                </select>

                <select
                  value={assetForm.assignedVehicleId}
                  onChange={(event) => setAssetForm({ ...assetForm, assignedVehicleId: event.target.value, assignedUserId: "", assignedLocation: "" })}
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                >
                  <option value="">No vehicle assignment</option>
                  {vehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>Vehicle {vehicle.unit_number} · {[vehicle.make, vehicle.model].filter(Boolean).join(" ")}</option>
                  ))}
                </select>

                <input
                  value={assetForm.assignedLocation}
                  onChange={(event) => setAssetForm({ ...assetForm, assignedLocation: event.target.value, assignedUserId: "", assignedVehicleId: "" })}
                  placeholder="Assigned location (optional)"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <input
                  value={assetForm.manufacturer}
                  onChange={(event) =>
                    setAssetForm({
                      ...assetForm,
                      manufacturer:
                        event.target.value,
                    })
                  }
                  placeholder="Manufacturer"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <input
                  value={assetForm.model}
                  onChange={(event) =>
                    setAssetForm({
                      ...assetForm,
                      model: event.target.value,
                    })
                  }
                  placeholder="Model"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <input
                  value={assetForm.serialNumber}
                  onChange={(event) =>
                    setAssetForm({
                      ...assetForm,
                      serialNumber:
                        event.target.value,
                    })
                  }
                  placeholder="Serial number"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <input
                  value={assetForm.assetNumber}
                  onChange={(event) => setAssetForm({ ...assetForm, assetNumber: event.target.value })}
                  placeholder="Asset number"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <input
                  value={assetForm.lotNumber}
                  onChange={(event) =>
                    setAssetForm({
                      ...assetForm,
                      lotNumber:
                        event.target.value,
                    })
                  }
                  placeholder="Lot number"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <label className="space-y-1 text-[10px] text-slate-500">
                  <span>Issue Date</span>
                  <input
                    type="date"
                    value={assetForm.issueDate}
                    onChange={(event) =>
                      setAssetForm({
                        ...assetForm,
                        issueDate:
                          event.target.value,
                      })
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </label>

                <label className="space-y-1 text-[10px] text-slate-500">
                  <span>Expiration Date</span>
                  <input
                    type="date"
                    value={assetForm.expirationDate}
                    onChange={(event) =>
                      setAssetForm({
                        ...assetForm,
                        expirationDate:
                          event.target.value,
                      })
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </label>

                <label className="space-y-1 text-[10px] text-slate-500">
                  <span>Last Inspection</span>
                  <input
                    type="date"
                    value={
                      assetForm.lastInspectionDate
                    }
                    onChange={(event) =>
                      setAssetForm({
                        ...assetForm,
                        lastInspectionDate:
                          event.target.value,
                      })
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </label>

                <label className="space-y-1 text-[10px] text-slate-500">
                  <span>Next Inspection</span>
                  <input
                    type="date"
                    value={
                      assetForm.nextInspectionDate
                    }
                    onChange={(event) =>
                      setAssetForm({
                        ...assetForm,
                        nextInspectionDate:
                          event.target.value,
                      })
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </label>

                <textarea
                  value={assetForm.notes}
                  onChange={(event) =>
                    setAssetForm({
                      ...assetForm,
                      notes: event.target.value,
                    })
                  }
                  placeholder="Notes"
                  className="sm:col-span-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />

                <label className="space-y-1 text-[10px] text-slate-500">
                  <span>Status</span>
                  <select
                    value={assetForm.lifecycleStatus}
                    onChange={(event) => setAssetForm({ ...assetForm, lifecycleStatus: event.target.value as EquipmentAsset["lifecycle_status"] })}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  >
                    <option value="active">Active</option>
                    <option value="out_of_service">Out of service</option>
                    {editingAsset?.lifecycle_status === "removed" ? <option value="removed">Removed</option> : null}
                  </select>
                </label>
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowAssetForm(false); setEditingAsset(null); }}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={
                    saving ||
                    !assetForm.equipmentTypeId
                  }
                  onClick={() =>
                    void saveAsset()
                  }
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {editingAsset ? "Save Changes" : "Assign/Add to Inventory"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </TracePointShell>
  );
}








