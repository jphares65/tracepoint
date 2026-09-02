import { NextRequest, NextResponse } from "next/server";
import {
  accessFailureResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import {
  auditFleet,
  canConfigureFleet,
  numeric,
} from "@/lib/tracepoint/fleet-server";
import { createFleetReadRepository } from "@/lib/fleet/read-repository";

const DEFAULTS = {
  status_automation_enabled: true,
  due_soon_days: 30,
  default_service_miles: null,
  default_service_hours: null,
  default_service_days: null,
  inspection_warning_days: 30,
  warranty_warning_days: 60,
  registration_warning_days: 30,
  critical_issue_out_of_service: true,
  critical_equipment_out_of_service: true,
  require_return_to_service_approval: true,
  notify_by_email: true,
  escalation_hours: 24,
  fleet_manager_role_codes: ["fleet_manager"],
  mechanic_role_codes: ["mechanic", "fleet_mechanic"],
  inspection_frequency_days: 1,
  inspection_types: ["Pre-Shift", "Post-Shift", "Weekly"],
  inspection_role_codes: [],
  inspection_checklist: [
    { id: "body", label: "Body, windshield and mirrors" },
    { id: "tires", label: "Tires and wheels" },
    { id: "lights", label: "Lights, signals and siren" },
    { id: "controls", label: "Brakes, steering and controls" },
    { id: "fluids", label: "Fluids and visible leaks" },
    { id: "interior", label: "Seatbelts and interior condition" },
  ],
  inspection_include_required_equipment: true,
  inspection_defect_creates_work_order: true,
  inspection_critical_out_of_service: true,
  notify_mechanic_on_issue_report: true,
  notify_mechanic_on_inspection_defect: true,
  notify_fleet_manager_on_status_change: true,
};

export async function GET() {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  try { const data = await createFleetReadRepository(context.admin, context.departmentId).getRules({ departmentId: context.departmentId }); return NextResponse.json({ rules: { ...DEFAULTS, ...(data ?? {}) }, canManage: canConfigureFleet(context) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Fleet rules could not be loaded." }, { status: 500 }); }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- legacy mutation payload remains unchanged */
export async function PUT(request: NextRequest) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  if (!canConfigureFleet(context))
    return NextResponse.json(
      { error: "Fleet rule management access is required." },
      { status: 403 },
    );
  const body = (await request.json().catch(() => ({}))) as any;
  const { data: previous } = await context.admin
    .from("fleet_rules")
    .select("*")
    .eq("department_id", context.departmentId)
    .maybeSingle();
  const list = (value: unknown, fallback: string[]) =>
    Array.isArray(value)
      ? value
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean)
      : fallback;
  const checklist = Array.isArray(body.inspection_checklist)
    ? body.inspection_checklist
        .slice(0, 100)
        .map((item: any, index: number) => ({
          id: String(item?.id || `item-${index + 1}`).slice(0, 100),
          label: String(item?.label || `Item ${index + 1}`)
            .trim()
            .slice(0, 200),
          category: String(item?.category || "Vehicle Condition")
            .trim()
            .slice(0, 100),
          required: item?.required !== false,
          critical: item?.critical === true,
          active: item?.active !== false,
          sort_order: Number.isFinite(Number(item?.sort_order))
            ? Math.round(Number(item.sort_order))
            : index + 1,
        }))
        .filter((item: any) => item.label)
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
    : DEFAULTS.inspection_checklist;
  const record = {
    department_id: context.departmentId,
    status_automation_enabled: body.status_automation_enabled !== false,
    due_soon_days: Math.round(numeric(body.due_soon_days, 30)),
    default_service_miles: numeric(body.default_service_miles) || null,
    default_service_hours: numeric(body.default_service_hours) || null,
    default_service_days: numeric(body.default_service_days) || null,
    inspection_warning_days: Math.round(
      numeric(body.inspection_warning_days, 30),
    ),
    warranty_warning_days: Math.round(numeric(body.warranty_warning_days, 60)),
    registration_warning_days: Math.round(
      numeric(body.registration_warning_days, 30),
    ),
    critical_issue_out_of_service: body.critical_issue_out_of_service !== false,
    critical_equipment_out_of_service:
      body.critical_equipment_out_of_service !== false,
    require_return_to_service_approval:
      body.require_return_to_service_approval !== false,
    notify_by_email: body.notify_by_email !== false,
    escalation_hours: Math.round(numeric(body.escalation_hours, 24)),
    fleet_manager_role_codes: list(
      body.fleet_manager_role_codes,
      DEFAULTS.fleet_manager_role_codes,
    ),
    mechanic_role_codes: list(
      body.mechanic_role_codes,
      DEFAULTS.mechanic_role_codes,
    ),
    inspection_frequency_days: Math.max(
      1,
      Math.round(numeric(body.inspection_frequency_days, 1)),
    ),
    inspection_types: list(body.inspection_types, DEFAULTS.inspection_types),
    inspection_role_codes: list(
      body.inspection_role_codes,
      DEFAULTS.inspection_role_codes,
    ),
    inspection_checklist: checklist,
    inspection_include_required_equipment:
      body.inspection_include_required_equipment !== false,
    inspection_defect_creates_work_order:
      body.inspection_defect_creates_work_order !== false,
    inspection_critical_out_of_service:
      body.inspection_critical_out_of_service !== false,
    notify_mechanic_on_issue_report:
      body.notify_mechanic_on_issue_report !== false,
    notify_mechanic_on_inspection_defect:
      body.notify_mechanic_on_inspection_defect !== false,
    notify_fleet_manager_on_status_change:
      body.notify_fleet_manager_on_status_change !== false,
    updated_by_user_id: context.user.id,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await context.admin
    .from("fleet_rules")
    .upsert(record, { onConflict: "department_id" })
    .select("*")
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  await auditFleet(
    context,
    "fleet_rules_updated",
    "fleet_rules",
    context.departmentId,
    { previous, current: data },
  );
  return NextResponse.json({ ok: true, rules: data });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
