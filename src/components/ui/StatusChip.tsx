import { cx } from "./cx";
import { STATUS_ROLE_CLASSES, statusRoleFor, toSentenceCase, type StatusRole } from "./status";

export type StatusChipProps = {
  /** Status word. Shown in sentence case. */
  label: string;
  /** Explicit role. When omitted, the shared status vocabulary decides. */
  role?: StatusRole;
  /** Why the record has this status. Shown as a tooltip and read by screen readers. */
  reason?: string;
  size?: "sm" | "md";
  className?: string;
};

/** Dot, sentence-case label and reason. Contract: COMPONENTS.md#statuschip */
export function StatusChip({ label, role, reason, size = "md", className }: StatusChipProps) {
  const resolved = role ?? statusRoleFor(label);
  const classes = STATUS_ROLE_CLASSES[resolved];

  return (
    <span
      data-status-role={resolved}
      title={reason}
      className={cx(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-caption" : "px-2.5 py-0.5 text-label",
        classes.chip,
        className,
      )}
    >
      <span aria-hidden="true" className={cx("h-1.5 w-1.5 shrink-0 rounded-full", classes.dot)} />
      <span className="truncate">{toSentenceCase(label)}</span>
      {reason ? <span className="sr-only">: {reason}</span> : null}
    </span>
  );
}
