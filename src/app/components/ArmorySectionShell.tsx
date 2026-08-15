"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

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
    <section className="flex flex-col gap-4 border-b border-slate-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {backHref && backLabel ? (
          <Link
            href={backHref}
            className="mb-2 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 transition hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        ) : null}

        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-400">
          Armory
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
          {title}
        </h1>

        {description ? (
          <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-500">
            {description}
          </p>
        ) : null}
      </div>

      {actions ? (
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">{actions}</div>
      ) : null}
    </section>
  );
}

