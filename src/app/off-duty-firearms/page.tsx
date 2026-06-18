"use client";

import { useMemo, useState, type ComponentType } from "react";
import TracePointShell from "@/components/TracePointShell";
import {
  AlertTriangle,
  CircleDot,
  ClipboardCheck,
  Clock,
  Crosshair,
  FileCheck,
  Plus,
  Search,
  ShieldCheck,
  User,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AuthStatus =
  | "Approved"
  | "Pending"
  | "Expiring Soon"
  | "Expired"
  | "Revoked";

type InspectionStatus = "Current" | "Due Soon" | "Overdue";

type ComplianceStatus = "Authorized" | "At Risk" | "Non-Compliant";

type OffDutyTab =
  | "Authorized Firearms"
  | "Pending Approvals"
  | "Expiring / Due"
  | "Qualification History"
  | "Policy Exceptions";

type OffDutyFirearm = {
  id: number;
  officer: string;
  badge: string;
  unit: string;
  firearm: string;
  serial: string;
  caliber: string;
  authStatus: AuthStatus;
  approvalDate: string;
  approvalExpires: string;
  lastQual: string;
  inspectionStatus: InspectionStatus;
  compliance: ComplianceStatus;
};

type KpiCardProps = {
  label: string;
  value: number;
  icon: ComponentType<{ size?: number; className?: string }>;
  color: string;
  sub: string;
};

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const initialRecords: OffDutyFirearm[] = [
  {
    id: 1,
    officer: "Sgt. Rivera, Miguel",
    badge: "#1142",
    unit: "Patrol A",
    firearm: "Glock 43X",
    serial: "PX93421",
    caliber: "9mm",
    authStatus: "Approved",
    approvalDate: "Jan 10, 2026",
    approvalExpires: "Jan 10, 2027",
    lastQual: "Mar 18, 2026",
    inspectionStatus: "Current",
    compliance: "Authorized",
  },
  {
    id: 2,
    officer: "Off. Chen, David",
    badge: "#3087",
    unit: "Patrol B",
    firearm: "Sig Sauer P365",
    serial: "365NJ8841",
    caliber: "9mm",
    authStatus: "Expiring Soon",
    approvalDate: "Jun 1, 2025",
    approvalExpires: "Jun 1, 2026",
    lastQual: "Oct 17, 2025",
    inspectionStatus: "Due Soon",
    compliance: "At Risk",
  },
  {
    id: 3,
    officer: "Det. Patel, Arun",
    badge: "#2201",
    unit: "CID",
    firearm: "S&W Shield Plus",
    serial: "SWP7721",
    caliber: "9mm",
    authStatus: "Pending",
    approvalDate: "Pending",
    approvalExpires: "Pending",
    lastQual: "Not recorded",
    inspectionStatus: "Overdue",
    compliance: "Non-Compliant",
  },
  {
    id: 4,
    officer: "Off. Torres, Lucia",
    badge: "#3312",
    unit: "Patrol C",
    firearm: "Glock 48 MOS",
    serial: "G48M2231",
    caliber: "9mm",
    authStatus: "Approved",
    approvalDate: "Feb 5, 2026",
    approvalExpires: "Feb 5, 2027",
    lastQual: "Mar 20, 2026",
    inspectionStatus: "Current",
    compliance: "Authorized",
  },
];

const TABS: OffDutyTab[] = [
  "Authorized Firearms",
  "Pending Approvals",
  "Expiring / Due",
  "Qualification History",
  "Policy Exceptions",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusClass(status: string) {
  switch (status) {
    case "Approved":
    case "Current":
    case "Authorized":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "Pending":
    case "Due Soon":
    case "At Risk":
    case "Expiring Soon":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "Expired":
    case "Revoked":
    case "Overdue":
    case "Non-Compliant":
      return "border-red-500/30 bg-red-500/10 text-red-300";
    default:
      return "border-slate-600 bg-slate-800 text-slate-300";
  }
}

function getInitials(name: string) {
  return name
    .replace(/Sgt\.|Off\.|Det\.|Lt\./g, "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function StatusBadge({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClass(
        value,
      )}`}
    >
      {value}
    </span>
  );
}

function KpiCard({ label, value, icon: Icon, color, sub }: KpiCardProps) {
  return (
    <div className="group cursor-default rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 transition-all duration-200 hover:-translate-y-px hover:border-blue-500/25 hover:bg-slate-800/70 hover:shadow-[0_2px_12px_rgba(0,0,0,0.3)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 transition-colors group-hover:text-slate-500">
          {label}
        </p>

        <Icon size={14} className={color} />
      </div>

      <p className={`mt-1 text-2xl font-bold leading-none ${color}`}>
        {value}
      </p>

      <p className="mt-0.5 text-[10px] text-slate-600">{sub}</p>
    </div>
  );
}

function matchesTab(record: OffDutyFirearm, tab: OffDutyTab) {
  switch (tab) {
    case "Authorized Firearms":
      return true;
    case "Pending Approvals":
      return record.authStatus === "Pending";
    case "Expiring / Due":
      return (
        record.authStatus === "Expiring Soon" ||
        record.authStatus === "Expired" ||
        record.inspectionStatus !== "Current"
      );
    case "Qualification History":
      return true;
    case "Policy Exceptions":
      return (
        record.compliance === "At Risk" ||
        record.compliance === "Non-Compliant" ||
        record.authStatus === "Revoked"
      );
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

function AddFirearmDrawer({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: () => void;
}) {
  const inputClass =
    "rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 transition focus:border-blue-500";

  const selectClass =
    "rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-blue-500";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 p-0 backdrop-blur-sm sm:p-4">
      <div className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-slate-800 bg-slate-950 shadow-2xl sm:rounded-2xl sm:border">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-400">
              Off-Duty Firearms
            </p>

            <h2 className="mt-1 text-xl font-bold text-white sm:text-2xl">
              Add Personal Firearm
            </h2>

            <p className="mt-1 text-[12px] leading-relaxed text-slate-400 sm:text-sm">
              Create an off-duty / personally owned firearm authorization
              record.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <User size={16} className="text-blue-400" />
              Step 1 — Officer
            </div>

            <select className={`${selectClass} w-full`}>
              <option>Select officer</option>
              <option>Off. Martinez, Karen</option>
              <option>Sgt. Rivera, Miguel</option>
              <option>Off. Chen, David</option>
            </select>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <Crosshair size={16} className="text-blue-400" />
              Step 2 — Firearm Details
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {["Make", "Model", "Serial Number", "Caliber", "Type", "Capacity"].map(
                (field) => (
                  <input key={field} placeholder={field} className={inputClass} />
                ),
              )}
            </div>

            <textarea
              placeholder="Optic, light, holster, or notes..."
              className={`${inputClass} mt-3 min-h-24 w-full resize-none`}
            />
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <FileCheck size={16} className="text-blue-400" />
              Step 3 — Documentation
            </div>

            <div className="space-y-3 text-sm text-slate-300">
              {[
                "Proof of ownership received",
                "Qualification requirement reviewed",
                "Inspection requirement reviewed",
                "Policy acknowledgment completed",
              ].map((label) => (
                <label
                  key={label}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-800 px-3 py-2 transition hover:border-slate-700 hover:bg-slate-800/40"
                >
                  <input type="checkbox" className="accent-blue-500" />
                  {label}
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck size={16} className="text-blue-400" />
              Step 4 — Approval
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input placeholder="Approving supervisor" className={inputClass} />

              <select className={selectClass}>
                <option>Pending</option>
                <option>Approved</option>
                <option>Denied</option>
              </select>

              <input
                type="date"
                className={inputClass}
                style={{ colorScheme: "dark" }}
              />

              <input
                type="date"
                className={inputClass}
                style={{ colorScheme: "dark" }}
              />
            </div>
          </section>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-800 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-300 transition hover:bg-slate-800"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onSave}
            className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            Save Firearm
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function OffDutyFirearmsPage() {
  const [records, setRecords] = useState(initialRecords);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<OffDutyTab>("Authorized Firearms");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filteredRecords = useMemo(() => {
    const q = query.trim().toLowerCase();

    return records.filter((record) => {
      const haystack = [
        record.officer,
        record.badge,
        record.unit,
        record.firearm,
        record.serial,
        record.caliber,
        record.authStatus,
        record.inspectionStatus,
        record.compliance,
      ]
        .join(" ")
        .toLowerCase();

      return (!q || haystack.includes(q)) && matchesTab(record, activeTab);
    });
  }, [records, query, activeTab]);

  const kpis = [
    {
      label: "Authorized",
      value: records.filter((r) => r.authStatus === "Approved").length,
      icon: ShieldCheck,
      color: "text-emerald-300",
      sub: "Approved firearms",
    },
    {
      label: "Pending",
      value: records.filter((r) => r.authStatus === "Pending").length,
      icon: Clock,
      color: "text-amber-300",
      sub: "Awaiting review",
    },
    {
      label: "Expiring Soon",
      value: records.filter((r) => r.authStatus === "Expiring Soon").length,
      icon: AlertTriangle,
      color: "text-amber-300",
      sub: "Approval window",
    },
    {
      label: "Inspection Due",
      value: records.filter((r) => r.inspectionStatus !== "Current").length,
      icon: ClipboardCheck,
      color: "text-red-300",
      sub: "Due or overdue",
    },
    {
      label: "Exceptions",
      value: records.filter((r) => r.compliance === "Non-Compliant").length,
      icon: AlertTriangle,
      color: "text-red-300",
      sub: "Non-compliant",
    },
  ];

  function addMockRecord() {
    const newRecord: OffDutyFirearm = {
      id: records.length + 1,
      officer: "Off. Martinez, Karen",
      badge: "#3091",
      unit: "Patrol C",
      firearm: "Glock 43",
      serial: "G43NEW2026",
      caliber: "9mm",
      authStatus: "Pending",
      approvalDate: "Pending",
      approvalExpires: "Pending",
      lastQual: "Pending",
      inspectionStatus: "Due Soon",
      compliance: "At Risk",
    };

    setRecords((current) => [newRecord, ...current]);
    setDrawerOpen(false);
    setActiveTab("Pending Approvals");
  }

  return (
    <TracePointShell activePage="Off-Duty Firearms">
      {drawerOpen && (
        <AddFirearmDrawer
          onClose={() => setDrawerOpen(false)}
          onSave={addMockRecord}
        />
      )}

      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-[20px] font-bold leading-tight text-white sm:text-[22px]">
                Off-Duty Firearms
              </h1>

              <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-slate-500">
                Personal firearm approvals, inspections, qualifications, and
                policy compliance status.
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-slate-700">
                <span>Updated 2 min ago</span>
                <span className="hidden text-slate-800 sm:inline">·</span>
                <span>
                  {records.filter((r) => r.authStatus === "Pending").length}{" "}
                  pending approvals
                </span>
                <span className="hidden text-slate-800 sm:inline">·</span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/80" />
                  System Healthy
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-500 sm:w-fit"
            >
              <Plus size={14} />
              Add Personal Firearm
            </button>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} {...kpi} />
          ))}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-1.5">
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-5">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-xl px-3 py-2.5 text-[12px] font-medium transition sm:text-[13px] ${
                  activeTab === tab
                    ? "bg-blue-600/90 text-white shadow-sm"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-xl">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />

              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search officer, badge, firearm, serial..."
                className="w-full rounded-xl border border-slate-800 bg-slate-950/60 py-2.5 pl-9 pr-3 text-[13px] text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-blue-500/60"
              />
            </div>

            <div className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-[12px] text-slate-500 lg:w-fit">
              <CircleDot size={12} />
              {filteredRecords.length} records
            </div>
          </div>
        </section>

        {/* Mobile / tablet card list */}
        <section className="space-y-2 xl:hidden">
          {filteredRecords.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-10 text-center text-[13px] text-slate-600">
              No off-duty firearm records match your current view.
            </div>
          ) : (
            filteredRecords.map((record) => (
              <article
                key={record.id}
                className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-semibold text-slate-400">
                      {getInitials(record.officer)}
                    </div>

                    <div className="min-w-0">
                      <h3 className="truncate text-[14px] font-semibold text-white">
                        {record.officer}
                      </h3>

                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {record.badge} · {record.unit}
                      </p>
                    </div>
                  </div>

                  <StatusBadge value={record.authStatus} />
                </div>

                <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-700">
                    Firearm
                  </p>

                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-slate-300">
                      {record.firearm}
                    </span>

                    <span className="font-mono text-[10px] text-slate-500">
                      {record.serial}
                    </span>
                  </div>

                  <p className="mt-1 text-[11px] text-slate-600">
                    {record.caliber}
                  </p>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-700">
                      Expires
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {record.approvalExpires}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-700">
                      Last Qual
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {record.lastQual}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusBadge value={record.inspectionStatus} />
                  <StatusBadge value={record.compliance} />
                </div>
              </article>
            ))
          )}
        </section>

        {/* Desktop table */}
        <section className="hidden overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 xl:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-left">
              <thead className="bg-slate-900/80">
                <tr>
                  {[
                    "Officer",
                    "Firearm",
                    "Serial",
                    "Caliber",
                    "Authorization",
                    "Expires",
                    "Last Qual",
                    "Inspection",
                    "Compliance",
                  ].map((col) => (
                    <th
                      key={col}
                      className="border-b border-slate-800 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-slate-600"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-800/60">
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-12 text-center text-[13px] text-slate-600"
                    >
                      No off-duty firearm records match your current view.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((record) => (
                    <tr
                      key={record.id}
                      className="group cursor-pointer transition-colors duration-100 hover:bg-slate-800/50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-[9px] font-semibold text-slate-400">
                            {getInitials(record.officer)}
                          </div>

                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-semibold text-white">
                              {record.officer}
                            </div>

                            <div className="text-[10px] text-slate-500">
                              {record.badge} · {record.unit}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-[12px] text-slate-300">
                        {record.firearm}
                      </td>

                      <td className="px-4 py-3 font-mono text-[11px] text-slate-400">
                        {record.serial}
                      </td>

                      <td className="px-4 py-3 text-[12px] text-slate-400">
                        {record.caliber}
                      </td>

                      <td className="px-4 py-3">
                        <StatusBadge value={record.authStatus} />
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-[12px] text-slate-400">
                        {record.approvalExpires}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-[12px] text-slate-400">
                        {record.lastQual}
                      </td>

                      <td className="px-4 py-3">
                        <StatusBadge value={record.inspectionStatus} />
                      </td>

                      <td className="px-4 py-3">
                        <StatusBadge value={record.compliance} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-900/60 px-4 py-2.5 text-[11px] text-slate-600">
            <span>
              {filteredRecords.length === records.length
                ? `Showing all ${records.length} records`
                : `${filteredRecords.length} of ${records.length} records`}
            </span>

            <div className="flex items-center gap-1">
              {["‹", "1", "›"].map((page, index) => (
                <button
                  key={`${page}-${index}`}
                  type="button"
                  className={`flex h-[26px] w-[26px] items-center justify-center rounded-lg border text-[11px] transition-colors ${
                    page === "1"
                      ? "border-blue-500 bg-blue-500 text-white"
                      : "border-slate-800 bg-transparent text-slate-600 hover:border-slate-700 hover:text-slate-300"
                  }`}
                >
                  {page}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </TracePointShell>
  );
}