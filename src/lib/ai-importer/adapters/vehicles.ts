import { cleanText, normalizeIdentifier, normalizeLabel, parseDecimal, parseImportDate, parseInteger } from "../normalize.ts";
import type { ImportReferenceData, PreviewRow, ValidationIssue } from "../types.ts";
import { changeList, duplicateIssue, finalizeRow, requiredIssue, type MappedInputRow } from "./common.ts";

const STATUS: Record<string, string> = {
  available: "Available", active: "Available", attention: "Attention", maintenance: "Maintenance", repair: "Maintenance",
  "out of service": "Out of Service", retired: "Retired",
};

function vehicleStatus(value: unknown) {
  const normalized = normalizeLabel(value);
  return normalized ? STATUS[normalized] ?? null : "Available";
}

const WARRANTY_FIELDS = ["mdtWarrantyExpiration", "modemWarrantyExpiration", "mvrWarrantyExpiration", "radarWarrantyExpiration"] as const;

export function validateVehicles(rows: MappedInputRow[], reference: ImportReferenceData): PreviewRow[] {
  const seenUnits = new Map<string, number>();
  const seenVins = new Map<string, number>();
  return rows.map(({ rowNumber, values: raw }) => {
    const issues: ValidationIssue[] = [];
    const year = parseInteger(raw.year);
    const mileage = parseInteger(raw.currentMileage);
    const hours = parseDecimal(raw.currentHours);
    const status = vehicleStatus(raw.status);
    const warranties = Object.fromEntries(WARRANTY_FIELDS.map((field) => [field, parseImportDate(raw[field])])) as Record<(typeof WARRANTY_FIELDS)[number], ReturnType<typeof parseImportDate>>;
    const vin = normalizeIdentifier(raw.vin);
    const values: Record<string, string | number | boolean | null> = {
      unitNumber: cleanText(raw.unitNumber, 100), vin, licensePlate: cleanText(raw.licensePlate, 100).toUpperCase(),
      year: year.value, make: cleanText(raw.make, 150), model: cleanText(raw.model, 150), vehicleType: cleanText(raw.vehicleType, 150),
      status: raw.status ? (status ?? cleanText(raw.status, 100)) : null,
      currentMileage: raw.currentMileage ? mileage.value : null, currentHours: raw.currentHours ? hours.value : null,
      comments: cleanText(raw.comments, 2000), mdtSerial: cleanText(raw.mdtSerial, 250), modemSerial: cleanText(raw.modemSerial, 250),
      mvrSerial: cleanText(raw.mvrSerial, 250), radarSerial: cleanText(raw.radarSerial, 250), radarTuningForkSerial: cleanText(raw.radarTuningForkSerial, 250),
      ...Object.fromEntries(WARRANTY_FIELDS.map((field) => [field, warranties[field].value])),
    };
    requiredIssue(values.unitNumber, "unitNumber", "Unit number", issues);
    if (vin && (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))) issues.push({ severity: "error", field: "vin", message: "VIN must contain 17 valid characters (I, O, and Q are not used)." });
    if (year.error) issues.push({ severity: "error", field: "year", message: year.error });
    if (year.value !== null && (year.value < 1900 || year.value > new Date().getUTCFullYear() + 2)) issues.push({ severity: "error", field: "year", message: "Vehicle year is outside the supported range." });
    if (mileage.error || (mileage.value !== null && mileage.value < 0)) issues.push({ severity: "error", field: "currentMileage", message: mileage.error ?? "Mileage cannot be negative." });
    if (hours.error || (hours.value !== null && hours.value < 0)) issues.push({ severity: "error", field: "currentHours", message: hours.error ?? "Hours cannot be negative." });
    if (raw.status && !status) issues.push({ severity: "error", field: "status", message: `Vehicle status "${raw.status}" is not supported.` });
    for (const field of WARRANTY_FIELDS) {
      if (warranties[field].error) issues.push({ severity: "error", field, message: warranties[field].error! });
      if (warranties[field].warning) issues.push({ severity: "warning", field, message: warranties[field].warning! });
    }
    const unitKey = normalizeIdentifier(values.unitNumber);
    duplicateIssue(seenUnits.get(unitKey), "unitNumber", "Unit number", issues);
    if (unitKey && !seenUnits.has(unitKey)) seenUnits.set(unitKey, rowNumber);
    duplicateIssue(vin ? seenVins.get(vin) : undefined, "vin", "VIN", issues);
    if (vin && !seenVins.has(vin)) seenVins.set(vin, rowNumber);
    const units = reference.vehicles.filter((vehicle) => normalizeIdentifier(vehicle.unit_number) === unitKey);
    const vins = vin ? reference.vehicles.filter((vehicle) => normalizeIdentifier(vehicle.vin) === vin) : [];
    const ids = new Set([...units, ...vins].map((vehicle) => vehicle.id));
    if (ids.size > 1 || units.length > 1 || vins.length > 1) {
      issues.push({ severity: "error", message: "Unit number and VIN match different existing vehicles." });
      return finalizeRow(rowNumber, values, "CONFLICT", issues);
    }
    const existing = [...units, ...vins][0];
    if (!existing) return finalizeRow(rowNumber, values, "CREATE", issues);
    const changes = changeList("vehicles", existing, values, {
      vin: "vin", licensePlate: "license_plate", year: "year", make: "make", model: "model", vehicleType: "vehicle_type",
      status: "status", currentMileage: "current_mileage", currentHours: "current_hours", comments: "comments",
    });
    const categories: Array<[string, string, string]> = [["MDT", "mdtSerial", "mdtWarrantyExpiration"], ["Modem", "modemSerial", "modemWarrantyExpiration"], ["MVR", "mvrSerial", "mvrWarrantyExpiration"], ["Radar", "radarSerial", "radarWarrantyExpiration"]];
    for (const [category, serialField, warrantyField] of categories) {
      const serial = String(values[serialField] ?? "");
      const warranty = String(values[warrantyField] ?? "");
      if (!serial && !warranty) continue;
      const installed = reference.fleetEquipment.find((item) => item.vehicle_id === existing.id && normalizeLabel(item.category) === normalizeLabel(category) && item.status !== "Removed");
      if (!installed) changes.push({ field: serialField, label: `${category} installed asset`, previous: null, next: serial || `Warranty ${warranty}` });
      else if ((serial && normalizeIdentifier(installed.serial_number) !== normalizeIdentifier(serial)) || (warranty && installed.warranty_expiration_date !== warranty)) changes.push({ field: serialField, label: `${category} installed asset`, previous: cleanText(installed.serial_number), next: serial || cleanText(installed.serial_number) });
    }
    return finalizeRow(rowNumber, values, changes.length ? "UPDATE" : "SKIP", issues, changes, existing.id, vins.length ? "VIN" : "unit number");
  });
}
