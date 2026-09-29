import type { TracePointPermission } from "./permissions";

export type TenantContext =
  | { ok: true; departmentId: string; kind: "membership" | "platform" }
  | { ok: false; reason: "no_membership" | "department_selection_required" };

type TenantContextInput = {
  selectedDepartmentId: string;
  activeMembershipDepartmentIds: readonly string[];
  isPlatformAdmin: boolean;
};

function clean(value: string) {
  return value.trim();
}

/**
 * Resolves the one tenant a request may operate on. A platform administrator
 * must explicitly select that tenant; it never receives an implicit wildcard.
 */
export function resolveTenantContext({
  selectedDepartmentId,
  activeMembershipDepartmentIds,
  isPlatformAdmin,
}: TenantContextInput): TenantContext {
  const selected = clean(selectedDepartmentId);
  const memberships = activeMembershipDepartmentIds.map(clean).filter(Boolean);

  if (isPlatformAdmin && selected) {
    return { ok: true, departmentId: selected, kind: "platform" };
  }

  if (memberships.length === 0) {
    return { ok: false, reason: "no_membership" };
  }

  if (selected) {
    if (memberships.includes(selected)) {
      return { ok: true, departmentId: selected, kind: "membership" };
    }

    return { ok: false, reason: "department_selection_required" };
  }

  if (memberships.length === 1) {
    return { ok: true, departmentId: memberships[0], kind: "membership" };
  }

  return { ok: false, reason: "department_selection_required" };
}

export function canAdministerTenant(
  context: TenantContext,
  targetDepartmentId: string,
  permissions: readonly TracePointPermission[],
) {
  return (
    context.ok &&
    context.departmentId === clean(targetDepartmentId) &&
    (context.kind === "platform" ||
      permissions.includes("administer_department"))
  );
}
