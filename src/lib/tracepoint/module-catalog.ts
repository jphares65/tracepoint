/** Canonical feature codes shared by navigation, API guards, and tests. */
export const MODULE_FEATURE = {
  AMMUNITION: "ammunition",
  ANALYTICS: "analytics",
  CERTIFICATIONS: "certifications",
  COMMAND_DASHBOARD: "command_dashboard",
  EQUIPMENT_READINESS: "equipment_readiness",
  FIREARMS: "firearms",
  FLEET: "fleet",
  INVENTORY: "inventory",
  OFF_DUTY: "off_duty",
  QUALIFICATIONS: "qualifications",
  RANGE_TRAINING: "range_training",
} as const;

export type ModuleFeatureCode = (typeof MODULE_FEATURE)[keyof typeof MODULE_FEATURE];

export const OPERATIONAL_MODULE_CATALOG: readonly {
  code: ModuleFeatureCode;
  displayName: string;
  description: string;
  sortOrder: number;
}[] = [
  { code: MODULE_FEATURE.AMMUNITION, displayName: "Ammunition", description: "Ammunition inventory and transactions.", sortOrder: 10 },
  { code: MODULE_FEATURE.ANALYTICS, displayName: "Analytics", description: "Agency analytics and reports.", sortOrder: 20 },
  { code: MODULE_FEATURE.CERTIFICATIONS, displayName: "Certifications", description: "Agency certification records and readiness.", sortOrder: 30 },
  { code: MODULE_FEATURE.COMMAND_DASHBOARD, displayName: "Command Dashboard", description: "Command dashboard and operational readiness.", sortOrder: 40 },
  { code: MODULE_FEATURE.EQUIPMENT_READINESS, displayName: "Equipment Readiness", description: "Equipment inventory, assignment, and readiness.", sortOrder: 50 },
  { code: MODULE_FEATURE.FLEET, displayName: "Fleet", description: "Agency vehicle inspections, maintenance, and fleet records.", sortOrder: 55 },
  { code: MODULE_FEATURE.FIREARMS, displayName: "Firearms", description: "Agency and personally owned firearm records.", sortOrder: 60 },
  { code: MODULE_FEATURE.INVENTORY, displayName: "Inventory", description: "Agency supply inventory, locations, and checkouts.", sortOrder: 65 },
  { code: MODULE_FEATURE.OFF_DUTY, displayName: "Off-duty Firearms", description: "Off-duty firearm requests and approvals.", sortOrder: 70 },
  { code: MODULE_FEATURE.QUALIFICATIONS, displayName: "Qualifications", description: "Officer qualification records and standards.", sortOrder: 80 },
  { code: MODULE_FEATURE.RANGE_TRAINING, displayName: "Range and Training", description: "Range days, agency training, and digital packets.", sortOrder: 90 },
];

export const MODULE_FEATURE_CODES = OPERATIONAL_MODULE_CATALOG.map(({ code }) => code);

export function isModuleFeatureCode(value: string): value is ModuleFeatureCode {
  return MODULE_FEATURE_CODES.includes(value as ModuleFeatureCode);
}
