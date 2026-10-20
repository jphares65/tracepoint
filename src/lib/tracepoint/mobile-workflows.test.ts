import assert from "node:assert/strict";
import test from "node:test";
import { PostgresDataClient } from "../database/postgres-data-client.ts";
import { lookupQrRecords, parseQrIdentifier, qrDecision, qrLookupFilter, rangeDayDetailPayload, rangeDayPayload } from "./mobile-workflows.ts";
import { buildTracePointQrValue } from "./qr-identifiers.ts";

const access = { permissions: ["score_range_days", "perform_fleet_inspections"] as never[], enabledFeatures: ["fleet", "equipment_readiness"] };
test("mobile range days separate and preserve ordered drills with document availability", () => {
  const workspace = { rangeDays: [{ id: "today", title: "Today", date: "2026-10-06", status: "Planned" }], rangeDayDrills: [{ id: "two", rangeDayId: "today", name: "Two", sortOrder: 2, sourceTemplateId: "template" }, { id: "one", rangeDayId: "today", name: "One", sortOrder: 1 }], rangeRoster: [{ id: "r", rangeDayId: "today", officerId: "officer", attended: true }] };
  assert.equal(rangeDayPayload(workspace)[0].id, "today");
  const detail = rangeDayDetailPayload(workspace, "today", new Map([["template", ["document"]]]));
  assert.deepEqual(detail?.drills.map((drill) => drill.id), ["one", "two"]);
  assert.equal(detail?.drills[1].documentId, "document");
});
test("QR decisions do not disclose an unauthorized firearm", () => {
  assert.deepEqual(qrDecision({ identifier: "qr", access, vehicle: { id: "v", unit_number: "12" } }), { entityType: "vehicle", entityId: "v", displayName: "Unit 12", workflow: "vehicle_inspection", allowed: true });
  assert.equal(qrDecision({ identifier: "qr", access: { permissions: [] as never[], enabledFeatures: [] }, firearm: { id: "f" } }).status, "denied");
  assert.equal(qrDecision({ identifier: "", access }).status, "unknown");
});

const record = "11111111-0000-4000-8000-000000000001";
const department = "20000000-0000-4000-8000-000000000001";
function qrClient(rowsByTable: Record<string, Record<string, unknown>[]> = {}) {
  const statements: Array<{ text: string; values?: readonly unknown[] }> = [];
  const connection = {
    async query(text: string, values?: readonly unknown[]) {
      if (!text.startsWith("select ") || text.includes("set_config")) return { rows: [], rowCount: 0 };
      statements.push({ text, values });
      const rows = rowsByTable[/from public\."([a-z_]+)"/.exec(text)?.[1] ?? ""] ?? [];
      return { rows, rowCount: rows.length };
    },
    release() {},
  };
  return { admin: new PostgresDataClient({ async connect() { return connection; } } as never, record, department), statements };
}

test("QR resolver accepts the printed label value and every previously accepted handle", () => {
  assert.deepEqual(parseQrIdentifier(buildTracePointQrValue("vehicle", record)), { handle: record, kind: "vehicle" });
  assert.deepEqual(parseQrIdentifier(buildTracePointQrValue("equipment", "EQ-0042")), { handle: "EQ-0042", kind: "equipment" });
  assert.deepEqual(parseQrIdentifier("TRACEPOINT://Equipment/EQ-0042/"), { handle: "EQ-0042", kind: "equipment" });
  for (const handle of [record, "3101", "FA-0001", "SN.12:3_4", "1HGCM82633A004352"]) assert.deepEqual(parseQrIdentifier(handle), { handle, kind: null });
  for (const value of ["", "https://app.example/q/firearm/" + record, "tracepoint://firearm/" + record, "tracepoint://vehicle/", "tracepoint://vehicle/a/b", buildTracePointQrValue("equipment", "asset 42"), "tracepoint://vehicle/%E0%A4%A", "unit 12", "a,id.neq.x", "tracepoint://vehicle/a%2Cid.neq.x"]) assert.equal(parseQrIdentifier(value), null, value);
});

test("QR lookup compares only UUID handles to uuid id columns", () => {
  assert.equal(qrLookupFilter("3101", ["unit_number", "vin"]), "unit_number.eq.3101,vin.eq.3101");
  assert.equal(qrLookupFilter(record, ["unit_number", "vin"]), `id.eq.${record},unit_number.eq.${record},vin.eq.${record}`);
});

test("QR lookup SQL never binds a non-UUID handle to an id comparison", async () => {
  const value = qrClient({ firearms: [{ id: record, asset_number: "FA-0001" }] });
  const result = await lookupQrRecords(value.admin, department, { handle: "FA-0001", kind: null });
  assert.deepEqual(result, { vehicle: null, equipment: null, firearm: { id: record, asset_number: "FA-0001" } });
  assert.equal(value.statements.length, 3);
  for (const statement of value.statements) {
    assert.doesNotMatch(statement.text, /t\."id" =/);
    assert.match(statement.text, / limit 2$/);
    assert.deepEqual(statement.values?.slice(-2), ["FA-0001", "FA-0001"]);
  }
  const uuidLookup = qrClient();
  await lookupQrRecords(uuidLookup.admin, department, { handle: record, kind: null });
  for (const statement of uuidLookup.statements) assert.match(statement.text, /\(t\."id" = \$\d+ or /);
});

test("QR lookup honours the label kind and reports duplicate matches as ambiguous", async () => {
  const labelled = qrClient({ fleet_vehicles: [{ id: record, unit_number: "12" }] });
  assert.deepEqual(await lookupQrRecords(labelled.admin, department, { handle: record, kind: "vehicle" }), { vehicle: { id: record, unit_number: "12" }, equipment: null, firearm: null });
  assert.deepEqual(labelled.statements.map((statement) => /from public\."([a-z_]+)"/.exec(statement.text)?.[1]), ["fleet_vehicles"]);
  const duplicated = qrClient({ equipment_assets: [{ id: "a" }, { id: "b" }] });
  assert.deepEqual(await lookupQrRecords(duplicated.admin, department, { handle: "SN-1", kind: null }), { failure: "ambiguous" });
});
