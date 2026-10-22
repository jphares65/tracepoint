/* eslint-disable @typescript-eslint/no-explicit-any -- JSON from the application's own APIs */
// Synthetic records are created through the application's own APIs, as the role
// that would create them, so authorization is exercised, not bypassed.
import { expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { baseUrl, runLabel, storageStatePath, type Role } from "./env";
import { assertSyntheticAgency } from "./session";

export async function apiAs(role: Role) {
  const context = await playwrightRequest.newContext({ baseURL: baseUrl(), storageState: storageStatePath(role) });
  const access = await assertSyntheticAgency(context);
  return { request: context, access };
}

async function json(response: Awaited<ReturnType<APIRequestContext["get"]>>, what: string) {
  const body = await response.json().catch(() => ({}));
  expect(response.ok(), `${what}: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy();
  return body as any;
}

// ---------- Range ----------

export async function getRangeWorkspace(request: APIRequestContext) {
  const body = await json(await request.get("/api/pilot/range-workspace"), "load range workspace");
  return { workspace: body.workspace ?? {}, updatedAt: body.updatedAt ?? null } as { workspace: any; updatedAt: string | null };
}

export async function putRangeWorkspace(request: APIRequestContext, workspace: unknown, baseUpdatedAt: string | null) {
  return request.put("/api/pilot/range-workspace", { data: { workspace, baseUpdatedAt } });
}

/** Adds one In Progress range day with the given drills and officers (as a range manager). */
export async function seedRangeDay(request: APIRequestContext, input: {
  managerId: string;
  officers: { officerId: string; firearmId: string }[];
  drills: { name: string; scoringFormat: string; maxScore?: number; passingScore?: number }[];
}) {
  const { workspace, updatedAt } = await getRangeWorkspace(request);
  const { access } = await (await request.get("/api/access")).json();
  const dayId = `range-day-${randomUUID()}`;
  const title = `${runLabel} range`;
  const day = {
    id: dayId, departmentId: access.departmentId, title, date: new Date().toISOString().slice(0, 10), startTime: "0800", endTime: "1200",
    location: "E2E range", status: "In Progress", rangeType: "Qualification", attendanceMode: "Scheduled Roster",
    packetStatus: "Needs Setup", leadInstructorId: input.managerId, instructorIds: [input.managerId], staffingNotes: "", outline: [], notes: "",
  };
  const drills = input.drills.map((drill) => ({ id: `drill-${randomUUID()}`, rangeDayId: dayId, runCount: 1, firearmType: "Any", scoringMode: "Scored", ...drill }));
  const roster = input.officers.map((officer) => ({ id: `roster-${randomUUID()}`, rangeDayId: dayId, officerId: officer.officerId, assignedFirearmIds: [officer.firearmId], attended: true }));
  const next = {
    ...workspace,
    rangeDays: [...(workspace.rangeDays ?? []), day],
    rangeDayDrills: [...(workspace.rangeDayDrills ?? []), ...drills],
    rangeRoster: [...(workspace.rangeRoster ?? []), ...roster],
  };
  await json(await putRangeWorkspace(request, next, updatedAt), "seed range day");
  return { dayId, title, drillIds: drills.map((drill) => drill.id) };
}

export async function rangeResults(request: APIRequestContext, dayId: string) {
  const { workspace } = await getRangeWorkspace(request);
  return (workspace.results ?? []).filter((result: any) => result.rangeDayId === dayId);
}

// ---------- Armory ----------

export async function createFirearm(request: APIRequestContext, assignedToUserId?: string) {
  const serial = `E2E-${randomUUID().slice(0, 8).toUpperCase()}`;
  const body = await json(await request.post("/api/armory/firearms", { data: { make: "E2E", model: runLabel, serialNumber: serial, firearmType: "handgun", caliber: "9mm", assignedToUserId } }), "create firearm");
  return String(body.firearmId);
}

export async function firearmStatus(request: APIRequestContext, firearmId: string) {
  const body = await json(await request.get("/api/armory/firearms?includeArchived=true"), "load firearms");
  return body.firearms.find((firearm: any) => firearm.id === firearmId)?.condition_status as string;
}

export async function recordInspection(request: APIRequestContext, firearmId: string, result: string) {
  return json(await request.post("/api/armory/inspections", { data: { firearmId, inspectionType: "Routine Firearm Inspection", result, checklist: [{ section: "E2E", label: "Safe for duty use", status: result === "Passed" ? "Pass" : "Fail", critical: true, note: "" }] } }), `record ${result} inspection`);
}

export async function setDutyOnly(request: APIRequestContext, firearmId: string) {
  return json(await request.put(`/api/armory/firearms/${firearmId}/custody`, { data: { restrictionType: "duty_only", reason: runLabel } }), "set Duty Only");
}

export async function createStorageLocation(request: APIRequestContext) {
  const body = await json(await request.post("/api/armory/storage-locations", { data: { name: `${runLabel} locker` } }), "create storage location");
  return String(body.storageLocationId);
}

export async function custody(request: APIRequestContext, firearmId: string) {
  return json(await request.get(`/api/armory/firearms/${firearmId}/custody`), "load custody");
}

// ---------- Fleet ----------

export async function createVehicle(request: APIRequestContext) {
  const unitNumber = `E2E-${randomUUID().slice(0, 6).toUpperCase()}`;
  const body = await json(await request.post("/api/fleet/vehicles", { data: { unitNumber, currentMileage: 1000, status: "Available" } }), "create vehicle");
  return { id: String(body.item.id), unitNumber };
}

export async function getFleetRules(request: APIRequestContext) {
  return (await json(await request.get("/api/fleet/rules"), "load fleet rules")).rules ?? {};
}

export async function putFleetRules(request: APIRequestContext, rules: Record<string, unknown>) {
  return json(await request.put("/api/fleet/rules", { data: rules }), "save fleet rules");
}

export async function vehicle(request: APIRequestContext, vehicleId: string) {
  return json(await request.get(`/api/fleet/vehicles/${vehicleId}`), "load vehicle");
}
