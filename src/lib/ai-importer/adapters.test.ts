import assert from "node:assert/strict";
import test from "node:test";

import { IMPORT_FIELDS } from "./catalog.ts";
import type { ImportDomain, ImportPayload, ImportReferenceData } from "./types.ts";
import { validateImport } from "./validation.ts";

const EMPTY: ImportReferenceData = { people: [], firearms: [], firearmAssignments: [], certificationTypes: [], certifications: [], vehicles: [], fleetEquipment: [], equipmentTypes: [], equipment: [] };

function payload(domain: ImportDomain, records: Array<Record<string, string>>): ImportPayload {
  const headers = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return {
    file: { name: "test.csv", size: 100, sha256: "b".repeat(64), type: "text/csv", sheetCount: 1 },
    domain, sheetName: "Sheet1", headerRow: 1,
    matrix: [headers, ...records.map((record) => headers.map((header) => record[header] ?? ""))],
    mappings: headers.map((header) => ({ sourceColumn: header, targetField: IMPORT_FIELDS[domain].some((field) => field.key === header) ? header : null, confidence: "High", samples: [] })),
  };
}

function person(userId: string, overrides: Partial<ImportReferenceData["people"][number]> = {}): ImportReferenceData["people"][number] {
  return { userId, fullName: "Jane Doe", email: "jane@example.gov", phone: null, badgeNumber: "100", employeeNumber: "E100", rankTitle: "Officer", unitName: "Patrol", active: true, ...overrides };
}

test("personnel proposes creates, stable-identifier updates, duplicate blocks, and identifier conflicts", () => {
  const create = validateImport(payload("personnel", [{ badgeNumber: "200", firstName: "John", lastName: "Smith", email: "john@example.gov" }]), EMPTY);
  assert.equal(create.rows[0].action, "CREATE");
  const reference = { ...EMPTY, people: [person("u1")] };
  const update = validateImport(payload("personnel", [{ badgeNumber: "100", firstName: "Jane", lastName: "Doe", email: "jane@example.gov", rankTitle: "Sergeant" }]), reference);
  assert.equal(update.rows[0].action, "UPDATE");
  assert.equal(update.rows[0].changes[0].field, "rankTitle");
  const duplicate = validateImport(payload("personnel", [
    { badgeNumber: "201", firstName: "A", lastName: "One", email: "a@example.gov" },
    { badgeNumber: "201", firstName: "B", lastName: "Two", email: "b@example.gov" },
  ]), EMPTY);
  assert.equal(duplicate.rows[1].status, "blocked");
  const conflictReference = { ...EMPTY, people: [person("u1"), person("u2", { fullName: "Other Person", email: "other@example.gov", badgeNumber: "999", employeeNumber: "E999" })] };
  const conflict = validateImport(payload("personnel", [{ badgeNumber: "100", firstName: "Jane", lastName: "Doe", email: "other@example.gov" }]), conflictReference);
  assert.equal(conflict.rows[0].action, "CONFLICT");
});
test("firearms normalize serials, detect duplicates, resolve assignments, and block unknown people", () => {
  const reference: ImportReferenceData = { ...EMPTY, people: [person("u1")], firearms: [{ id: "f1", serial_number: "AB-12", asset_number: "A1", make: "Glock", model: "17", caliber: "9mm", firearm_type: "handgun", condition_status: "In Service" }], firearmAssignments: [] };
  const update = validateImport(payload("firearms", [{ serialNumber: "ab 12", make: "Glock", model: "19", caliber: "9mm", firearmType: "Pistol", assignedPersonnel: "100" }]), reference);
  assert.equal(update.rows[0].action, "UPDATE");
  assert.equal(update.rows[0].values.assignedUserId, "u1");
  assert.ok(update.rows[0].changes.some((change) => change.field === "model"));
  const duplicate = validateImport(payload("firearms", [{ serialNumber: "XY-1" }, { serialNumber: "xy 1" }]), EMPTY);
  assert.equal(duplicate.rows[1].status, "blocked");
  const unknown = validateImport(payload("firearms", [{ serialNumber: "Z9", assignedPersonnel: "Missing Person" }]), reference);
  assert.equal(unknown.rows[0].status, "blocked");
  const assignmentConflict = validateImport(payload("firearms", [{ serialNumber: "AB12", assignedPersonnel: "100" }]), { ...reference, firearmAssignments: [{ id: "a1", firearm_id: "f1", assigned_to_user_id: "someone-else", returned_at: null }] });
  assert.equal(assignmentConflict.rows[0].action, "CONFLICT");
});

test("certifications match personnel and configured normalized names, parse dates, and avoid duplicates", () => {
  const reference: ImportReferenceData = { ...EMPTY, people: [person("u1")], certificationTypes: [{ id: "ct1", name: "First Aid / CPR", is_active: true, expiration_required: true }], certifications: [{ id: "c1", user_id: "u1", certification_type_id: "ct1", credential_number: "CERT-9", issue_date: "2025-01-01", expiration_date: "2027-01-01" }] };
  const existing = validateImport(payload("certifications", [{ personnelIdentifier: "E100", certificationTitle: "first aid cpr", credentialNumber: "cert 9", issueDate: "1/1/2025", expirationDate: "1/1/2027", issuingOrganization: "Red Cross" }]), reference);
  assert.equal(existing.rows[0].action, "UPDATE");
  assert.equal(existing.rows[0].values.certificationTypeId, "ct1");
  const unknown = validateImport(payload("certifications", [{ personnelIdentifier: "999", certificationTitle: "First Aid / CPR", credentialNumber: "X", expirationDate: "2027-01-01" }]), reference);
  assert.equal(unknown.rows[0].status, "blocked");
  const dates = validateImport(payload("certifications", [{ personnelIdentifier: "100", certificationTitle: "First Aid / CPR", credentialNumber: "NEW", issueDate: "2027-01-02", expirationDate: "2027-01-01" }]), reference);
  assert.equal(dates.rows[0].status, "blocked");
  const duplicate = validateImport(payload("certifications", [
    { personnelIdentifier: "100", certificationTitle: "First Aid / CPR", credentialNumber: "SAME", expirationDate: "2028-01-01" },
    { personnelIdentifier: "100", certificationTitle: "First Aid / CPR", credentialNumber: "same", expirationDate: "2028-01-01" },
  ]), reference);
  assert.equal(duplicate.rows[1].status, "blocked");
});

test("vehicles normalize VINs, match unit numbers, validate values, and preview installed assets", () => {
  const reference: ImportReferenceData = { ...EMPTY, vehicles: [{ id: "v1", unit_number: "CAR-12", vin: "1HGCM82633A004352", make: "Ford", current_mileage: 1000, current_hours: 10, status: "Available" }], fleetEquipment: [] };
  const update = validateImport(payload("vehicles", [{ unitNumber: "car 12", vin: "1hgcm82633a004352", make: "Ford", currentMileage: "1500", radarSerial: "RAD-1" }]), reference);
  assert.equal(update.rows[0].action, "UPDATE");
  assert.ok(update.rows[0].changes.some((change) => change.field === "radarSerial"));
  const duplicate = validateImport(payload("vehicles", [{ unitNumber: "A-1" }, { unitNumber: "a 1" }]), EMPTY);
  assert.equal(duplicate.rows[1].status, "blocked");
  const invalid = validateImport(payload("vehicles", [{ unitNumber: "B1", vin: "INVALID", year: "1800", currentMileage: "-5" }]), EMPTY);
  assert.equal(invalid.rows[0].status, "blocked");
});

test("equipment requires configured types, stable assets, valid expiration, and department personnel", () => {
  const reference: ImportReferenceData = { ...EMPTY, people: [person("u1")], equipmentTypes: [{ id: "t1", name: "Body Armor", is_active: true, expiration_required: true }], equipment: [{ id: "e1", equipment_type_id: "t1", serial_number: "BA-1", asset_number: "A-1", manufacturer: "Safariland", expiration_date: "2027-01-01", lifecycle_status: "active" }] };
  const update = validateImport(payload("equipment", [{ equipmentType: "body-armor", serialNumber: "ba 1", assetNumber: "A1", manufacturer: "Safariland", model: "X", expirationDate: "1/1/2027", assignedPersonnel: "100" }]), reference);
  assert.equal(update.rows[0].action, "UPDATE");
  assert.equal(update.rows[0].values.assignedUserId, "u1");
  const unknownType = validateImport(payload("equipment", [{ equipmentType: "Mystery Gear", serialNumber: "M1" }]), reference);
  assert.equal(unknownType.rows[0].status, "blocked");
  const unknownPerson = validateImport(payload("equipment", [{ equipmentType: "Body Armor", serialNumber: "M2", expirationDate: "2028-01-01", assignedPersonnel: "Nobody" }]), reference);
  assert.equal(unknownPerson.rows[0].status, "blocked");
  const duplicate = validateImport(payload("equipment", [
    { equipmentType: "Body Armor", serialNumber: "M3", expirationDate: "2028-01-01" },
    { equipmentType: "Body Armor", serialNumber: "m-3", expirationDate: "2028-01-01" },
  ]), reference);
  assert.equal(duplicate.rows[1].status, "blocked");
  const badDate = validateImport(payload("equipment", [{ equipmentType: "Body Armor", serialNumber: "M4", expirationDate: "never" }]), reference);
  assert.equal(badDate.rows[0].status, "blocked");
});
