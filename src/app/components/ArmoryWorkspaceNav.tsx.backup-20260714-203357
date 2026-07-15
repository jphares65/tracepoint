"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  ClipboardCheck,
  Crosshair,
  ShieldCheck,
} from "lucide-react";

const WORKSPACES = [
  {
    label: "Department Firearms",
    href: "/firearms",
    icon: Crosshair,
    description: "Inventory, assignments, returns, and firearm condition.",
  },
  {
    label: "Personally Owned Rifles",
    href: "/firearms/personal-rifles",
    icon: ShieldCheck,
    description: "Officer submissions and agency approval workflow.",
  },
  {
    label: "Maintenance & Inspections",
    href: "/firearms/inspections",
    icon: ClipboardCheck,
    description: "Inspections, maintenance, and return-to-service records.",
  },
  {
    label: "Ammunition",
    href: "/firearms/ammunition",
    icon: Boxes,
    description: "Duty accountability and training ammunition logistics.",
  },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/firearms") {
    return pathname === "/firearms";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function ArmoryWorkspaceNav() {
  const pathname = usePathname();

  return (
    <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-3 shadow-sm">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {WORKSPACES.map((workspace) => {
          const Icon = workspace.icon;
          const active = isActive(pathname, workspace.href);

          return (
            <Link
              key={workspace.href}
              href={workspace.href}
              aria-current={active ? "page" : undefined}
              className={`group rounded-2xl border p-4 transition ${
                active
                  ? "border-blue-500/50 bg-blue-500/10"
                  : "border-transparent bg-slate-950/45 hover:border-slate-700 hover:bg-slate-950/80"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    active
                      ? "bg-blue-600 text-white"
                      : "bg-slate-800 text-slate-400 group-hover:text-slate-200"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </span>

                <span className="min-w-0">
                  <span
                    className={`block text-sm font-bold ${
                      active ? "text-blue-100" : "text-slate-200"
                    }`}
                  >
                    {workspace.label}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">
                    {workspace.description}
                  </span>
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
