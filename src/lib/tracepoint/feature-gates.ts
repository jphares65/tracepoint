// One entitlement rule for navigation, page layouts and APIs: a module is
// available only when every feature it depends on is enabled for the agency in
// context. There is no platform-administrator bypass; in Support Mode the
// agency's own features apply, as they do on the server.
export const MODULE_FEATURES = {
  commandDashboard: ["command_dashboard"],
  analytics: ["analytics", "range_training"],
  rangeTraining: ["range_training"],
  qualifications: ["qualifications"],
  certifications: ["certifications"],
  equipment: ["equipment_readiness"],
  firearms: ["firearms"],
  ammunition: ["ammunition"],
  offDuty: ["off_duty"],
} as const satisfies Record<string, readonly string[]>;

export function hasEnabledFeatures(
  enabledFeatures: Iterable<string>,
  required: readonly string[] = [],
) {
  const enabled = new Set(enabledFeatures);
  return required.every((feature) => enabled.has(feature));
}
