import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_INVENTORY_QUERY,
  applyInventoryView,
  clearAdvancedFilters,
  parseInventoryQuery,
  serializeInventoryQuery,
  serviceState,
  sortFleetVehicles,
  type FleetInventoryVehicle,
  type InventoryQueryState,
} from "./inventory-state.ts";

const NOW = new Date("2026-09-08T12:00:00-04:00");

function vehicle(
  id: string,
  overrides: Partial<FleetInventoryVehicle> = {},
): FleetInventoryVehicle {
  return {
    id,
    unit_number: id,
    vin: null,
    license_plate: null,
    year: 2025,
    make: "Ford",
    model: "Interceptor",
    vehicle_type: "Patrol",
    assignment_type: "Pool",
    assigned_to: null,
    home_location: null,
    current_mileage: 10_000,
    current_hours: 1_000,
    status: "Available",
    inspection_due_date: "2026-12-01",
    next_service_date: "2026-12-01",
    next_service_mileage: 15_000,
    open_issue_count: 0,
    ...overrides,
  };
}

function query(overrides: Partial<InventoryQueryState> = {}): InventoryQueryState {
  return { ...DEFAULT_INVENTORY_QUERY, ...overrides };
}

test("sorts natural units and each typed inventory column in both directions", () => {
  const records = [
    vehicle("10", { year: 2024, make: "Zulu", current_mileage: 900, open_issue_count: 3 }),
    vehicle("2", { year: 2023, make: "Alpha", assigned_to: "Bravo", home_location: "South", current_mileage: 100, open_issue_count: 1, status: "Maintenance" }),
    vehicle("1A", { year: 2023, make: "Bravo", assigned_to: "Alpha", home_location: "North", current_mileage: 500, open_issue_count: 2, status: "Attention" }),
  ];

  assert.deepEqual(sortFleetVehicles(records, "unit", "asc").map((item) => item.id), ["1A", "2", "10"]);
  assert.deepEqual(sortFleetVehicles(records, "vehicle", "asc").map((item) => item.id), ["2", "1A", "10"]);
  assert.deepEqual(sortFleetVehicles(records, "mileage", "desc").map((item) => item.id), ["10", "1A", "2"]);
  assert.deepEqual(sortFleetVehicles(records, "issues", "asc").map((item) => item.id), ["2", "1A", "10"]);
  assert.deepEqual(sortFleetVehicles(records, "assignment", "asc").map((item) => item.id), ["1A", "2", "10"]);
  assert.deepEqual(sortFleetVehicles(records, "status", "asc").map((item) => item.id), ["1A", "10", "2"]);
});

test("sorts inspection dates and mileage-only service thresholds, leaving missing schedules last", () => {
  const records = [
    vehicle("missing", { inspection_due_date: null, next_service_date: null, next_service_mileage: null }),
    vehicle("later", { inspection_due_date: "2026-10-01", next_service_date: null, current_mileage: 10_000, next_service_mileage: 12_000 }),
    vehicle("earlier", { inspection_due_date: "2026-09-01", next_service_date: null, current_mileage: 10_000, next_service_mileage: 10_500 }),
  ];

  assert.deepEqual(sortFleetVehicles(records, "inspection", "asc").map((item) => item.id), ["earlier", "later", "missing"]);
  assert.deepEqual(sortFleetVehicles(records, "service", "asc", NOW).map((item) => item.id), ["earlier", "later", "missing"]);
  assert.equal(serviceState(records[2], NOW), "due-soon");
  assert.equal(serviceState(records[0], NOW), "not-scheduled");
});

test("applies search, status, vehicle, assignment, location, readiness, and issues together", () => {
  const matching = vehicle("K9-2", {
    make: "Chevrolet",
    model: "Tahoe",
    vehicle_type: "K9",
    assignment_type: "Permanent",
    assigned_to: "Canine Unit",
    home_location: "North Precinct",
    status: "Attention",
    inspection_due_date: "2026-09-01",
    next_service_date: null,
    current_mileage: 50_000,
    next_service_mileage: 49_500,
    open_issue_count: 2,
  });
  const state = query({
    search: "canine",
    status: "Attention",
    vehicle: "tahoe k9",
    assignment: "Permanent",
    location: "North Precinct",
    inspection: "overdue",
    service: "overdue",
    issues: "open",
  });

  assert.deepEqual(
    applyInventoryView([vehicle("other"), matching], state, NOW).map((item) => item.id),
    ["K9-2"],
  );
});

test("clearing advanced filters preserves search, status, and sorting", () => {
  const state = query({
    search: "patrol",
    status: "Available",
    vehicle: "Ford",
    assignment: "Pool",
    location: "HQ",
    inspection: "current",
    service: "due-soon",
    issues: "none",
    sort: "unit",
    direction: "desc",
  });

  assert.deepEqual(clearAdvancedFilters(state), {
    ...state,
    vehicle: "",
    assignment: "",
    location: "",
    inspection: "",
    service: "",
    issues: "",
  });
});

test("malformed and outdated URL values fall back safely and valid state round-trips", () => {
  assert.deepEqual(
    parseInventoryQuery("?status=Flying&assignment=Officer&inspection=late&service=soon&issues=yes&sort=edit&dir=sideways"),
    DEFAULT_INVENTORY_QUERY,
  );

  const state = query({
    search: "Unit 12",
    status: "Maintenance",
    vehicle: "2024 Ford",
    location: "HQ",
    inspection: "not-scheduled",
    issues: "none",
    sort: "status",
    direction: "desc",
  });
  assert.deepEqual(parseInventoryQuery(serializeInventoryQuery(state)), state);
  assert.equal(parseInventoryQuery("?vehicle=2024%20").vehicle, "2024 ");
});

test("missing data is searchable, filterable, and sortable without throwing", () => {
  const missing = vehicle("missing", {
    year: null,
    make: null,
    model: null,
    vehicle_type: null,
    assigned_to: null,
    home_location: null,
    current_mileage: null,
    inspection_due_date: "not-a-date",
    next_service_date: null,
    next_service_mileage: null,
    open_issue_count: null,
  });

  assert.deepEqual(applyInventoryView([missing], query({ inspection: "not-scheduled", service: "not-scheduled", issues: "none" }), NOW), [missing]);
  assert.deepEqual(sortFleetVehicles([missing, vehicle("complete")], "mileage", "asc").map((item) => item.id), ["complete", "missing"]);
  assert.deepEqual(sortFleetVehicles([missing, vehicle("complete")], "mileage", "desc").map((item) => item.id), ["complete", "missing"]);
});
