export type TemplateStatus = "draft" | "published" | "archived";
export type FieldGeometry = { x: number; y: number; width: number; height: number };

export function canTransitionTemplate(from: TemplateStatus, to: TemplateStatus) {
  if (from === "archived") return to === "draft";
  return from !== to;
}

export function isValidFieldGeometry(value: FieldGeometry) {
  return [value.x, value.y, value.width, value.height].every(Number.isFinite)
    && value.x >= 0 && value.y >= 0 && value.width > 0 && value.height > 0
    && value.x + value.width <= 1 && value.y + value.height <= 1;
}

export function tenantMatch(recordDepartmentId: string, requestedDepartmentId: string) {
  return Boolean(recordDepartmentId) && recordDepartmentId === requestedDepartmentId;
}
