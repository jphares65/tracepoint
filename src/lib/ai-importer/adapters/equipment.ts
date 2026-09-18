import { cleanText, normalizeIdentifier, normalizeLabel, parseImportDate } from "../normalize.ts";
import type { ImportReferenceData, PreviewRow, ValidationIssue } from "../types.ts";
import { changeList, duplicateIssue, finalizeRow, personMatch, requiredIssue, type MappedInputRow } from "./common.ts";

function lifecycle(value: unknown) {
  const normalized = normalizeLabel(value);
  if (!normalized || ["active", "current", "in service", "issued"].includes(normalized)) return "active";
  if (["maintenance", "repair", "out of service"].includes(normalized)) return "maintenance";
  if (["expired", "past expiration"].includes(normalized)) return "expired";
  return null;
}

export function validateEquipment(rows: MappedInputRow[], reference: ImportReferenceData): PreviewRow[] {
  const seenSerial = new Map<string, number>();
  const seenAsset = new Map<string, number>();
  return rows.map(({ rowNumber, values: raw }) => {
    const issues: ValidationIssue[] = [];
    const dateFields = ["issueDate", "expirationDate", "lastInspectionDate", "nextInspectionDate"] as const;
    const dates = Object.fromEntries(dateFields.map((field) => [field, parseImportDate(raw[field])])) as Record<(typeof dateFields)[number], ReturnType<typeof parseImportDate>>;
    const status = lifecycle(raw.lifecycleStatus);
    const values = {
      equipmentType: cleanText(raw.equipmentType, 250), assetNumber: cleanText(raw.assetNumber, 250), serialNumber: cleanText(raw.serialNumber, 250).toUpperCase(),
      manufacturer: cleanText(raw.manufacturer, 250), model: cleanText(raw.model, 250), lotNumber: cleanText(raw.lotNumber, 250),
      lifecycleStatus: raw.lifecycleStatus ? (status ?? cleanText(raw.lifecycleStatus, 100)) : null,
      assignedPersonnel: cleanText(raw.assignedPersonnel, 320), assignedLocation: cleanText(raw.assignedLocation, 250),
      issueDate: dates.issueDate.value, expirationDate: dates.expirationDate.value, lastInspectionDate: dates.lastInspectionDate.value, nextInspectionDate: dates.nextInspectionDate.value,
      notes: cleanText(raw.notes, 2000), assignedUserId: null as string | null, equipmentTypeId: null as string | null,
    };
    requiredIssue(values.equipmentType, "equipmentType", "Equipment type", issues);
    if (!values.serialNumber && !values.assetNumber) issues.push({ severity: "error", message: "Serial number or asset number is required for safe duplicate detection." });
    if (raw.lifecycleStatus && !status) issues.push({ severity: "error", field: "lifecycleStatus", message: `Equipment status "${raw.lifecycleStatus}" is not supported for import.` });
    for (const field of dateFields) {
      if (dates[field].error) issues.push({ severity: "error", field, message: dates[field].error! });
      if (dates[field].warning) issues.push({ severity: "warning", field, message: dates[field].warning! });
    }
    if (values.lastInspectionDate && values.nextInspectionDate && values.nextInspectionDate < values.lastInspectionDate) issues.push({ severity: "error", field: "nextInspectionDate", message: "Next inspection date cannot be before the last inspection date." });
    const typeMatches = reference.equipmentTypes.filter((type) => type.is_active !== false && normalizeLabel(type.name) === normalizeLabel(values.equipmentType));
    if (typeMatches.length === 0) issues.push({ severity: "error", field: "equipmentType", message: `Equipment type "${values.equipmentType}" is not configured. Map it to an existing type before import.` });
    if (typeMatches.length > 1) issues.push({ severity: "error", field: "equipmentType", message: "Equipment type matches multiple configured types." });
    if (typeMatches.length === 1) {
      values.equipmentTypeId = typeMatches[0].id;
      values.equipmentType = cleanText(typeMatches[0].name, 250);
      if (typeMatches[0].expiration_required === true && !values.expirationDate) issues.push({ severity: "error", field: "expirationDate", message: `Expiration date is required for ${values.equipmentType}.` });
    }
    if (values.assignedPersonnel && values.assignedLocation) issues.push({ severity: "error", message: "Equipment can be assigned to either a person or location, not both." });
    if (values.assignedPersonnel) {
      const match = personMatch(values.assignedPersonnel, reference.people);
      if (match.kind === "none") issues.push({ severity: "error", field: "assignedPersonnel", message: "Assigned person was not found among active personnel in this agency." });
      if (match.kind === "ambiguous") issues.push({ severity: "error", field: "assignedPersonnel", message: "Assigned person is ambiguous. Use badge number, employee ID, or email." });
      if (match.kind === "one") {
        values.assignedUserId = match.person.userId;
        if (match.confidence === "Needs Review") issues.push({ severity: "warning", field: "assignedPersonnel", message: `Assignment matched ${match.person.fullName} by name only.` });
      }
    }
    const serialKey = normalizeIdentifier(values.serialNumber);
    const assetKey = normalizeIdentifier(values.assetNumber);
    duplicateIssue(serialKey ? seenSerial.get(serialKey) : undefined, "serialNumber", "Serial number", issues);
    duplicateIssue(assetKey ? seenAsset.get(assetKey) : undefined, "assetNumber", "Asset number", issues);
    if (serialKey && !seenSerial.has(serialKey)) seenSerial.set(serialKey, rowNumber);
    if (assetKey && !seenAsset.has(assetKey)) seenAsset.set(assetKey, rowNumber);
    const serialMatches = serialKey ? reference.equipment.filter((item) => normalizeIdentifier(item.serial_number) === serialKey) : [];
    const assetMatches = assetKey ? reference.equipment.filter((item) => normalizeIdentifier(item.asset_number) === assetKey) : [];
    const ids = new Set([...serialMatches, ...assetMatches].map((item) => item.id));
    if (ids.size > 1 || serialMatches.length > 1 || assetMatches.length > 1) {
      issues.push({ severity: "error", message: "Serial and asset identifiers match different existing equipment records." });
      return finalizeRow(rowNumber, values, "CONFLICT", issues);
    }
    const existing = [...serialMatches, ...assetMatches][0];
    if (!existing) return finalizeRow(rowNumber, values, "CREATE", issues);
    const changes = changeList("equipment", existing, values, {
      equipmentTypeId: "equipment_type_id", assetNumber: "asset_number", manufacturer: "manufacturer", model: "model", lotNumber: "lot_number",
      lifecycleStatus: "lifecycle_status", assignedUserId: "assigned_user_id", assignedLocation: "assigned_location", issueDate: "issue_date",
      expirationDate: "expiration_date", lastInspectionDate: "last_inspection_date", nextInspectionDate: "next_inspection_date", notes: "notes",
    });
    return finalizeRow(rowNumber, values, changes.length ? "UPDATE" : "SKIP", issues, changes, existing.id, serialMatches.length ? "normalized serial number" : "asset number");
  });
}
