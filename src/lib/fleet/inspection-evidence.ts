import type { ServerAccessContext } from "@/lib/tracepoint/server-access";

type Failure = { ok: false; status: 403 | 404 | 500; error: string };
type Success = { ok: true; inspection: Record<string, unknown>; checklist: Record<string, unknown>[]; checklistItem: Record<string, unknown> };

export async function authorizeInspectionEvidence(
  context: ServerAccessContext,
  input: { vehicleId: string; inspectionId: string; checklistItemId: string },
): Promise<Failure | Success> {
  const [inspectionResult, rulesResult] = await Promise.all([
    context.admin.from("fleet_vehicle_inspections").select("id,vehicle_id,inspector_user_id,checklist")
      .eq("department_id", context.departmentId).eq("vehicle_id", input.vehicleId).eq("id", input.inspectionId).maybeSingle(),
    context.admin.from("fleet_rules").select("inspection_role_codes").eq("department_id", context.departmentId).maybeSingle(),
  ]);
  if (inspectionResult.error) return { ok: false, status: 500, error: "Inspection evidence authorization failed." };
  if (!inspectionResult.data) return { ok: false, status: 404, error: "Inspection was not found." };
  const inspection = inspectionResult.data as Record<string, unknown>;
  const permittedRoles = Array.isArray(rulesResult.data?.inspection_role_codes) ? rulesResult.data.inspection_role_codes : [];
  const allowed = context.isSuperAdmin || context.userId === inspection.inspector_user_id ||
    context.permissions.some((permission) => ["administer_department", "perform_fleet_inspections", "manage_fleet", "manage_fleet_rules"].includes(permission)) ||
    context.roleCodes.some((role) => permittedRoles.includes(role));
  if (!allowed) return { ok: false, status: 403, error: "You do not have permission to add inspection evidence." };
  const checklist = Array.isArray(inspection.checklist) ? inspection.checklist.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
  const checklistItem = checklist.find((item) => item.id === input.checklistItemId);
  if (!checklistItem) return { ok: false, status: 404, error: "Inspection checklist item was not found." };
  return { ok: true, inspection, checklist, checklistItem };
}
