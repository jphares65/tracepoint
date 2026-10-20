import type { ServerAccessContext } from "./server-access";
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

export function qrDecision(input: { identifier: string; access: Pick<ServerAccessContext, "permissions" | "enabledFeatures">; vehicle?: Row | null; equipment?: Row | null; firearm?: Row | null }) {
  const identifier = input.identifier.trim();
  if (!identifier || identifier.length > 2048) return { status: "unknown", message: "This QR code is not valid." };
  const permissions = new Set(input.access.permissions);
  const allowed = (...values: string[]) => permissions.has("administer_department") || values.some((value) => permissions.has(value as never));
  if (input.vehicle) return allowed("perform_fleet_inspections", "view_fleet", "manage_fleet") && input.access.enabledFeatures.includes("fleet")
    ? { entityType: "vehicle", entityId: text(input.vehicle.id), displayName: `Unit ${text(input.vehicle.unit_number) || "vehicle"}`, workflow: "vehicle_inspection", allowed: true }
    : { status: "denied", message: "You are not authorized to use this vehicle workflow." };
  if (input.equipment) return input.access.enabledFeatures.includes("equipment_readiness")
    ? { entityType: "equipment", entityId: text(input.equipment.id), displayName: [text(input.equipment.manufacturer), text(input.equipment.model)].filter(Boolean).join(" ") || "Equipment", workflow: "equipment_custody", allowed: true }
    : { status: "denied", message: "Equipment Readiness is not enabled for this agency." };
  if (input.firearm) return allowed("firearm_custody.check_out", "firearm_custody.check_in", "manage_firearms")
    ? { entityType: "firearm", entityId: text(input.firearm.id), workflow: "firearm_custody", allowed: true }
    : { status: "denied", message: "You are not authorized to use firearm custody." };
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
// A handle that matches more than one row in a table is reported as ambiguous instead of guessing a record.
export async function lookupQrRecords(admin: ServerAccessContext["admin"], departmentId: string, parsed: { handle: string; kind: TracePointQrKind | null }): Promise<{ vehicle: QrMatch; equipment: QrMatch; firearm: QrMatch } | { failure: "error" | "ambiguous" }> {
  const { handle, kind } = parsed;
  const skip = Promise.resolve({ data: [], error: null });
  const [vehicle, equipment, firearm] = await Promise.all([
    !kind || kind === "vehicle" ? admin.from("fleet_vehicles").select("id,unit_number,vin,status").eq("department_id", departmentId).or(qrLookupFilter(handle, ["unit_number", "vin"])).limit(2) : skip,
    !kind || kind === "equipment" ? admin.from("equipment_assets").select("id,manufacturer,model,serial_number,asset_number,lifecycle_status").eq("department_id", departmentId).neq("lifecycle_status", "removed").or(qrLookupFilter(handle, ["asset_number", "serial_number"])).limit(2) : skip,
    !kind ? admin.from("firearms").select("id,serial_number,asset_number,is_active").eq("department_id", departmentId).eq("is_active", true).or(qrLookupFilter(handle, ["asset_number", "serial_number"])).limit(2) : skip,
  ]) as Array<{ data: unknown; error: unknown }>;
  if (vehicle.error || equipment.error || firearm.error) return { failure: "error" };
  const matches = [vehicle, equipment, firearm].map((result) => rows(result.data));
  if (matches.some((match) => match.length > 1)) return { failure: "ambiguous" };
  return { vehicle: matches[0][0] ?? null, equipment: matches[1][0] ?? null, firearm: matches[2][0] ?? null };
}
