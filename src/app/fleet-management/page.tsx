"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Car,
  ChevronRight,
  CheckCircle2,
  ClipboardCheck,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Wrench,
  X,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";

type FleetStatus =
  | "Available"
  | "Attention"
  | "Maintenance"
  | "Out of Service"
  | "Retired";

type AssignmentType = "Pool" | "Permanent" | "Specialized";

type FleetVehicle = {
  id: string;
  unit_number: string;
  vin: string | null;
  license_plate: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vehicle_type: string | null;
  assignment_type: AssignmentType;
  assigned_to: string | null;
  home_location: string | null;
  current_mileage: number;
  current_hours: number;
  status: FleetStatus;
  inspection_due_date: string | null;
  registration_expiration_date: string | null;
  last_service_date: string | null;
  next_service_date: string | null;
  next_service_mileage: number | null;
  open_issue_count: number;
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
  lastServiceDate: string;
  nextServiceDate: string;
  nextServiceMileage: string;
  openIssueCount: string;
  notes: string;
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
  lastServiceDate: "",
  nextServiceDate: "",
  nextServiceMileage: "",
  openIssueCount: "0",
  notes: "",
};

const STATUSES: FleetStatus[] = [
  "Available",
  "Attention",
  "Maintenance",
  "Out of Service",
  "Retired",
];

const PREVIEW_VEHICLE: FleetVehicle = {
  id: "preview", unit_number: "3101", vin: "1FM5K8AR0NGA00001",
  license_plate: "MG-3101", year: 2025, make: "Ford",
  model: "Police Interceptor Utility", vehicle_type: "Patrol",
  assignment_type: "Pool", assigned_to: "Patrol Division",
  home_location: "Headquarters", current_mileage: 18422,
  current_hours: 2167.4, status: "Attention", inspection_due_date: "2026-09-12",
  registration_expiration_date: "2027-01-31", last_service_date: "2026-07-20",
  next_service_date: "2026-09-05", next_service_mileage: 20000,
  open_issue_count: 1, notes: "Local preview vehicle", updated_at: new Date().toISOString(),
};

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

function dateState(value: string | null) {
  if (!value) return "none" as const;
  const due = new Date(`${value}T23:59:59`);
  if (Number.isNaN(due.getTime())) return "none" as const;
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "overdue" as const;
  if (days <= 30) return "due-soon" as const;
  return "current" as const;
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

export default function FleetManagementPage() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | FleetStatus>("All");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<VehicleForm>(EMPTY_FORM);

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

  const filteredVehicles = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      if (statusFilter !== "All" && vehicle.status !== statusFilter) return false;
      if (!normalized) return true;
      return [
        vehicle.unit_number,
        vehicle.vin,
        vehicle.license_plate,
        vehicle.year,
        vehicle.make,
        vehicle.model,
        vehicle.vehicle_type,
        vehicle.assignment_type,
        vehicle.assigned_to,
        vehicle.home_location,
        vehicle.status,
      ]
        .filter((value) => value !== null && value !== undefined)
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [search, statusFilter, vehicles]);

  async function saveVehicle() {
    if (!form.unitNumber.trim()) {
      setError("Unit number is required.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/fleet/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(form),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setForm(EMPTY_FORM);
      setShowForm(false);
      setMessage("Vehicle added and recorded in the audit log.");
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
                  onClick={() => setShowForm(true)}
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
          <div className="flex flex-col gap-3 border-b border-slate-800 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-sm font-bold text-white">Vehicle Inventory</h2>
              <p className="mt-1 text-[11px] text-slate-500">
                Current status is authoritative until automated inspection rules are enabled.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-2.5 text-slate-600" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search unit, plate, make, assignment..."
                  className="min-w-[280px] rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-xs text-white outline-none focus:border-blue-500"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as "All" | FleetStatus)
                }
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500"
              >
                <option value="All">All statuses</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>
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
                  : "Adjust the search or status filter to see additional records."}
              </p>
              {vehicles.length === 0 && canManage ? (
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
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
                    <th className="px-4 py-3">Unit</th>
                    <th className="px-4 py-3">Vehicle</th>
                    <th className="px-4 py-3">Assignment</th>
                    <th className="px-4 py-3">Mileage</th>
                    <th className="px-4 py-3">Inspection</th>
                    <th className="px-4 py-3">Next Service</th>
                    <th className="px-4 py-3">Issues</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3"><span className="sr-only">Open vehicle</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredVehicles.map((vehicle) => {
                    const inspectionState = dateState(vehicle.inspection_due_date);
                    const serviceState = dateState(vehicle.next_service_date);
                    return (
                      <tr
                        key={vehicle.id}
                        role="link"
                        tabIndex={0}
                        onClick={() => router.push(`/fleet-management/${vehicle.id}`)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            router.push(`/fleet-management/${vehicle.id}`);
                          }
                        }}
                        className="group cursor-pointer align-top transition hover:bg-slate-950/60 focus:bg-slate-950/60 focus:outline-none"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/fleet-management/${vehicle.id}`}
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
                          <p className={`text-xs ${inspectionState === "overdue" ? "font-semibold text-red-300" : inspectionState === "due-soon" ? "font-semibold text-amber-300" : "text-slate-400"}`}>
                            {formatDate(vehicle.inspection_due_date)}
                          </p>
                          {inspectionState === "overdue" ? <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-red-400">Overdue</p> : null}
                          {inspectionState === "due-soon" ? <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-amber-400">Due soon</p> : null}
                        </td>
                        <td className="px-4 py-3">
                          <p className={`text-xs ${serviceState === "overdue" ? "font-semibold text-red-300" : serviceState === "due-soon" ? "font-semibold text-amber-300" : "text-slate-400"}`}>
                            {formatDate(vehicle.next_service_date)}
                          </p>
                          <p className="mt-1 text-[10px] text-slate-500">
                            {vehicle.next_service_mileage ? `or ${formatMileage(vehicle.next_service_mileage)}` : "No mileage interval"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={vehicle.open_issue_count > 0 ? "inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-amber-300" : "text-xs text-slate-500"}>
                            {vehicle.open_issue_count > 0 ? `${vehicle.open_issue_count} open` : "None"}
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
                          <Link
                            href={`/fleet-management/${vehicle.id}`}
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 transition group-hover:border-blue-500/40 group-hover:text-blue-300"
                          >
                            Open <ChevronRight size={13} />
                          </Link>
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
                  <h2 className="font-bold text-white">Add Fleet Vehicle</h2>
                  <p className="mt-1 text-[11px] text-slate-500">Create the authoritative inventory record for this unit.</p>
                </div>
                <button type="button" onClick={() => setShowForm(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white">
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
                <Field label="Last Service"><input type="date" value={form.lastServiceDate} onChange={(event) => setForm({ ...form, lastServiceDate: event.target.value })} className={inputClass} /></Field>
                <Field label="Next Service Date"><input type="date" value={form.nextServiceDate} onChange={(event) => setForm({ ...form, nextServiceDate: event.target.value })} className={inputClass} /></Field>
                <Field label="Next Service Mileage"><input type="number" min="0" value={form.nextServiceMileage} onChange={(event) => setForm({ ...form, nextServiceMileage: event.target.value })} className={inputClass} /></Field>
                <Field label="Notes" span><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className={`${inputClass} min-h-24 resize-y`} /></Field>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-4">
                <button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white">Cancel</button>
                <button type="button" onClick={() => void saveVehicle()} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
                  {saving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Save Vehicle
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </TracePointShell>
  );
}
