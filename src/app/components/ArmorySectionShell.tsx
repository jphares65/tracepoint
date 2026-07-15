"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import ArmoryWorkspaceNav from "@/app/components/ArmoryWorkspaceNav";

type ArmorySectionShellProps = {
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
};

export default function ArmorySectionShell({
  title,
  description,
  backHref,
  backLabel,
  actions,
}: ArmorySectionShellProps) {
  return (
    <>
      <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5 shadow-sm sm:p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-400">
          TracePoint Armory
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">
          Armory
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Firearm lifecycle, custody, inspection, and ammunition accountability.
        </p>
      </section>

      <ArmoryWorkspaceNav />

      <section className="flex min-h-[108px] flex-col justify-between gap-4 rounded-[2rem] border border-slate-800 bg-slate-900/75 p-5 sm:flex-row sm:items-center sm:p-6">
        <div className="min-w-0">
          {backHref && backLabel ? (
            <Link
              href={backHref}
              className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-400 transition hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              {backLabel}
            </Link>
          ) : null}

          <h2 className="text-2xl font-bold tracking-tight text-white">
            {title}
          </h2>

          {description ? (
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              {description}
            </p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        ) : null}
      </section>
    </>
  );
}
