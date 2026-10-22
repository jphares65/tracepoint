import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "./cx";

export type TabLink = {
  label: string;
  /** Every tab has a URL (blueprint §1 "Page layouts"): a route or a ?tab= query. */
  href: string;
  /** Optional count, shown in mono. */
  count?: number;
  icon?: ReactNode;
};

export type TabsProps = {
  /** Accessible name: "Firearm record sections". */
  label: string;
  tabs: readonly TabLink[];
  activeHref: string;
  className?: string;
};

/**
 * URL-backed tabs, rendered as navigation links so Back, refresh and sharing work.
 * Contract: COMPONENTS.md#tabs
 */
export function Tabs({ label, tabs, activeHref, className }: TabsProps) {
  return (
    <nav aria-label={label} className={cx("-mx-1 overflow-x-auto border-b border-line", className)}>
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((tab) => {
          const active = tab.href === activeHref;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "tp-touch-target -mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-body font-medium transition-colors",
                  active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                {tab.icon}
                {tab.label}
                {typeof tab.count === "number" ? (
                  <span className="rounded-full bg-surface-raised px-1.5 font-mono text-caption text-fg-secondary">{tab.count}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
