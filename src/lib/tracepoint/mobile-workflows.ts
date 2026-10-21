import type { ServerAccessContext } from "./server-access";
import { canUseVehicleInspectionQr } from "./fleet-access.ts";
import { MODULE_FEATURE } from "./module-catalog.ts";
import { parseTracePointQrValue, type TracePointQrKind } from "./qr-identifiers.ts";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((value): value is Row => Boolean(value) && typeof value === "object") : [];
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const field = (value: Row, camel: string, snake: string) => text(value[camel] ?? value[snake]);

export function rangeDayPayload(workspaceValue: unknown) {
  const workspace = row(workspaceValue);
  return rows(workspace.rangeDays ?? workspace.range_days).map((day) => ({
    id: text(day.id), title: text(day.title), date: field(day, "date", "range_date"),
    status: text(day.status), rangeType: field(day, "rangeType", "range_type"),
    startTime: field(day, "startTime", "start_time"), endTime: field(day, "endTime", "end_time"),
    location: text(day.location), packetStatus: field(day, "packetStatus", "packet_status"),
  })).filter((day) => day.id);
}

export function rangeDayDetailPayload(workspaceValue: unknown, rangeDayId: string, documentIds: Map<string, string[]>) {
  const workspace = row(workspaceValue);
  const rangeDay = rangeDayPayload(workspace).find((day) => day.id === rangeDayId);
  if (!rangeDay) return null;
  const drills = rows(workspace.rangeDayDrills ?? workspace.range_day_drills)
    .filter((drill) => field(drill, "rangeDayId", "range_day_id") === rangeDayId)
    .sort((left, right) => Number(left.sortOrder ?? left.sort_order ?? 0) - Number(right.sortOrder ?? right.sort_order ?? 0))
    .map((drill) => {
      const templateId = field(drill, "sourceTemplateId", "source_template_id") || field(drill, "drillTemplateId", "drill_template_id");
      const documentId = documentIds.get(templateId)?.[0];
      return {
        id: text(drill.id), rangeDayId, name: text(drill.name), category: text(drill.category),
        scoringMode: field(drill, "scoringMode", "scoring_mode"), scoringFormat: field(drill, "scoringFormat", "scoring_format"),
        passingScore: typeof drill.passingScore === "number" ? drill.passingScore : drill.passing_score,
        maxScore: typeof drill.maxScore === "number" ? drill.maxScore : drill.max_score,
        passingTimeSeconds: drill.passingTimeSeconds ?? drill.passing_time_seconds,
        minimumHits: drill.minimumHits ?? drill.minimum_hits,
        runCount: Number(drill.runCount ?? drill.run_count ?? 1), sortOrder: Number(drill.sortOrder ?? drill.sort_order ?? 0), description: text(drill.description), instructions: text(drill.instructions),
        documentId, diagramId: documentId,
      };
    }).filter((drill) => drill.id);
  const roster = rows(workspace.rangeRoster ?? workspace.range_roster)
    .filter((entry) => field(entry, "rangeDayId", "range_day_id") === rangeDayId)
    .map((entry) => ({ id: text(entry.id), rangeDayId, officerId: field(entry, "officerId", "officer_user_id"), assignedFirearmIds: Array.isArray(entry.assignedFirearmIds) ? entry.assignedFirearmIds.filter((id): id is string => typeof id === "string") : [], attended: entry.attended === true || text(entry.attendance_status).toLowerCase() === "present" }));
  return { rangeDay, drills, roster };
}

// Vehicles require the Fleet module entitlement. Within it, vehicleInspectionEligible is the fleet inspection-eligibility rule
// (fleet-server canSubmitFleetInspection / database can_submit_fleet_inspection), resolved by the route and authoritative when
// present; callers that do not resolve it fall back to canUseVehicleInspectionQr with permittedInspectionRoleCodes.
// firearmCustodyEligible is the restricted custody rule (031 operate_restricted_firearm_custody), resolved by lookupQrRecords.
export function qrDecision(input: { identifier: string; access: Pick<ServerAccessContext, "permissions" | "enabledFeatures"> & Partial<Pick<ServerAccessContext, "roleCodes">> & { vehicleInspectionEligible?: boolean }; permittedInspectionRoleCodes?: readonly string[]; vehicle?: Row | null; equipment?: Row | null; firearm?: Row | null; inventory?: Row | null; firearmCustodyEligible?: boolean }) {
  const identifier = input.identifier.trim();
  if (!identifier || identifier.length > 2048) return { status: "unknown", message: "This QR code is not valid." };
  const permissions = new Set(input.access.permissions);
  const allowed = (...values: string[]) => permissions.has("administer_department") || values.some((value) => permissions.has(value as never));
  const enabled = (feature: string) => input.access.enabledFeatures.includes(feature as never);
  const vehicleEligible = enabled(MODULE_FEATURE.FLEET) && (input.access.vehicleInspectionEligible
    ?? canUseVehicleInspectionQr({ ...input.access, roleCodes: input.access.roleCodes ?? [] }, input.permittedInspectionRoleCodes ?? []));
  // A non-UUID handle (unit, asset, serial, VIN) can be shared by a record the caller cannot see, so an allowed match names the
  // field and value it matched, letting the user confirm the physical item. Only the matched identifier is echoed.
  const matched = (record: Row, columns: string[]) => {
    const column = text(record.id) === identifier ? undefined : columns.find((name) => text(record[name]) === identifier);
    return column ? { matchedField: column, matchedValue: text(record[column]) } : null;
  };
  if (input.vehicle) return vehicleEligible
    ? { entityType: "vehicle", entityId: text(input.vehicle.id), displayName: `Unit ${text(input.vehicle.unit_number) || "vehicle"}`, workflow: "vehicle_inspection", allowed: true, ...matched(input.vehicle, ["unit_number", "vin"]) }
    : { status: "denied", message: "You are not authorized to use this vehicle workflow." };
  if (input.equipment) return enabled(MODULE_FEATURE.EQUIPMENT_READINESS)
    ? { entityType: "equipment", entityId: text(input.equipment.id), displayName: [text(input.equipment.manufacturer), text(input.equipment.model)].filter(Boolean).join(" ") || "Equipment", workflow: "equipment_custody", allowed: true, ...matched(input.equipment, ["asset_number", "serial_number"]) }
    : { status: "denied", message: "Equipment Readiness is not enabled for this agency." };
  if (input.firearm) {
    if (!enabled(MODULE_FEATURE.FIREARMS)) return { status: "denied", message: "Firearms are not enabled for this agency." };
    if (!allowed("firearm_custody.check_out", "firearm_custody.check_in", "manage_firearms") && !input.firearmCustodyEligible) return { status: "denied", message: "You are not authorized to use firearm custody." };
    const confirmation = matched(input.firearm, ["asset_number", "serial_number"]);
    return { entityType: "firearm", entityId: text(input.firearm.id), workflow: "firearm_custody", allowed: true, ...confirmation && { displayName: [text(input.firearm.make), text(input.firearm.model)].filter(Boolean).join(" ") || "Firearm", ...confirmation } };
  }
  if (input.inventory) return enabled(MODULE_FEATURE.INVENTORY) && allowed("view_inventory", "manage_inventory", "adjust_inventory")
    ? { entityType: "inventory", entityId: text(input.inventory.id), displayName: text(input.inventory.name), workflow: "inventory", allowed: true, ...matched(input.inventory, ["sku"]) }
    : { status: "denied", message: enabled(MODULE_FEATURE.INVENTORY) ? "You are not authorized to view inventory." : "Inventory is not enabled for this agency." };
  return { status: "unknown", message: "This QR code is unknown, inactive, or unavailable." };
}

const qrHandle = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Accepts an opaque handle (record ID, unit/asset number, serial, VIN) or the printed label value tracepoint://{kind}/{id}.
export function parseQrIdentifier(value: string): { handle: string; kind: TracePointQrKind | null } | null {
  const label = parseTracePointQrValue(value);
  const handle = label ? label.id : value;
  return qrHandle.test(handle) ? { handle, kind: label?.kind ?? null } : null;
}

// The id columns are uuid, so comparing them to any other value raises 22P02; only UUID handles are compared to id.
export function qrLookupFilter(handle: string, columns: readonly string[]) {
  return [...(uuid.test(handle) ? ["id"] : []), ...columns].map((column) => `${column}.eq.${handle}`).join(",");
}

type QrMatch = Row | null;
type QrAccess = Pick<ServerAccessContext, "userId" | "permissions" | "enabledFeatures"> & { vehicleInspectionEligible?: boolean; restrictedFirearmCustody?: boolean };
type QrFirearmScope = { held: Set<string>; eligible: Set<string> };
// Who may know a record exists, mirroring each table's select policy (firearms_select_scoped, equipment_assets_select_scoped
// plus the 051 custody pool, fleet_vehicles_select_scoped). In aws-native mode RLS already applies; in bridge mode the
// service-role client sees every row, so a row the caller could not read is treated exactly like an absent one.
// A firearm the caller may operate through restricted custody (031) is also visible: that is the custody API's own rule.
function qrVisible(access: QrAccess, table: "vehicle" | "equipment" | "firearm", match: Row, firearms: QrFirearmScope) {
  const permissions = new Set<string>(access.permissions);
  const any = (...values: string[]) => permissions.has("administer_department") || values.some((value) => permissions.has(value));
  if (table === "vehicle") return any("view_command_dashboard", "view_fleet", "manage_fleet", "perform_fleet_inspections", "manage_fleet_maintenance", "manage_fleet_rules") || access.vehicleInspectionEligible === true;
  if (table === "firearm") return any("manage_firearms", "manage_inspections", "view_command_dashboard") || firearms.held.has(text(match.id)) || firearms.eligible.has(text(match.id));
  return any("manage_equipment") || (Boolean(access.userId) && text(match.assigned_user_id) === access.userId)
    || (match.lifecycle_status === "active" && !match.assigned_user_id && !match.assigned_vehicle_id && !match.assigned_location && access.enabledFeatures.includes("equipment_readiness"));
}

// Restricted custody (031): an active, effective duty_only restriction on an actively assigned firearm, operated by the assignee or
// by manage_restricted_firearm_custody. The tables exist only on AWS-native (restrictedFirearmCustody), where RLS scopes these reads.
function restrictedCustodyEligible(access: QrAccess, restrictions: Row[], assignments: Row[]) {
  const now = Date.now(), time = (value: unknown) => value instanceof Date ? value.getTime() : Date.parse(text(value));
  const restricted = new Set(restrictions.filter((restriction) => restriction.restriction_type === "duty_only" && time(restriction.effective_start) <= now
    && (!restriction.expires_at || time(restriction.expires_at) > now)).map((restriction) => text(restriction.firearm_id)));
  const operator = access.permissions.some((permission) => permission === "manage_restricted_firearm_custody" || permission === "administer_department");
  return new Set(assignments.filter((assignment) => restricted.has(text(assignment.firearm_id)) && (operator || text(assignment.assigned_to_user_id) === access.userId)).map((assignment) => text(assignment.firearm_id)));
}

// A handle that matches more than one record the caller can see is reported as ambiguous instead of guessing a record.
// Rows the caller cannot see never change the response: no limit lets hidden rows crowd out a visible one, and the
// firearm scope queries run whatever the handle matched.
export async function lookupQrRecords(admin: ServerAccessContext["admin"], departmentId: string, parsed: { handle: string; kind: TracePointQrKind | null }, access: QrAccess): Promise<{ vehicle: QrMatch; equipment: QrMatch; firearm: QrMatch; firearmCustodyEligible: boolean } | { failure: "error" | "ambiguous" }> {
  const { handle, kind } = parsed;
  const skip = Promise.resolve({ data: [], error: null });
  const permissions = new Set<string>(access.permissions);
  const any = (...values: string[]) => permissions.has("administer_department") || values.some((value) => permissions.has(value));
  // Callers who may read and operate every firearm need no per-firearm scope.
  const scoped = !kind && Boolean(access.userId) && !(any("manage_firearms", "manage_inspections", "view_command_dashboard") && any("firearm_custody.check_out", "firearm_custody.check_in", "manage_firearms"));
  const allAssignments = access.restrictedFirearmCustody === true && any("manage_restricted_firearm_custody");
  const assignments = () => {
    const query = admin.from("firearm_assignments").select("firearm_id,assigned_to_user_id").eq("department_id", departmentId).is("returned_at", null);
    return allAssignments ? query : query.eq("assigned_to_user_id", access.userId);
  };
  const [vehicle, equipment, firearm, assigned, restrictions] = await Promise.all([
    !kind || kind === "vehicle" ? admin.from("fleet_vehicles").select("id,unit_number,vin,status").eq("department_id", departmentId).or(qrLookupFilter(handle, ["unit_number", "vin"])) : skip,
    !kind || kind === "equipment" ? admin.from("equipment_assets").select("id,manufacturer,model,serial_number,asset_number,lifecycle_status,assigned_user_id,assigned_vehicle_id,assigned_location").eq("department_id", departmentId).neq("lifecycle_status", "removed").or(qrLookupFilter(handle, ["asset_number", "serial_number"])) : skip,
    !kind ? admin.from("firearms").select("id,make,model,serial_number,asset_number,is_active").eq("department_id", departmentId).eq("is_active", true).or(qrLookupFilter(handle, ["asset_number", "serial_number"])) : skip,
    scoped ? assignments() : skip,
    scoped && access.restrictedFirearmCustody === true ? admin.from("firearm_possession_restrictions").select("firearm_id,restriction_type,effective_start,expires_at").eq("department_id", departmentId).eq("is_active", true) : skip,
  ]) as Array<{ data: unknown; error: unknown }>;
  if (vehicle.error || equipment.error || firearm.error || assigned.error || restrictions.error) return { failure: "error" };
  const matches = [vehicle, equipment, firearm].map((result) => rows(result.data));
  const firearms = {
    held: new Set(rows(assigned.data).filter((assignment) => text(assignment.assigned_to_user_id) === access.userId).map((assignment) => text(assignment.firearm_id))),
    eligible: restrictedCustodyEligible(access, rows(restrictions.data), rows(assigned.data)),
  };
  // Ambiguity is evaluated only over records the caller can see; the 409 body names no record.
  const visible = (["vehicle", "equipment", "firearm"] as const).map((table, index) => matches[index].filter((match) => qrVisible(access, table, match, firearms)));
  if (visible.some((match) => match.length > 1)) return { failure: "ambiguous" };
  const selected = visible[2][0] ?? null;
  return { vehicle: visible[0][0] ?? null, equipment: visible[1][0] ?? null, firearm: selected, firearmCustodyEligible: Boolean(selected && firearms.eligible.has(text(selected.id))) };
}
