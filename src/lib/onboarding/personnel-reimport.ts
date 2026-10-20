// ADM-04: a personnel re-import changes an existing member's status only when
// the row carries an explicit Active value, and never replaces their roles.

const INACTIVE_VALUES = [
  "no",
  "n",
  "false",
  "0",
  "inactive",
  "disabled",
  "terminated",
  "retired",
];

export type PriorMembership = { is_active?: unknown } | null | undefined;

// A missing or blank Active value is undefined, not active.
export function parseImportActive(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) return undefined;
  return !INACTIVE_VALUES.includes(normalized);
}

function targetActive(requested: unknown, prior: PriorMembership) {
  if (typeof requested === "boolean") return requested;
  return prior ? prior.is_active === true : true;
}

// Supabase bridge: membership status columns to write (empty when unchanged)
// and whether the default role is assigned (new memberships only).
export function planBridgePersonnelMembership(
  requested: unknown,
  prior: PriorMembership,
  now: string,
) {
  const active = targetActive(requested, prior);
  const changed = !prior || active !== (prior.is_active === true);
  return {
    active,
    status: changed ? { is_active: active, deactivated_at: active ? null : now } : {},
    assignDefaultRole: !prior,
  };
}

// Cognito: attach_existing_cognito_personnel_import inserts a new membership
// inactive and leaves an existing one unchanged. setActive is undefined when
// the lifecycle (enable/disable) must not run.
export function planExistingCognitoPersonnel(
  requested: unknown,
  prior: PriorMembership,
  identityState: unknown,
) {
  const current = prior?.is_active === true;
  const active = targetActive(requested, prior);
  return {
    setActive: active === current ? undefined : active,
    resendInvitation: active && identityState === "pending",
  };
}
