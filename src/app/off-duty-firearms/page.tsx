"use client";

import { useMemo, useState } from "react";
import TracePointShell from "@/components/TracePointShell";
import {
  ShieldCheck,
  AlertTriangle,
  Clock,
  Plus,
  Search,
  X,
  FileCheck,
  User,
  Crosshair,
  ClipboardCheck,
  CircleDot,
} from "lucide-react";

type AuthStatus = "Approved" | "Pending" | "Expiring Soon" | "Expired" | "Revoked";
type InspectionStatus = "Current" | "Due Soon" | "Overdue";
type ComplianceStatus = "Authorized" | "At Risk" | "Non-Compliant";

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

function KpiCard({ label, value, icon: Icon, color, sub }: { label: string; value: number; icon: React.ComponentType<{ size?: number; className?: string }>; color: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 transition-all duration-200 hover:-translate-y-[1px] hover:border-blue-500/40 hover:bg-slate-800/60">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</p>
        <Icon size={16} className={color} />
      </div>
      <p className={`text-3xl font-bold leading-none ${color}`}>{value}</p>
      <p className="mt-2 text-xs text-slate-500">{sub}</p>
    </div>
  );
}

export default function OffDutyFirearmsPage() {
  const [records, setRecords] = useState(initialRecords);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("Authorized Firearms");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filteredRecords = useMemo(() => {
    return records.filter((r) =>
      `${r.officer} ${r.badge} ${r.unit} ${r.firearm} ${r.serial}`
        .toLowerCase()
        .includes(query.toLowerCase())
    );
  }, [records, query]);

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

    setRecords([newRecord, ...records]);
    setDrawerOpen(false);
  }

  return (
    <TracePointShell activePage="Off-Duty Firearms">
      <div className="space-y-6">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">Off-Duty Firearms</h1>
                <p className="mt-1 text-sm text-slate-400">
                  Personal firearm approvals, inspections, qualifications, and status.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                  <span>Updated 2 min ago</span>
                  <span>·</span>
                  <span>{records.filter((r) => r.authStatus === "Pending").length} pending approvals</span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1.5 text-slate-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    System Healthy
                  </span>
                </div>
              </div>

              <button
                onClick={() => setDrawerOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                <Plus size={16} />
                Add Personal Firearm
              </button>
            </div>
        </header>

        <div className="space-y-6">
            <section className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {kpis.map((kpi) => (
                <KpiCard key={kpi.label} {...kpi} />
              ))}
            </section>

            <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-1.5">
              <div className="grid gap-1 md:grid-cols-5">
                {[
                  "Authorized Firearms",
                  "Pending Approvals",
                  "Expiring / Due",
                  "Qualification History",
                  "Policy Exceptions",
                ].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`rounded-xl px-4 py-3 text-sm font-medium transition ${
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

            <section className="mb-6 flex flex-wrap items-center gap-3">
              <div className="flex w-full max-w-xl items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 transition focus-within:border-blue-500/60">
                <Search size={18} className="text-slate-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search officer, badge, firearm, serial..."
                  className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
                />
              </div>
              <div className="ml-auto inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-500">
                <CircleDot size={12} />
                {filteredRecords.length} records
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-slate-800/70 text-xs uppercase tracking-[0.18em] text-slate-500">
                  <tr>
                    <th className="px-5 py-4">Officer</th>
                    <th className="px-5 py-4">Firearm</th>
                    <th className="px-5 py-4">Serial</th>
                    <th className="px-5 py-4">Caliber</th>
                    <th className="px-5 py-4">Authorization</th>
                    <th className="px-5 py-4">Expires</th>
                    <th className="px-5 py-4">Last Qual</th>
                    <th className="px-5 py-4">Inspection</th>
                    <th className="px-5 py-4">Compliance</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((record) => (
                    <tr
                      key={record.id}
                      className="border-t border-slate-800 transition hover:bg-slate-800/40"
                    >
                      <td className="px-5 py-4">
                        <div className="font-semibold text-white">{record.officer}</div>
                        <div className="text-xs text-slate-500">{record.badge} · {record.unit}</div>
                      </td>
                      <td className="px-5 py-4 text-slate-300">{record.firearm}</td>
                      <td className="px-5 py-4 font-medium text-slate-300">{record.serial}</td>
                      <td className="px-5 py-4 text-slate-300">{record.caliber}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(record.authStatus)}`}>
                          {record.authStatus}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-slate-300">{record.approvalExpires}</td>
                      <td className="px-5 py-4 text-slate-300">{record.lastQual}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(record.inspectionStatus)}`}>
                          {record.inspectionStatus}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(record.compliance)}`}>
                          {record.compliance}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
        </div>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
          <div className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-800 bg-slate-950 p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-400">Off-Duty Firearms</p>
                <h2 className="mt-1 text-2xl font-bold">Add Personal Firearm</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Create an off-duty / personally owned firearm authorization record.
                </p>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <div className="mb-4 flex items-center gap-2 font-semibold">
                  <User size={18} className="text-blue-400" />
                  Step 1 — Officer
                </div>
                <select className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-200">
                  <option>Select officer</option>
                  <option>Off. Martinez, Karen</option>
                  <option>Sgt. Rivera, Miguel</option>
                  <option>Off. Chen, David</option>
                </select>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <div className="mb-4 flex items-center gap-2 font-semibold">
                  <Crosshair size={18} className="text-blue-400" />
                  Step 2 — Firearm Details
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {["Make", "Model", "Serial Number", "Caliber", "Type", "Capacity"].map((field) => (
                    <input
                      key={field}
                      placeholder={field}
                      className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-500"
                    />
                  ))}
                </div>
                <textarea
                  placeholder="Optic, light, holster, or notes..."
                  className="mt-3 min-h-24 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-500"
                />
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <div className="mb-4 flex items-center gap-2 font-semibold">
                  <FileCheck size={18} className="text-blue-400" />
                  Step 3 — Documentation
                </div>
                <div className="space-y-3 text-sm text-slate-300">
                  <label className="flex items-center gap-3">
                    <input type="checkbox" />
                    Proof of ownership received
                  </label>
                  <label className="flex items-center gap-3">
                    <input type="checkbox" />
                    Qualification requirement reviewed
                  </label>
                  <label className="flex items-center gap-3">
                    <input type="checkbox" />
                    Inspection requirement reviewed
                  </label>
                  <label className="flex items-center gap-3">
                    <input type="checkbox" />
                    Policy acknowledgment completed
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <div className="mb-4 flex items-center gap-2 font-semibold">
                  <ShieldCheck size={18} className="text-blue-400" />
                  Step 4 — Approval
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    placeholder="Approving supervisor"
                    className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-500"
                  />
                  <select className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-200 focus:border-blue-500">
                    <option>Pending</option>
                    <option>Approved</option>
                    <option>Denied</option>
                  </select>
                  <input
                    type="date"
                    className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 outline-none focus:border-blue-500"
                  />
                  <input
                    type="date"
                    className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-end gap-3 border-t border-slate-800 pt-5">
              <button
                onClick={() => setDrawerOpen(false)}
                className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={addMockRecord}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-500"
              >
                Save Firearm
              </button>
            </div>
          </div>
        </div>
      )}
    </TracePointShell>
  );
}
