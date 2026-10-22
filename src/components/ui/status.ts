/**
 * Status roles (blueprint §1 "Status & notifications"). Five roles, and color is
 * used only to signal one of them. Contract: docs/modernization/design-system/COMPONENTS.md#statuschip
 */
export type StatusRole = "success" | "warning" | "danger" | "info" | "neutral";

export const STATUS_ROLES: readonly StatusRole[] = ["success", "warning", "danger", "info", "neutral"];

export const STATUS_ROLE_CLASSES: Record<StatusRole, { chip: string; dot: string; text: string; bar: string }> = {
  success: { chip: "border-success-line bg-success-soft text-success", dot: "bg-success", text: "text-success", bar: "bg-success" },
  warning: { chip: "border-warning-line bg-warning-soft text-warning", dot: "bg-warning", text: "text-warning", bar: "bg-warning" },
  danger: { chip: "border-danger-line bg-danger-soft text-danger", dot: "bg-danger", text: "text-danger", bar: "bg-danger" },
  info: { chip: "border-info-line bg-info-soft text-info", dot: "bg-info", text: "text-info", bar: "bg-info" },
  neutral: { chip: "border-neutral-line bg-neutral-soft text-fg-secondary", dot: "bg-neutral", text: "text-fg-secondary", bar: "bg-neutral" },
};

/**
 * Shared vocabulary: the same status word gets the same role in every module.
 * Keys are compared case-insensitively with spaces, hyphens and underscores folded.
 * A module that needs a status not listed here adds it here (design-system change),
 * rather than choosing a color locally.
 */
const STATUS_VOCABULARY: Record<string, StatusRole> = {
  // Readiness and availability
  available: "success",
  "in service": "success",
  active: "success",
  current: "success",
  qualified: "success",
  passed: "success",
  pass: "success",
  complete: "success",
  completed: "success",
  approved: "success",
  saved: "success",
  "ready for duty": "success",
  // Attention
  "due soon": "warning",
  "inspection due": "warning",
  "inspection required": "warning",
  "needs inspection": "warning",
  "not recorded": "warning",
  "not synced": "warning",
  expiring: "warning",
  pending: "warning",
  "pending approval": "warning",
  "duty only": "warning",
  restricted: "warning",
  "in maintenance": "warning",
  incomplete: "warning",
  // Blocking
  "out of service": "danger",
  failed: "danger",
  fail: "danger",
  expired: "danger",
  overdue: "danger",
  "not qualified": "danger",
  "no carry": "danger",
  denied: "danger",
  conflict: "danger",
  critical: "danger",
  missing: "danger",
  // In flight / informational
  saving: "info",
  "in progress": "info",
  scheduled: "info",
  "checked out": "info",
  "in storage": "info",
  assigned: "info",
  // Neutral
  unassigned: "neutral",
  retired: "neutral",
  archived: "neutral",
  draft: "neutral",
  "not scheduled": "neutral",
  "not set up": "neutral",
  "not inspected": "neutral",
  unknown: "neutral",
  none: "neutral",
};

export function normalizeStatusKey(label: string) {
  return label.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/** Role for a status word from the shared vocabulary; neutral when unknown. */
export function statusRoleFor(label: string | null | undefined, fallback: StatusRole = "neutral"): StatusRole {
  if (!label) return fallback;
  return STATUS_VOCABULARY[normalizeStatusKey(label)] ?? fallback;
}

/** Sentence case for display: "OUT_OF_SERVICE" -> "Out of service". */
export function toSentenceCase(label: string) {
  const words = label.trim().replace(/[_]+/g, " ").replace(/\s+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
