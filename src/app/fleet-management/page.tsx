"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Car,
  ChevronRight,
  CheckCircle2,
  ClipboardCheck,
  Plus,
  Pencil,
  QrCode,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Wrench,
  X,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";
import {
  ASSIGNMENT_TYPES,
  FLEET_STATUSES,
  activeAdvancedFilterCount,
  applyInventoryView,
  clearAdvancedFilters,
  inspectionState,
  parseInventoryQuery,
  serializeInventoryQuery,
  serviceState,
  type AssignmentType,
  type FleetInventoryVehicle,
  type FleetStatus,
  type InventoryQueryState,
  type InventorySortColumn,
  type ScheduleState,
} from "@/lib/fleet/inventory-state";

type FleetVehicle = FleetInventoryVehicle & {
  registration_expiration_date: string | null;
  insurance_expiration_date: string | null;
  in_service_date: string | null;
  last_service_date: string | null;
  last_service_mileage: number | null;
  last_service_hours: number | null;
  next_service_hours: number | null;
  comments: string | null;
  notes: string | null;
  updated_at: string;
};

type FleetPayload = {
  items?: FleetVehicle[];
  canManage?: boolean;
};

type VehicleForm = {
  unitNumber: string;
  vin: string;
  licensePlate: string;
  year: string;
  make: string;
  model: string;
  vehicleType: string;
  assignmentType: AssignmentType;
  assignedTo: string;
  homeLocation: string;
  currentMileage: string;
  currentHours: string;
  status: FleetStatus;
  inspectionDueDate: string;
  registrationExpirationDate: string;
  insuranceExpirationDate: string;
  inServiceDate: string;
  lastServiceDate: string;
  lastServiceMileage: string;
  lastServiceHours: string;
  nextServiceDate: string;
  nextServiceMileage: string;
  nextServiceHours: string;
  openIssueCount: string;
  comments: string;
  notes: string;
  reason: string;
};

const EMPTY_FORM: VehicleForm = {
  unitNumber: "",
  vin: "",
  licensePlate: "",
  year: "",
  make: "",
  model: "",
  vehicleType: "Patrol",
  assignmentType: "Pool",
  assignedTo: "",
  homeLocation: "",
  currentMileage: "",
  currentHours: "",
  status: "Available",
  inspectionDueDate: "",
  registrationExpirationDate: "",
  insuranceExpirationDate: "",
  inServiceDate: "",
  lastServiceDate: "",
  lastServiceMileage: "",
  lastServiceHours: "",
  nextServiceDate: "",
  nextServiceMileage: "",
  nextServiceHours: "",
  openIssueCount: "0",
  comments: "",
  notes: "",
  reason: "",
};

const STATUSES: FleetStatus[] = [...FLEET_STATUSES];

const PREVIEW_VEHICLE: FleetVehicle = {
  id: "preview", unit_number: "3101", vin: "1FM5K8AR0NGA00001",
  license_plate: "MG-3101", year: 2025, make: "Ford",
  model: "Police Interceptor Utility", vehicle_type: "Patrol",
  assignment_type: "Pool", assigned_to: "Patrol Division",
  home_location: "Headquarters", current_mileage: 18422,
  current_hours: 2167.4, status: "Attention", inspection_due_date: "2026-09-12",
  registration_expiration_date: "2027-01-31", last_service_date: "2026-07-20",
  insurance_expiration_date: "2027-01-31", in_service_date: "2025-02-01",
  last_service_mileage: 16000, last_service_hours: 1900,
  next_service_date: "2026-09-05", next_service_mileage: 20000,
  next_service_hours: 2300, open_issue_count: 1, comments: null,
  notes: "Local preview vehicle", updated_at: new Date().toISOString(),
};

function formForVehicle(vehicle: FleetVehicle): VehicleForm {
  return {
    unitNumber: vehicle.unit_number,
    vin: vehicle.vin ?? "",
    licensePlate: vehicle.license_plate ?? "",
    year: vehicle.year?.toString() ?? "",
    make: vehicle.make ?? "",
    model: vehicle.model ?? "",
    vehicleType: vehicle.vehicle_type ?? "",
    assignmentType: vehicle.assignment_type,
    assignedTo: vehicle.assigned_to ?? "",
    homeLocation: vehicle.home_location ?? "",
    currentMileage: vehicle.current_mileage?.toString() ?? "",
    currentHours: vehicle.current_hours?.toString() ?? "",
    status: vehicle.status,
    inspectionDueDate: vehicle.inspection_due_date ?? "",
    registrationExpirationDate: vehicle.registration_expiration_date ?? "",
    insuranceExpirationDate: vehicle.insurance_expiration_date ?? "",
    inServiceDate: vehicle.in_service_date ?? "",
    lastServiceDate: vehicle.last_service_date ?? "",
    lastServiceMileage: vehicle.last_service_mileage?.toString() ?? "",
    lastServiceHours: vehicle.last_service_hours?.toString() ?? "",
    nextServiceDate: vehicle.next_service_date ?? "",
    nextServiceMileage: vehicle.next_service_mileage?.toString() ?? "",
    nextServiceHours: vehicle.next_service_hours?.toString() ?? "",
    openIssueCount: vehicle.open_issue_count?.toString() ?? "0",
    comments: vehicle.comments ?? "",
    notes: vehicle.notes ?? "",
    reason: "",
  };
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMileage(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.max(0, value).toLocaleString("en-US")} mi`;
}

function statusClasses(status: FleetStatus) {
  switch (status) {
    case "Available":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "Attention":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "Maintenance":
      return "border-blue-500/30 bg-blue-500/10 text-blue-300";
    case "Out of Service":
      return "border-red-500/30 bg-red-500/10 text-red-300";
    case "Retired":
      return "border-slate-700 bg-slate-800/60 text-slate-400";
  }
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
  value: number;
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
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-[10px] leading-4 text-slate-500">{detail}</p>
    </div>
  );
}

function Field({
  label,
  children,
  span = false,
}: {
  label: string;
  children: ReactNode;
  span?: boolean;
}) {
  return (
    <label className={span ? "sm:col-span-2" : ""}>
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

const SCHEDULE_LABELS: Record<ScheduleState, string> = {
  current: "Current",
  "due-soon": "Due Soon",
  overdue: "Overdue",
  "not-scheduled": "Not Scheduled",
};

type AdvancedFilterKey =
  | "vehicle"
  | "assignment"
  | "location"
  | "inspection"
  | "service"
  | "issues";

function SortableHeader({
  column,
  label,
  query,
  onSort,
}: {
  column: InventorySortColumn;
  label: string;
  query: InventoryQueryState;
  onSort: (column: InventorySortColumn) => void;
}) {
  const active = query.sort === column;
  const ariaSort = active
    ? query.direction === "asc" ? "ascending" : "descending"
    : "none";
  return (
    <th className="px-2 py-1" aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onSort(column)}
        aria-label={`Sort by ${label}${active ? `, currently ${ariaSort}` : ""}`}
        className={`inline-flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-left transition hover:bg-slate-800/70 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${active ? "text-blue-300" : "text-slate-500"}`}
      >
        <span>{label}</span>
        {active ? (
          query.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
        ) : (
          <span aria-hidden="true" className="text-[11px] text-slate-700">↕</span>
        )}
      </button>
    </th>
  );
}

function FleetManagementContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(
    () => parseInventoryQuery(searchParams.toString()),
    [searchParams],
  );
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [form, setForm] = useState<VehicleForm>(EMPTY_FORM);

  function replaceQuery(next: InventoryQueryState) {
    const value = serializeInventoryQuery(next).toString();
    window.history.replaceState(null, "", value ? `${pathname}?${value}` : pathname);
  }

  function updateQuery(patch: Partial<InventoryQueryState>) {
    replaceQuery({ ...query, ...patch });
  }

  function sortBy(column: InventorySortColumn) {
    updateQuery({
      sort: column,
      direction: query.sort === column && query.direction === "asc" ? "desc" : "asc",
    });
  }

  function removeAdvancedFilter(key: AdvancedFilterKey) {
    replaceQuery({ ...query, [key]: "" });
  }

  function openCreateForm() {
    setEditingVehicleId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEditForm(vehicle: FleetVehicle) {
    setEditingVehicleId(vehicle.id);
    setForm(formForVehicle(vehicle));
    setShowForm(true);
  }

  function closeForm(force = false) {
    if (saving && !force) return;
    setShowForm(false);
    setEditingVehicleId(null);
    setForm(EMPTY_FORM);
  }

  async function loadFleet() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/fleet/vehicles", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = (await response.json()) as FleetPayload;
      setVehicles(payload.items ?? []);
      setCanManage(payload.canManage === true);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Fleet records could not be loaded.";
      if (message.toLowerCase().includes("migration")) {
        setVehicles([PREVIEW_VEHICLE]);
        setCanManage(true);
        setError("Local preview mode: the Fleet migration has not been applied, so the example vehicle is read-only.");
      } else setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFleet();
  }, []);

  const summary = useMemo(() => {
    const activeVehicles = vehicles.filter((vehicle) => vehicle.status !== "Retired");
    return {
      total: activeVehicles.length,
      available: activeVehicles.filter((vehicle) => vehicle.status === "Available").length,
      attention: activeVehicles.filter((vehicle) => vehicle.status === "Attention").length,
      unavailable: activeVehicles.filter(
        (vehicle) =>
          vehicle.status === "Maintenance" || vehicle.status === "Out of Service",
      ).length,
    };
  }, [vehicles]);

  const filteredVehicles = useMemo(
    () => applyInventoryView(vehicles, query),
    [query, vehicles],
  );

  const locations = useMemo(
    () => [...new Set(vehicles.map((vehicle) => vehicle.home_location?.trim()).filter((value): value is string => Boolean(value)))]
      .sort((left, right) => left.localeCompare(right, "en-US", { numeric: true, sensitivity: "base" })),
    [vehicles],
  );
  const activeFilterCount = activeAdvancedFilterCount(query);
  const activeFilterChips: Array<{ key: AdvancedFilterKey; label: string }> = [
    query.vehicle ? { key: "vehicle", label: `Vehicle: ${query.vehicle}` } : null,
    query.assignment ? { key: "assignment", label: `Assignment: ${query.assignment}` } : null,
    query.location ? { key: "location", label: `Location: ${query.location}` } : null,
    query.inspection ? { key: "inspection", label: `Inspection: ${SCHEDULE_LABELS[query.inspection]}` } : null,
    query.service ? { key: "service", label: `Service: ${SCHEDULE_LABELS[query.service]}` } : null,
    query.issues ? { key: "issues", label: `Issues: ${query.issues === "open" ? "Has Open Issues" : "No Open Issues"}` } : null,
  ].filter((chip): chip is { key: AdvancedFilterKey; label: string } => chip !== null);
  const inventoryQueryString = serializeInventoryQuery(query).toString();
  const vehicleHref = (vehicleId: string) =>
    `/fleet-management/${vehicleId}${inventoryQueryString ? `?${inventoryQueryString}` : ""}`;

  async function saveVehicle() {
    if (!form.unitNumber.trim()) {
      setError("Unit number is required.");
      return;
    }
    if (editingVehicleId && !form.reason.trim()) {
      setError("Enter a reason for this vehicle update.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/fleet/vehicles", {
        method: editingVehicleId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(editingVehicleId ? { ...form, id: editingVehicleId } : form),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const wasEditing = Boolean(editingVehicleId);
      closeForm(true);
      setMessage(wasEditing
        ? "Vehicle changes saved and recorded in the audit log."
        : "Vehicle added and recorded in the audit log.");
      await loadFleet();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The vehicle could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateVehicleStatus(vehicle: FleetVehicle, status: FleetStatus) {
    if (status === vehicle.status) return;
    const reason = window.prompt(
      `Why is Unit ${vehicle.unit_number} being changed to ${status}?`,
    )?.trim();
    if (!reason) return;

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/fleet/vehicles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id: vehicle.id, status, reason }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setMessage(`Unit ${vehicle.unit_number} status updated and audited.`);
      await loadFleet();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Vehicle status could not be updated.",
      );
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500";

  return (
    <TracePointShell activePage="Fleet Management">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-400">
                Assets & Fleet
              </p>
              <h1 className="mt-1 text-2xl font-bold text-white">Fleet Management</h1>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
                Maintain vehicle inventory, assignment, mileage, service dates,
                open issues, and current operational availability.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canManage ? (
                <button
                  type="button"
                  onClick={openCreateForm}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500"
                >
                  <Plus size={15} /> Add Vehicle
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void loadFleet()}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white disabled:opacity-50"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
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
        {message ? (
          <div className="rounded-2xl border border-emerald-700 bg-emerald-950/30 p-4 text-sm text-emerald-200">
            {message}
          </div>
        ) : null}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard label="Fleet" value={summary.total} detail="Active vehicle records" />
          <SummaryCard
            label="Available"
            value={summary.available}
            detail="Ready for operational use"
            tone="green"
          />
          <SummaryCard
            label="Needs Attention"
            value={summary.attention}
            detail="Available with follow-up required"
            tone={summary.attention > 0 ? "amber" : "slate"}
          />
          <SummaryCard
            label="Unavailable"
            value={summary.unavailable}
            detail="Maintenance or out of service"
            tone={summary.unavailable > 0 ? "red" : "slate"}
          />
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
          <div className="border-b border-slate-800 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-bold text-white">Vehicle Inventory</h2>
                <p className="mt-1 text-[11px] text-slate-500">
                  Current status is authoritative until automated inspection rules are enabled.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                <div className="relative min-w-0 sm:min-w-[280px]">
                  <Search size={14} className="absolute left-3 top-2.5 text-slate-600" />
                  <input
                    value={query.search}
                    onChange={(event) => updateQuery({ search: event.target.value })}
                    aria-label="Search vehicle inventory"
                    placeholder="Search unit, plate, make, assignment..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-xs text-white outline-none focus:border-blue-500"
                  />
                </div>
                <select
                  value={query.status}
                  onChange={(event) => updateQuery({ status: event.target.value as "All" | FleetStatus })}
                  aria-label="Filter by status"
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500"
                >
                  <option value="All">All statuses</option>
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowFilters((visible) => !visible)}
                  aria-expanded={showFilters}
                  aria-controls="fleet-inventory-filters"
                  className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${activeFilterCount > 0 || showFilters ? "border-blue-500/40 bg-blue-500/10 text-blue-200" : "border-slate-700 text-slate-400 hover:text-white"}`}
                >
                  <SlidersHorizontal size={14} />
                  Filters
                  {activeFilterCount > 0 ? (
                    <span className="rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[9px]" aria-label={`${activeFilterCount} active filters`}>
                      {activeFilterCount}
                    </span>
                  ) : null}
                </button>
              </div>
            </div>

            {showFilters ? (
              <div id="fleet-inventory-filters" className="mt-3 grid gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Vehicle details or type">
                  <input
                    value={query.vehicle}
                    onChange={(event) => updateQuery({ vehicle: event.target.value })}
                    placeholder="Year, make, model, or type"
                    className={inputClass}
                  />
                </Field>
                <Field label="Assignment type">
                  <select
                    value={query.assignment}
                    onChange={(event) => updateQuery({ assignment: event.target.value as "" | AssignmentType })}
                    className={inputClass}
                  >
                    <option value="">Any assignment</option>
                    {ASSIGNMENT_TYPES.map((assignment) => <option key={assignment}>{assignment}</option>)}
                  </select>
                </Field>
                <Field label="Location">
                  <select
                    value={query.location}
                    onChange={(event) => updateQuery({ location: event.target.value })}
                    className={inputClass}
                  >
                    <option value="">Any location</option>
                    {locations.map((location) => <option key={location}>{location}</option>)}
                  </select>
                </Field>
                <Field label="Inspection state">
                  <select
                    value={query.inspection}
                    onChange={(event) => updateQuery({ inspection: event.target.value as "" | ScheduleState })}
                    className={inputClass}
                  >
                    <option value="">Any inspection state</option>
                    {Object.entries(SCHEDULE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field label="Service state">
                  <select
                    value={query.service}
                    onChange={(event) => updateQuery({ service: event.target.value as "" | ScheduleState })}
                    className={inputClass}
                  >
                    <option value="">Any service state</option>
                    {Object.entries(SCHEDULE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field label="Issues">
                  <select
                    value={query.issues}
                    onChange={(event) => updateQuery({ issues: event.target.value as InventoryQueryState["issues"] })}
                    className={inputClass}
                  >
                    <option value="">Any</option>
                    <option value="open">Has Open Issues</option>
                    <option value="none">No Open Issues</option>
                  </select>
                </Field>
              </div>
            ) : null}

            {activeFilterChips.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Active inventory filters">
                {activeFilterChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => removeAdvancedFilter(chip.key)}
                    aria-label={`Remove ${chip.label} filter`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold text-blue-200 hover:border-blue-400/60"
                  >
                    {chip.label} <X size={11} aria-hidden="true" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => replaceQuery(clearAdvancedFilters(query))}
                  className="px-1 py-1 text-[10px] font-semibold text-slate-500 hover:text-white"
                >
                  Clear all
                </button>
              </div>
            ) : null}
          </div>

          {loading ? (
            <div className="flex min-h-[280px] items-center justify-center">
              <RefreshCw size={24} className="animate-spin text-blue-300" />
            </div>
          ) : filteredVehicles.length === 0 ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center p-8 text-center">
              <Car size={38} className="text-slate-600" />
              <p className="mt-3 font-semibold text-white">
                {vehicles.length === 0 ? "No vehicles have been added" : "No matching vehicles"}
              </p>
              <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">
                {vehicles.length === 0
                  ? "Add the department fleet to begin tracking availability, mileage, assignments, service dates, and open issues."
                  : "Adjust the search or filters to see additional records."}
              </p>
              {vehicles.length === 0 && canManage ? (
                <button
                  type="button"
                  onClick={openCreateForm}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
                >
                  <Plus size={14} /> Add First Vehicle
                </button>
              ) : null}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1260px] text-left">
                <thead className="border-b border-slate-800 bg-slate-950/40">
                  <tr className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <SortableHeader column="unit" label="Unit" query={query} onSort={sortBy} />
                    <SortableHeader column="vehicle" label="Vehicle" query={query} onSort={sortBy} />
                    <SortableHeader column="assignment" label="Assignment" query={query} onSort={sortBy} />
                    <SortableHeader column="mileage" label="Mileage" query={query} onSort={sortBy} />
                    <SortableHeader column="inspection" label="Inspection" query={query} onSort={sortBy} />
                    <SortableHeader column="service" label="Next Service" query={query} onSort={sortBy} />
                    <SortableHeader column="issues" label="Issues" query={query} onSort={sortBy} />
                    <SortableHeader column="status" label="Status" query={query} onSort={sortBy} />
                    <th className="px-4 py-3" aria-label="Vehicle actions" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredVehicles.map((vehicle) => {
                    const vehicleInspectionState = inspectionState(vehicle.inspection_due_date);
                    const vehicleServiceState = serviceState(vehicle);
                    const openIssueCount = vehicle.open_issue_count ?? 0;
                    const href = vehicleHref(vehicle.id);
                    return (
                      <tr
                        key={vehicle.id}
                        role="link"
                        tabIndex={0}
                        onClick={() => router.push(href)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            router.push(href);
                          }
                        }}
                        className="group cursor-pointer align-top transition hover:bg-slate-950/60 focus:bg-slate-950/60 focus:outline-none"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={href}
                            className="text-sm font-bold text-white hover:text-blue-300"
                          >
                            Unit {vehicle.unit_number}
                          </Link>
                          <p className="mt-1 text-[10px] text-slate-500">
                            {vehicle.license_plate || "No plate recorded"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs font-semibold text-slate-300">
                            {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle details pending"}
                          </p>
                          <p className="mt-1 text-[10px] text-slate-500">
                            {vehicle.vehicle_type || "Unclassified"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs text-slate-300">{vehicle.assigned_to || vehicle.assignment_type}</p>
                          <p className="mt-1 text-[10px] text-slate-500">{vehicle.home_location || "No location"}</p>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-300">
                          <div>{formatMileage(vehicle.current_mileage)}</div>
                          <div className="mt-1 text-[10px] text-slate-500">
                            {(vehicle.current_hours ?? 0).toLocaleString("en-US")} hrs
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className={`text-xs ${vehicleInspectionState === "overdue" ? "font-semibold text-red-300" : vehicleInspectionState === "due-soon" ? "font-semibold text-amber-300" : "text-slate-400"}`}>
                            {formatDate(vehicle.inspection_due_date)}
                          </p>
                          {vehicleInspectionState === "overdue" ? <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-red-400">Overdue</p> : null}
                          {vehicleInspectionState === "due-soon" ? <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-amber-400">Due soon</p> : null}
                          {vehicleInspectionState === "not-scheduled" ? <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-slate-600">Not scheduled</p> : null}
                        </td>
                        <td className="px-4 py-3">
                          <p className={`text-xs ${vehicleServiceState === "overdue" ? "font-semibold text-red-300" : vehicleServiceState === "due-soon" ? "font-semibold text-amber-300" : "text-slate-400"}`}>
                            {formatDate(vehicle.next_service_date)}
                          </p>
                          <p className="mt-1 text-[10px] text-slate-500">
                            {vehicle.next_service_mileage ? `or ${formatMileage(vehicle.next_service_mileage)}` : "No mileage interval"}
                          </p>
                          {vehicleServiceState === "overdue" ? <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-red-400">Overdue</p> : null}
                          {vehicleServiceState === "due-soon" ? <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-amber-400">Due soon</p> : null}
                          {vehicleServiceState === "not-scheduled" ? <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-slate-600">Not scheduled</p> : null}
                        </td>
                        <td className="px-4 py-3">
                          <span className={openIssueCount > 0 ? "inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-amber-300" : "text-xs text-slate-500"}>
                            {openIssueCount > 0 ? `${openIssueCount} open` : "None"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {canManage ? (
                            <select
                              value={vehicle.status}
                              disabled={saving}
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => event.stopPropagation()}
                              onChange={(event) =>
                                void updateVehicleStatus(vehicle, event.target.value as FleetStatus)
                              }
                              className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide outline-none ${statusClasses(vehicle.status)}`}
                            >
                              {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                            </select>
                          ) : (
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide ${statusClasses(vehicle.status)}`}>
                              {vehicle.status}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            {canManage ? (
                              <button
                                type="button"
                                onClick={(event) => { event.stopPropagation(); openEditForm(vehicle); }}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 transition hover:border-blue-500/40 hover:text-blue-300"
                              >
                                <Pencil size={12} /> Edit
                              </button>
                            ) : null}
                            <Link
                              href={href}
                              onClick={(event) => event.stopPropagation()}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 transition group-hover:border-blue-500/40 group-hover:text-blue-300"
                            >
                              Open <ChevronRight size={13} />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <QrCode size={19} className="text-blue-300" />
            <h2 className="mt-3 text-sm font-bold text-white">QR vehicle access</h2>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Planned next: scan a unit to open its mobile inspection, equipment checklist, and history.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <ClipboardCheck size={19} className="text-blue-300" />
            <h2 className="mt-3 text-sm font-bold text-white">Readiness automation</h2>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Planned next: evaluate agency rules and automatically restrict vehicles with critical deficiencies.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <Wrench size={19} className="text-blue-300" />
            <h2 className="mt-3 text-sm font-bold text-white">Maintenance routing</h2>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Planned next: route defects, photos, and inspection context to the responsible fleet manager or mechanic.
            </p>
          </div>
        </section>

        {showForm ? (
          <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-4 backdrop-blur-sm sm:p-8">
            <div className="w-full max-w-3xl rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
                <div>
                  <h2 className="font-bold text-white">{editingVehicleId ? "Edit Fleet Vehicle" : "Add Fleet Vehicle"}</h2>
                  <p className="mt-1 text-[11px] text-slate-500">{editingVehicleId ? "Update this vehicle without replacing its history or linked records." : "Create the authoritative inventory record for this unit."}</p>
                </div>
                <button type="button" onClick={() => closeForm()} disabled={saving} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white disabled:opacity-50">
                  <X size={18} />
                </button>
              </div>
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <Field label="Unit Number"><input value={form.unitNumber} onChange={(event) => setForm({ ...form, unitNumber: event.target.value })} className={inputClass} placeholder="e.g. 3101" /></Field>
                <Field label="License Plate"><input value={form.licensePlate} onChange={(event) => setForm({ ...form, licensePlate: event.target.value })} className={inputClass} /></Field>
                <Field label="Year"><input type="number" value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })} className={inputClass} /></Field>
                <Field label="Make"><input value={form.make} onChange={(event) => setForm({ ...form, make: event.target.value })} className={inputClass} placeholder="Ford" /></Field>
                <Field label="Model"><input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} className={inputClass} placeholder="Police Interceptor Utility" /></Field>
                <Field label="Vehicle Type"><input value={form.vehicleType} onChange={(event) => setForm({ ...form, vehicleType: event.target.value })} className={inputClass} /></Field>
                <Field label="VIN" span><input value={form.vin} onChange={(event) => setForm({ ...form, vin: event.target.value.toUpperCase() })} className={inputClass} maxLength={17} /></Field>
                <Field label="Assignment Type"><select value={form.assignmentType} onChange={(event) => setForm({ ...form, assignmentType: event.target.value as AssignmentType })} className={inputClass}><option>Pool</option><option>Permanent</option><option>Specialized</option></select></Field>
                <Field label="Assigned To"><input value={form.assignedTo} onChange={(event) => setForm({ ...form, assignedTo: event.target.value })} className={inputClass} placeholder="Officer, unit, or function" /></Field>
                <Field label="Home Location"><input value={form.homeLocation} onChange={(event) => setForm({ ...form, homeLocation: event.target.value })} className={inputClass} placeholder="Headquarters" /></Field>
                <Field label="Current Mileage"><input type="number" min="0" value={form.currentMileage} onChange={(event) => setForm({ ...form, currentMileage: event.target.value })} className={inputClass} /></Field>
                <Field label="Current Hours"><input type="number" min="0" step="0.1" value={form.currentHours} onChange={(event) => setForm({ ...form, currentHours: event.target.value })} className={inputClass} /></Field>
                <Field label="Status"><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as FleetStatus })} className={inputClass}>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></Field>
                <Field label="Open Issues"><input type="number" min="0" value={form.openIssueCount} onChange={(event) => setForm({ ...form, openIssueCount: event.target.value })} className={inputClass} /></Field>
                <Field label="Inspection Due"><input type="date" value={form.inspectionDueDate} onChange={(event) => setForm({ ...form, inspectionDueDate: event.target.value })} className={inputClass} /></Field>
                <Field label="Registration Expires"><input type="date" value={form.registrationExpirationDate} onChange={(event) => setForm({ ...form, registrationExpirationDate: event.target.value })} className={inputClass} /></Field>
                <Field label="Insurance Expires"><input type="date" value={form.insuranceExpirationDate} onChange={(event) => setForm({ ...form, insuranceExpirationDate: event.target.value })} className={inputClass} /></Field>
                <Field label="In Service Date"><input type="date" value={form.inServiceDate} onChange={(event) => setForm({ ...form, inServiceDate: event.target.value })} className={inputClass} /></Field>
                <Field label="Last Service"><input type="date" value={form.lastServiceDate} onChange={(event) => setForm({ ...form, lastServiceDate: event.target.value })} className={inputClass} /></Field>
                <Field label="Last Service Mileage"><input type="number" min="0" value={form.lastServiceMileage} onChange={(event) => setForm({ ...form, lastServiceMileage: event.target.value })} className={inputClass} /></Field>
                <Field label="Last Service Hours"><input type="number" min="0" step="0.1" value={form.lastServiceHours} onChange={(event) => setForm({ ...form, lastServiceHours: event.target.value })} className={inputClass} /></Field>
                <Field label="Next Service Date"><input type="date" value={form.nextServiceDate} onChange={(event) => setForm({ ...form, nextServiceDate: event.target.value })} className={inputClass} /></Field>
                <Field label="Next Service Mileage"><input type="number" min="0" value={form.nextServiceMileage} onChange={(event) => setForm({ ...form, nextServiceMileage: event.target.value })} className={inputClass} /></Field>
                <Field label="Next Service Hours"><input type="number" min="0" step="0.1" value={form.nextServiceHours} onChange={(event) => setForm({ ...form, nextServiceHours: event.target.value })} className={inputClass} /></Field>
                <Field label="Operational Comments" span><textarea value={form.comments} onChange={(event) => setForm({ ...form, comments: event.target.value })} className={`${inputClass} min-h-20 resize-y`} /></Field>
                <Field label="Notes" span><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className={`${inputClass} min-h-24 resize-y`} /></Field>
                {editingVehicleId ? <Field label="Reason for Change" span><textarea required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} className={`${inputClass} min-h-20 resize-y`} placeholder="Explain why these vehicle details are changing." /></Field> : null}
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-4">
                <button type="button" onClick={() => closeForm()} disabled={saving} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white disabled:opacity-50">Cancel</button>
                <button type="button" onClick={() => void saveVehicle()} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
                  {saving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {editingVehicleId ? "Save Changes" : "Save Vehicle"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </TracePointShell>
  );
}

export default function FleetManagementPage() {
  return (
    <Suspense
      fallback={(
        <TracePointShell activePage="Fleet Management">
          <div className="flex h-72 items-center justify-center">
            <RefreshCw className="animate-spin text-blue-300" />
          </div>
        </TracePointShell>
      )}
    >
      <FleetManagementContent />
    </Suspense>
  );
}
