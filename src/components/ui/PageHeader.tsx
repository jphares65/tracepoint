import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { cx } from "./cx";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items, className }: { items: readonly Crumb[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-caption text-fg-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="rounded-sm hover:text-fg">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined}>{item.label}</span>
              )}
              {last ? null : <ChevronRight aria-hidden="true" className="h-3 w-3" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export type PageHeaderProps = {
  /** Must match the navigation label for this page (blueprint §1). */
  title: string;
  breadcrumbs?: readonly Crumb[];
  /** A StatusChip, for record pages. */
  status?: ReactNode;
  /** One line of context: what the page is for, or the record's identifying facts. */
  description?: ReactNode;
  /** The single primary action: a Button or ButtonLink with variant="primary". */
  primaryAction?: ReactNode;
  /** Secondary and quiet actions, placed before the primary action. */
  actions?: ReactNode;
  /** Freshness or meta text, such as "Updated 10:14 AM". */
  meta?: ReactNode;
  className?: string;
};

/**
 * One header for every page: breadcrumb, title, status and one primary action.
 * A plain section, not a card. Contract: COMPONENTS.md#pageheader
 */
export function PageHeader({
  title,
  breadcrumbs = [],
  status,
  description,
  primaryAction,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <header className={cx("flex flex-col gap-3 pb-5", className)}>
      <Breadcrumbs items={breadcrumbs} />
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-title font-semibold tracking-tight text-fg">{title}</h1>
            {status}
            {meta ? <span className="text-caption text-fg-muted">{meta}</span> : null}
          </div>
          {description ? <div className="max-w-3xl text-body text-fg-muted">{description}</div> : null}
        </div>
        {actions || primaryAction ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
            {primaryAction}
          </div>
        ) : null}
      </div>
    </header>
  );
}
