import assert from "node:assert/strict";
import test from "node:test";

import { approvalToken, previewDigest } from "./fingerprint.ts";
import { parseImportPayload, validateImport, validateMappings } from "./validation.ts";
import type { ImportPayload, ImportReferenceData } from "./types.ts";

const EMPTY: ImportReferenceData = { people: [], firearms: [], firearmAssignments: [], certificationTypes: [], certifications: [], vehicles: [], fleetEquipment: [], equipmentTypes: [], equipment: [] };

function vehiclePayload(): ImportPayload {
  return {
    file: { name: "fleet.csv", size: 100, sha256: "d".repeat(64), type: "text/csv", sheetCount: 1 }, domain: "vehicles", sheetName: "Fleet", headerRow: 1,
    matrix: [["Unit", "Status", "Mileage", "Warranty"], ["1", "IN SERVICE", "51k", "1/2/2026"], ["2", "IN SERVICE", "51k", "1/2/2026"]],
    mappings: [
      { sourceColumn: "Unit", targetField: "unitNumber", confidence: "High", samples: [] }, { sourceColumn: "Status", targetField: "status", confidence: "High", samples: [] },
      { sourceColumn: "Mileage", targetField: "currentMileage", confidence: "High", samples: [] }, { sourceColumn: "Warranty", targetField: "mdtWarrantyExpiration", confidence: "High", samples: [] },
    ], overrides: [], rowDecisions: [],
  };
}

test("single-row, matching-column, enum, number, and date overrides revalidate without mutating the workbook", () => {
  const payload = vehiclePayload();
  const immutable = structuredClone(payload.matrix);
  payload.overrides = [
    { rowNumber: 2, sourceColumn: "Status", targetField: "status", originalValue: "IN SERVICE", replacementValue: "Available", scope: "row" },
    { rowNumber: 2, sourceColumn: "Mileage", targetField: "currentMileage", originalValue: "51k", replacementValue: "51000", scope: "column" },
    { rowNumber: 2, sourceColumn: "Warranty", targetField: "mdtWarrantyExpiration", originalValue: "1/2/2026", replacementValue: "2026-01-02", scope: "column" },
  ];
  const validated = validateImport(payload, EMPTY);
  assert.equal(validated.rows[0].values.status, "Available");
  assert.equal(validated.rows[1].values.status, "IN SERVICE");
  assert.equal(validated.rows[0].values.currentMileage, 51000);
  assert.equal(validated.rows[1].values.currentMileage, 51000);
  assert.equal(validated.rows[1].values.mdtWarrantyExpiration, "2026-01-02");
  assert.deepEqual(payload.matrix, immutable);
});

test("resolver metadata offers deterministic suggestions and canonical values without auto-applying", () => {
  const validated = validateImport(vehiclePayload(), EMPTY);
  const status = validated.rows[0].issues.find((issue) => issue.field === "status")!;
  const mileage = validated.rows[0].issues.find((issue) => issue.field === "currentMileage")!;
  const date = validated.rows[0].issues.find((issue) => issue.field === "mdtWarrantyExpiration")!;
  assert.equal(status.resolution?.control, "enum");
  assert.equal(status.resolution?.suggestedValue, "Available");
  assert.ok(status.resolution?.options?.some((option) => option.value === "Retired"));
  assert.equal(mileage.resolution?.suggestedValue, "51000");
  assert.equal(date.resolution?.suggestedValue, "2026-01-02");
  assert.equal(validated.summary.blocked > 0, true);
});

test("configured certification and equipment aliases use canonical dropdowns", () => {
  const certification: ImportPayload = {
    file: { name: "cert.csv", size: 50, sha256: "e".repeat(64), type: "text/csv", sheetCount: 1 }, domain: "certifications", sheetName: "Certs", headerRow: 1,
    matrix: [["Person", "Type", "Number"], ["10", "CPR/AED", "X"]], mappings: [
      { sourceColumn: "Person", targetField: "personnelIdentifier", confidence: "High", samples: [] }, { sourceColumn: "Type", targetField: "certificationTitle", confidence: "High", samples: [] }, { sourceColumn: "Number", targetField: "credentialNumber", confidence: "High", samples: [] },
    ],
  };
  const reference: ImportReferenceData = { ...EMPTY, people: [{ userId: "u", fullName: "A B", badgeNumber: "10", employeeNumber: null, email: "a@b.gov", phone: null, rankTitle: null, unitName: null, active: true }], certificationTypes: [{ id: "c", name: "First Aid / CPR", is_active: true }] };
  const issue = validateImport(certification, reference).rows[0].issues.find((item) => item.field === "certificationTitle")!;
  assert.equal(issue.resolution?.control, "enum");
  assert.equal(issue.resolution?.suggestedValue, "First Aid / CPR");

  const equipment: ImportPayload = { ...certification, domain: "equipment", matrix: [["Type", "Serial"], ["Notebook Computer", "N1"]], mappings: [{ sourceColumn: "Type", targetField: "equipmentType", confidence: "High", samples: [] }, { sourceColumn: "Serial", targetField: "serialNumber", confidence: "High", samples: [] }] };
  const equipmentIssue = validateImport(equipment, { ...EMPTY, equipmentTypes: [{ id: "l", name: "Laptop Computer", is_active: true }] }).rows[0].issues.find((item) => item.field === "equipmentType")!;
  assert.equal(equipmentIssue.resolution?.suggestedValue, "Laptop Computer");
});

test("approval fingerprint binds overrides and forged cross-column replacement is rejected", () => {
  const original = vehiclePayload();
  const first = validateImport(original, EMPTY);
  const digest = previewDigest(first.rows, first.summary);
  const amended = { ...original, overrides: [{ rowNumber: 2, sourceColumn: "Mileage", targetField: "currentMileage", originalValue: "51k", replacementValue: "51000", scope: "column" as const }] };
  assert.notEqual(approvalToken(original, digest, "dept", "actor"), approvalToken(amended, digest, "dept", "actor"));
  assert.throws(() => parseImportPayload({ ...original, overrides: [{ rowNumber: 2, sourceColumn: "Status", targetField: "status", originalValue: "IN SERVICE", replacementValue: "Available", scope: "import" }] }), /Cross-column remediation is not safe/);
  assert.throws(() => parseImportPayload({ ...original, overrides: [{ rowNumber: 2, sourceColumn: "Mileage", targetField: "status", originalValue: "51k", replacementValue: "Available", scope: "column" }] }), /mapped source column/);
});

test("duplicate resolution is explicit and supports keep-first and keep-later", () => {
  const payload: ImportPayload = { file: { name: "fleet.csv", size: 50, sha256: "f".repeat(64), type: "text/csv", sheetCount: 1 }, domain: "vehicles", sheetName: "Fleet", headerRow: 1, matrix: [["Unit", "Make"], ["A1", "Ford"], ["A1", "Chevy"]], mappings: [{ sourceColumn: "Unit", targetField: "unitNumber", confidence: "High", samples: [] }, { sourceColumn: "Make", targetField: "make", confidence: "High", samples: [] }] };
  const unresolved = validateImport(payload, EMPTY);
  assert.equal(unresolved.rows[1].issues[0].conflict?.kind, "duplicate");
  const keepFirst = validateImport({ ...payload, rowDecisions: [{ rowNumber: 3, sourceConflictRowNumber: 3, resolution: "keep_first" }] }, EMPTY);
  assert.equal(keepFirst.rows.find((row) => row.rowNumber === 3)?.action, "SKIP");
  const keepLater = validateImport({ ...payload, rowDecisions: [{ rowNumber: 2, sourceConflictRowNumber: 3, resolution: "keep_later" }] }, EMPTY);
  assert.equal(keepLater.rows.find((row) => row.rowNumber === 2)?.action, "SKIP");
  assert.equal(keepLater.rows.find((row) => row.rowNumber === 3)?.status, "valid");
});

test("parsed overrides remain separate from immutable mapped source values", () => {
  const parsed = parseImportPayload({ ...vehiclePayload(), overrides: [{ rowNumber: 2, sourceColumn: "Mileage", targetField: "currentMileage", originalValue: "51k", replacementValue: "51000", scope: "row" }] });
  const mapped = validateMappings(parsed);
  assert.equal(mapped.originalMappedRows[0].values.currentMileage, "51k");
  assert.equal(mapped.mappedRows[0].values.currentMileage, "51000");
});
