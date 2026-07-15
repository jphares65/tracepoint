"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

type ArmoryPageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
  footer?: ReactNode;
};

export default function ArmoryPageHeader({
  eyebrow,
  title,
  description,
  backHref,
  backLabel,
  actions,
  footer,
}: ArmoryPageHeaderProps) {
  return (
    <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {backHref && backLabel ? (
            <Link
              href={backHref}
              className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-400 transition hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              {backLabel}
            </Link>
          ) : null}

          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-400">
            {eyebrow}
          </p>

          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">
            {title}
          </h1>

          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            {description}
          </p>
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        ) : null}
      </div>

      {footer ? <div className="mt-5">{footer}</div> : null}
    </section>
  );
}
