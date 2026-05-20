"use client";

import Image from "next/image";
import Link from "next/link";
import {
  LayoutDashboard,
  Crosshair,
  Shield,
  ShieldCheck,
  CalendarRange,
  ClipboardList,
  Settings,
  Upload,
} from "lucide-react";

type TracePointShellProps = {
  activePage: string;
  children: React.ReactNode;
};

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Firearms", href: "/firearms", icon: Crosshair },
  { label: "Off-Duty Firearms", href: "/off-duty-firearms", icon: Shield },
  { label: "Qualifications", href: "/qualifications", icon: ShieldCheck },
  { label: "Range & Training", href: "/range-days", icon: CalendarRange },
  { label: "Inspections", href: "/inspections", icon: ClipboardList },
  { label: "Settings", href: "/settings", icon: Settings },
];

export default function TracePointShell({
  activePage,
  children,
}: TracePointShellProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="flex min-h-screen">
        <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-slate-800 bg-slate-950 lg:flex lg:flex-col">
          <div className="border-b border-slate-800 px-5 py-3.5">
            <Link href="/" className="block">
              <Image
                src="/tracepoint-logo-dark.png"
                alt="TracePoint"
                width={165}
                height={40}
                priority
                className="h-auto w-[205px] object-contain"
              />
            </Link>
          </div>

          <nav className="flex-1 space-y-1.5 px-3 py-5">
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-600">
              Navigation
            </p>

            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active =
                activePage === item.label ||
                (activePage === "Firearms Repository" &&
                  item.label === "Firearms");

              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`group relative flex items-center gap-3 rounded-xl px-4 py-1.5 text-[14px] transition-all duration-200 ${
                    active
                      ? "bg-blue-600/20 text-blue-200"
                      : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                  }`}
                >
                  {active && (
                    <span className="absolute bottom-2 left-0 top-2 w-1 rounded-r-full bg-blue-500" />
                  )}

                  <Icon
                    size={17}
                    className={
                      active
                        ? "text-blue-400"
                        : "text-slate-600 group-hover:text-slate-400"
                    }
                  />

                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-slate-800 p-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  title="Department patch upload placeholder"
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-slate-500 transition hover:border-blue-500/40 hover:text-blue-400"
                >
                  <Upload size={15} />
                </button>

                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-slate-100">
                    Readington PD
                  </p>
                  <p className="text-[11px] text-slate-500">Administrator</p>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 border-t border-slate-800 pt-3 text-[11px] text-slate-500">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                System Online
              </div>
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