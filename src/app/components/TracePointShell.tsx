"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  Crosshair,
  Shield,
  ShieldCheck,
  CalendarRange,
  ClipboardList,
  Upload,
} from "lucide-react";

type TracePointShellProps = {
  activePage: string;
  children: ReactNode;
};

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Firearms Repository", href: "/firearms", icon: Crosshair },
  { label: "Off-Duty Firearms", href: "/off-duty-firearms", icon: Shield },
  { label: "Qualifications", href: "/qualifications", icon: ShieldCheck },
  { label: "Range & Training", href: "/range-days", icon: CalendarRange },
  { label: "Inspections", href: "/inspections", icon: ClipboardList },
] as const;

function TPMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="flex-shrink-0"
    >
      <circle cx="18" cy="18" r="18" fill="#1B2B4B" />
      <path d="M18 6 A12 12 0 0 0 6 18" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.9" />
      <path d="M18 10 A8 8 0 0 0 10 18" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.9" />
      <path d="M18 14 A4 4 0 0 0 14 18" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.9" />
      <path d="M18 6 A12 12 0 0 1 30 18" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.6" />
      <path d="M18 10 A8 8 0 0 1 26 18" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.6" />
      <line x1="9" y1="27" x2="25" y2="14" stroke="white" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
      <circle cx="18" cy="18" r="1.5" fill="white" opacity="0.9" />
      <path d="M18 8.5 C15.5 8.5 13.5 10.5 13.5 13 C13.5 16.5 18 21.5 18 21.5 C18 21.5 22.5 16.5 22.5 13 C22.5 10.5 20.5 8.5 18 8.5Z" fill="#E8721C" />
      <circle cx="18" cy="13" r="2" fill="white" />
    </svg>
  );
}

export default function TracePointShell({ activePage, children }: TracePointShellProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-white" style={{ fontFamily: "system-ui, sans-serif" }}>
      <div className="flex min-h-screen">
        <aside className="fixed inset-y-0 left-0 hidden w-72 flex-col border-r border-slate-800 bg-slate-950 p-5 lg:flex">
          <div className="mb-6">
            <div className="flex items-center gap-3">
              <TPMark size={36} />
              <div>
                <div className="flex items-baseline">
                  <span className="text-[20px] font-extrabold leading-none tracking-tight text-white">Trace</span>
                  <span className="text-[20px] font-extrabold leading-none tracking-tight text-[#E8721C]">Point</span>
                </div>
                <p className="mt-1 text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                  Operational Accountability
                </p>
              </div>
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-1.5">
            <p className="mb-1 px-3 text-[9px] font-semibold uppercase tracking-widest text-slate-700">
              Navigation
            </p>

            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.label;

              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`group relative flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-950/30"
                      : "text-slate-400 hover:bg-slate-900 hover:text-white"
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-blue-300" />
                  )}
                  <Icon size={17} className={isActive ? "text-white" : "text-slate-500 group-hover:text-slate-300"} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-6 rounded-3xl border border-slate-800 bg-slate-900/80 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950 text-slate-400">
                <Upload size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-200">Readington PD</p>
                <p className="mt-0.5 text-xs text-slate-500">Administrator</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 border-t border-slate-800/60 pt-3 text-xs text-slate-500">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              System Online
            </div>
          </div>
        </aside>

        <main className="min-h-screen flex-1 lg:pl-72">
          <div className="mx-auto w-full max-w-7xl px-6 py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
