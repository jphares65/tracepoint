import {
  meetsPermissionRequirement,
  type PermissionRequirement,
  type TracePointPermission,
} from "./permissions.ts";
import type { ModuleFeatureCode } from "./module-catalog.ts";

export function isAgencyFeatureEnabled(
  enabledFeatures: ReadonlySet<string>,
  featureCode: ModuleFeatureCode,
) {
  return enabledFeatures.has(featureCode);
}

export function canAccessModule(input: {
  permissions: readonly TracePointPermission[];
  enabledFeatures: ReadonlySet<string>;
  featureCode?: ModuleFeatureCode;
  requirement?: PermissionRequirement;
}) {
  if (
    input.featureCode &&
    !isAgencyFeatureEnabled(input.enabledFeatures, input.featureCode)
  ) {
    return false;
  }

  return meetsPermissionRequirement(input.permissions, input.requirement);
}

export function toggleExpandedGroup(
  current: ReadonlySet<string>,
  label: string,
) {
  const next = new Set(current);
  if (next.has(label)) next.delete(label);
  else next.add(label);
  return next;
}
