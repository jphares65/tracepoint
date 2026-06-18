"use client";

import { useState } from "react";
import TracePointShell from "@/components/TracePointShell";
import {
  Building2,
  Users,
  ShieldCheck,
  Palette,
  Lock,
  Save,
  UserPlus,
  Upload,
  CheckCircle2,
  FileText,
  Settings,
} from "lucide-react";

type TabId = "agency" | "users" | "rules" | "branding" | "audit";

const tabs = [
  { id: "agency", label: "Agency Profile", icon: Building2 },
  { id: "users", label: "Users & Roles", icon: Users },
  { id: "rules", label: "Rules Engine", icon: Settings },
  { id: "branding", label: "Branding", icon: Palette },
  { id: "audit", label: "Audit & Security", icon: Lock },
] as const;

function StatusPill({
  label,
  tone = "green",
}: {
  label: string;
  tone?: "green" | "blue" | "amber" | "red" | "slate";
}) {
  const styles = {
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    red: "border-red-500/30 bg-red-500/10 text-red-300",
    slate: "border-slate-700 bg-slate-800 text-slate-300",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${styles[tone]}`}
    >
      {label}
    </span>
  );
}

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {description && (
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-medium text-slate-200">
        {value}
      </p>
    </div>
  );
}

export default function AdminSettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("agency");

  const users = [
    {
      name: "Jason Phares",
      role: "System Admin",
      status: "Active",
      lastActive: "Today",
      mfa: "Enabled",
    },
    {
      name: "Sgt. Rivera",
      role: "Range Master",
      status: "Active",
      lastActive: "Yesterday",
      mfa: "Enabled",
    },
    {
      name: "Lt. Brooks",
      role: "Command Staff",
      status: "Active",
      lastActive: "2 days ago",
      mfa: "Enabled",
    },
    {
      name: "Armorer Account",
      role: "Armorer",
      status: "Pending",
      lastActive: "Never",
      mfa: "Required",
    },
  ];

  const rules = [
    {
      title: "Qualification Cycle",
      detail: "Spring: Apr 1 – Jun 30 • Fall: Sep 1 – Nov 30",
      status: "Active",
    },
    {
      title: "Rifle Familiarization",
      detail: "Required once per cycle and separate from rifle qualification.",
      status: "Active",
    },
    {
      title: "Inspection Interval",
      detail: "Standard firearm inspection required every 180 days.",
      status: "Active",
    },
    {
      title: "Battery Checks",
      detail: "RMR and weapon light checks required every 180 days.",
      status: "Active",
    },
    {
      title: "Off-Duty Firearms",
      detail: "Annual approval and qualification required before authorization.",
      status: "Active",
    },
  ];

  return (
    <TracePointShell activePage="Settings">
      <div className="w-full min-w-0 space-y-6">
        <header className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold leading-tight text-white">
              Admin Settings
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              Agency configuration, user access, rules, branding, and system
              controls.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
              <span>Updated 2 min ago</span>
              <span>·</span>
              <span>Agency profile active</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1.5 text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                System Healthy
              </span>
            </div>
          </div>

          <button className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 sm:w-auto">
            <Save size={15} />
            Save Settings
          </button>
        </header>

        <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 p-1.5">
          <div className="grid grid-cols-5 gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex min-w-0 items-center justify-center gap-2 rounded-2xl px-2 py-3 text-sm font-medium transition sm:px-3 ${
                    active
                      ? "bg-blue-600/20 text-blue-300"
                      : "text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                  }`}
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="hidden truncate sm:inline">
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {activeTab === "agency" && (
          <div className="grid min-w-0 gap-4 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <SettingsCard
                title="Agency Profile"
                description="Current agency configuration. These values should remain configurable for future jurisdiction support."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Agency Name" value="Readington PD" />
                  <Field label="State" value="New Jersey" />
                  <Field label="County" value="Hunterdon" />
                  <Field
                    label="Agency Type"
                    value="Municipal Police Department"
                  />
                  <Field label="Sworn Officers" value="34" />
                  <Field label="Civilian Staff" value="2" />
                  <Field label="Time Zone" value="Eastern" />
                  <Field label="Primary Contact" value="Administrator" />
                </div>

                <button className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 sm:w-auto">
                  <Save size={15} />
                  Save Agency Profile
                </button>
              </SettingsCard>
            </div>

            <SettingsCard
              title="Configuration Status"
              description="Agency profile and system settings readiness."
            >
              <div className="space-y-3">
                {[
                  ["Agency Profile", "Complete"],
                  ["Rules Engine", "Active"],
                  ["Branding", "Configured"],
                  ["Security", "Enabled"],
                ].map(([label, status]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3"
                  >
                    <span className="text-sm text-slate-400">{label}</span>
                    <StatusPill label={status} />
                  </div>
                ))}
              </div>
            </SettingsCard>
          </div>
        )}

        {activeTab === "users" && (
          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {[
                "System Admin",
                "Command Staff",
                "Armorer",
                "Range Master",
                "Supervisor",
                "Viewer",
              ].map((role) => (
                <div
                  key={role}
                  className="rounded-3xl border border-slate-800 bg-slate-900 p-4"
                >
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">
                    Role
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-200">
                    {role}
                  </p>
                </div>
              ))}
            </div>

            <SettingsCard title="Users & Roles">
              <div className="mb-4 flex justify-end">
                <button className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 sm:w-auto">
                  <UserPlus size={15} />
                  Invite User
                </button>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-800">
                <table className="min-w-[720px] w-full border-collapse text-left text-sm">
                  <thead className="bg-slate-950/70 text-[10px] uppercase tracking-widest text-slate-600">
                    <tr>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Last Active</th>
                      <th className="px-4 py-3">MFA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {users.map((user) => (
                      <tr
                        key={user.name}
                        className="transition hover:bg-slate-800/50"
                      >
                        <td className="px-4 py-3 font-medium text-white">
                          {user.name}
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {user.role}
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill
                            label={user.status}
                            tone={user.status === "Pending" ? "amber" : "green"}
                          />
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {user.lastActive}
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill
                            label={user.mfa}
                            tone={user.mfa === "Required" ? "amber" : "blue"}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SettingsCard>
          </div>
        )}

        {activeTab === "rules" && (
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            {rules.map((rule) => (
              <SettingsCard key={rule.title} title={rule.title}>
                <p className="text-sm leading-6 text-slate-400">
                  {rule.detail}
                </p>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <StatusPill label={rule.status} />
                  <button className="rounded-xl border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:border-blue-500/50 hover:text-white">
                    Edit Rule
                  </button>
                </div>
              </SettingsCard>
            ))}
          </div>
        )}

        {activeTab === "branding" && (
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <SettingsCard
              title="TracePoint Branding"
              description="Platform branding and agency display settings."
            >
              <div className="space-y-3">
                <Field label="Agency Display Name" value="Readington PD" />
                <Field label="Primary Accent Color" value="Blue" />
                <Field label="Login Screen Theme" value="Dark" />
              </div>
            </SettingsCard>

            <SettingsCard
              title="Department Patch"
              description="Upload agency patch for sidebar, login, and generated reports."
            >
              <div className="flex min-h-48 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-700 bg-slate-950/60 p-6 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl border border-slate-700 bg-slate-900 text-slate-500">
                  <Upload size={24} />
                </div>
                <p className="text-sm font-semibold text-slate-200">
                  Upload Department Patch
                </p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">
                  Accepted: PNG, JPG, SVG. Recommended: transparent PNG.
                </p>
                <button className="mt-4 rounded-2xl border border-slate-700 px-4 py-2 text-sm font-medium text-slate-400 hover:border-blue-500/50 hover:text-white">
                  Select File
                </button>
              </div>
            </SettingsCard>
          </div>
        )}

        {activeTab === "audit" && (
          <div className="grid min-w-0 gap-4 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <SettingsCard title="Audit & Security Controls">
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Immutable Audit Log", "Enabled"],
                    ["Role-Based Access Control", "Enabled"],
                    ["MFA Requirement", "Enabled"],
                    ["Session Timeout", "30 minutes"],
                    ["Export Logging", "Enabled"],
                    ["Data Retention Policy", "Agency-defined"],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3"
                    >
                      <span className="text-sm text-slate-400">{label}</span>
                      <StatusPill
                        label={value}
                        tone={value === "30 minutes" ? "slate" : "green"}
                      />
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <button className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 px-4 py-2 text-sm font-medium text-slate-400 hover:border-blue-500/50 hover:text-white">
                    <FileText size={15} />
                    Export Audit Log
                  </button>
                  <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">
                    <ShieldCheck size={15} />
                    Review Security Settings
                  </button>
                </div>
              </SettingsCard>
            </div>

            <SettingsCard title="Recent Admin Activity">
              <div className="space-y-3">
                {[
                  ["Agency profile updated", "Today"],
                  ["User role changed: Sgt. Rivera", "Yesterday"],
                  ["Rules engine reviewed", "2 days ago"],
                  ["Export permission updated", "4 days ago"],
                ].map(([activity, time]) => (
                  <div
                    key={activity}
                    className="flex items-start justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <CheckCircle2
                        size={14}
                        className="mt-0.5 shrink-0 text-blue-400"
                      />
                      <p className="text-sm leading-5 text-slate-300">
                        {activity}
                      </p>
                    </div>
                    <span className="whitespace-nowrap text-xs text-slate-600">
                      {time}
                    </span>
                  </div>
                ))}
              </div>
            </SettingsCard>
          </div>
        )}
      </div>
    </TracePointShell>
  );
}