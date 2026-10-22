import Link from "next/link";
import { Children, type ReactNode } from "react";

import { cx } from "./cx";
import { STATUS_ROLE_CLASSES, type StatusRole } from "./status";

const ACCENT_EDGE: Record<StatusRole, string | null> = {
  success: "border-l-4 border-l-success",
  warning: "border-l-4 border-l-warning",
  danger: "border-l-4 border-l-danger",
  info: "border-l-4 border-l-info",
  neutral: null,
};

export type KpiTileProps = {
  label: string;
  /** A number or "n/m". Rendered in mono. */
  value: ReactNode;
  /** A plain context line, such as "1 out of service". */
  context?: ReactNode;
  /** Every number links to the filtered list behind it (blueprint §1 "Dashboards"). */
  href?: string;
  /** Applied only while `attention` is true. */
  role?: StatusRole;
  /** Whether the value needs attention. A zero or an all-clear stays neutral. */
  attention?: boolean;
  /** Shows a skeleton. Never show a number, least of all a zero, before the data arrives. */
  loading?: boolean;
  /** The count couldn't be loaded. Shows "Data unavailable" instead of a number. */
  error?: boolean;
  onRetry?: () => void;
  className?: string;
};

/** Contract: COMPONENTS.md#kpitile */
export function KpiTile({
  label,
  value,
  context,
  href,
  role = "neutral",
  attention = false,
  loading = false,
  error = false,
  onRetry,
  className,
}: KpiTileProps) {
  const emphasis = attention && !loading && !error ? role : "neutral";
  const frame = cx(
    "flex min-w-0 flex-col rounded-card border border-line bg-surface p-4",
    ACCENT_EDGE[emphasis],
    className,
  );
  const body = (
    <>
      <span className="text-label text-fg-muted">{label}</span>
      {loading ? (
        <>
          <span aria-hidden="true" className="mt-1 block h-9 w-16 animate-pulse rounded-control bg-surface-raised" />
          <span className="sr-only">Loading</span>
        </>
      ) : error ? (
        <span className="mt-2 flex items-center gap-2 text-body text-fg-muted">
          Data unavailable
          {onRetry ? (
            <button type="button" onClick={onRetry} className="tp-touch-target rounded-control px-1 font-semibold text-accent-text hover:underline">
              Retry
            </button>
          ) : null}
        </span>
      ) : (
        <span
          className={cx(
            "mt-1 block font-mono text-kpi font-semibold tabular-nums",
            emphasis === "neutral" ? "text-fg" : STATUS_ROLE_CLASSES[emphasis].text,
          )}
        >
          {value}
        </span>
      )}
      {!loading && !error && context ? <span className="mt-1 block text-caption text-fg-muted">{context}</span> : null}
    </>
  );

  if (href && !loading && !error) {
    return (
      <Link
        href={href}
        data-status-role={emphasis}
        className={cx(frame, "transition-colors hover:border-line-strong hover:bg-surface-raised")}
      >
        {body}
      </Link>
    );
  }
  return (
    <div data-status-role={emphasis} aria-busy={loading || undefined} className={frame}>
      {body}
    </div>
  );
}

const STRIP_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
};

/** One strip of up to four tiles, sized to the tile count so no grid slot is left empty. */
export function KpiStrip({ children, label }: { children: ReactNode; label?: string }) {
  const count = Math.min(Math.max(Children.toArray(children).length, 1), 4);
  return (
    <section aria-label={label} className={cx("grid gap-3", STRIP_COLUMNS[count])}>
      {children}
    </section>
  );
}
