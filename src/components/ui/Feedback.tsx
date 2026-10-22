import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./Button";
import { cx } from "./cx";
import type { StatusRole } from "./status";

type NoticeRole = Exclude<StatusRole, "neutral">;

const NOTICE: Record<NoticeRole, { frame: string; icon: typeof Info }> = {
  success: { frame: "border-success-line bg-success-soft", icon: CheckCircle2 },
  warning: { frame: "border-warning-line bg-warning-soft", icon: AlertTriangle },
  danger: { frame: "border-danger-line bg-danger-soft", icon: XCircle },
  info: { frame: "border-info-line bg-info-soft", icon: Info },
};

const ICON_TEXT: Record<NoticeRole, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
};

export type InlineNoticeProps = {
  role: NoticeRole;
  title: ReactNode;
  children?: ReactNode;
  /** One next step, such as a Retry button or a link. */
  action?: ReactNode;
  className?: string;
};

/**
 * Inline feedback in the flow of the page. Danger notices are announced at once;
 * the others politely. Errors say what to do next. Contract: COMPONENTS.md#inlinenotice
 */
export function InlineNotice({ role, title, children, action, className }: InlineNoticeProps) {
  const Icon = NOTICE[role].icon;
  return (
    <div
      role={role === "danger" ? "alert" : "status"}
      data-status-role={role}
      className={cx("flex gap-3 rounded-card border p-3", NOTICE[role].frame, className)}
    >
      <Icon aria-hidden="true" className={cx("mt-0.5 h-4 w-4 shrink-0", ICON_TEXT[role])} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-body font-semibold text-fg">{title}</p>
        {children ? <div className="text-body text-fg-secondary">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

export type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  /** The next step: usually one primary Button or ButtonLink. */
  action?: ReactNode;
  /** A short "Set up in 3 steps" guide for first-run screens. */
  steps?: readonly ReactNode[];
  icon?: ReactNode;
  className?: string;
};

/** Neutral empty state with a next step (blueprint #15). Contract: COMPONENTS.md#emptystate */
export function EmptyState({ title, description, action, steps, icon, className }: EmptyStateProps) {
  return (
    <div className={cx("flex flex-col items-center gap-3 rounded-card border border-dashed border-line px-6 py-10 text-center", className)}>
      {icon ? <div aria-hidden="true" className="text-fg-muted">{icon}</div> : null}
      <p className="text-emphasis font-semibold text-fg">{title}</p>
      {description ? <div className="max-w-md text-body text-fg-muted">{description}</div> : null}
      {steps && steps.length > 0 ? (
        <ol className="mt-1 max-w-md list-decimal space-y-1 pl-5 text-left text-body text-fg-secondary">
          {steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("block animate-pulse rounded-control bg-surface-raised", className)} />;
}

export type AsyncStatus = "loading" | "error" | "empty" | "ready";

export type AsyncStateProps = {
  status: AsyncStatus;
  /** What is loading, for screen readers and the error line: "vehicles". */
  noun: string;
  onRetry?: () => void;
  /** Error detail from the API, already in plain language. */
  errorDetail?: ReactNode;
  empty?: ReactNode;
  /** Skeleton shown while loading. Defaults to three rows. */
  skeleton?: ReactNode;
  children?: ReactNode;
};

/**
 * Loading is a skeleton, failure is "Couldn't load · Retry", empty is a neutral
 * state with a next step (blueprint §1). Never a zero or an all-clear while loading.
 * Contract: COMPONENTS.md#asyncstate
 */
export function AsyncState({ status, noun, onRetry, errorDetail, empty, skeleton, children }: AsyncStateProps) {
  if (status === "loading") {
    return (
      <div aria-busy="true" className="space-y-2">
        <span className="sr-only" role="status">
          Loading {noun}
        </span>
        {skeleton ?? (
          <>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </>
        )}
      </div>
    );
  }
  if (status === "error") {
    return (
      <InlineNotice
        role="danger"
        title={`Couldn't load ${noun}`}
        action={
          onRetry ? (
            <Button size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : undefined
        }
      >
        {errorDetail ?? "Check your connection and try again. If it keeps happening, contact your administrator."}
      </InlineNotice>
    );
  }
  if (status === "empty") {
    return <>{empty ?? <EmptyState title={`No ${noun} yet`} />}</>;
  }
  return <>{children}</>;
}
