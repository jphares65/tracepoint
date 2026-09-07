import { cleanText, normalizeIdentifier, normalizeLabel, parseImportDate } from "../normalize.ts";
import type { ImportReferenceData, PreviewRow, ValidationIssue } from "../types.ts";
import { changeList, duplicateIssue, finalizeRow, personMatch, requiredIssue, type MappedInputRow } from "./common.ts";

export function normalizeFirearmType(value: unknown) {
  const normalized = normalizeLabel(value);
  if (["pistol", "sidearm", "handgun"].includes(normalized)) return "handgun";
  if (["rifle", "carbine"].includes(normalized)) return "rifle";
  if (normalized === "shotgun") return "shotgun";
  if (["less lethal", "lesslethal"].includes(normalized)) return "less_lethal";
  if (["other", "specialty"].includes(normalized)) return "other";
  return normalized ? null : "other";
}

export function normalizeFirearmStatus(value: unknown) {
  const normalized = normalizeLabel(value);
  if (!normalized || ["in service", "serviceable", "available"].includes(normalized)) return "In Service";
  if (["out of service", "unserviceable"].includes(normalized)) return "Out of Service";
  if (["maintenance", "repair"].includes(normalized)) return "Maintenance";
  if (["inspection required", "inspection due"].includes(normalized)) return "Inspection Required";
  if (normalized === "retired") return "Retired";
  return null;
}

export function validateFirearms(rows: MappedInputRow[], reference: ImportReferenceData): PreviewRow[] {
  const seen = new Map<string, number>();
  return rows.map(({ rowNumber, values: raw }) => {
    const issues: ValidationIssue[] = [];
    const date = parseImportDate(raw.acquisitionDate);
    const firearmType = normalizeFirearmType(raw.firearmType);
    const conditionStatus = normalizeFirearmStatus(raw.conditionStatus);
    const values = {
      serialNumber: cleanText(raw.serialNumber, 250).toUpperCase(),
      assetNumber: cleanText(raw.assetNumber, 250),
      make: cleanText(raw.make, 250), model: cleanText(raw.model, 250), caliber: cleanText(raw.caliber, 100),
      firearmType: raw.firearmType ? (firearmType ?? cleanText(raw.firearmType, 100)) : null,
      conditionStatus: raw.conditionStatus ? (conditionStatus ?? cleanText(raw.conditionStatus, 100)) : null,
      assignedPersonnel: cleanText(raw.assignedPersonnel, 320), acquisitionDate: date.value, notes: cleanText(raw.notes, 2000),
      assignedUserId: null as string | null,
    };
    requiredIssue(values.serialNumber, "serialNumber", "Serial number", issues);
    const serialKey = normalizeIdentifier(values.serialNumber);
    duplicateIssue(seen.get(serialKey), "serialNumber", "Serial number", issues);
    if (serialKey && !seen.has(serialKey)) seen.set(serialKey, rowNumber);
    if (!values.make) issues.push({ severity: "warning", field: "make", message: "Make is blank and will be recorded as TBD / Unknown." });
    if (!values.model) issues.push({ severity: "warning", field: "model", message: "Model is blank and will be recorded as TBD / Unknown." });
    if (!values.caliber) issues.push({ severity: "warning", field: "caliber", message: "Caliber is blank and will be recorded as TBD / Unknown." });
    if (raw.firearmType && !firearmType) issues.push({ severity: "error", field: "firearmType", message: `Firearm type "${raw.firearmType}" is not supported.` });
    if (raw.conditionStatus && !conditionStatus) issues.push({ severity: "error", field: "conditionStatus", message: `Firearm status "${raw.conditionStatus}" is not supported.` });
    if (date.error) issues.push({ severity: "error", field: "acquisitionDate", message: date.error });
    if (date.warning) issues.push({ severity: "warning", field: "acquisitionDate", message: date.warning });
    if (values.assignedPersonnel) {
      const match = personMatch(values.assignedPersonnel, reference.people);
      if (match.kind === "none") issues.push({ severity: "error", field: "assignedPersonnel", message: "Assigned person was not found among active personnel in this agency." });
      if (match.kind === "ambiguous") issues.push({ severity: "error", field: "assignedPersonnel", message: "Assigned person matches more than one active personnel record. Map a stable agency identifier." });
      if (match.kind === "one") {
        values.assignedUserId = match.person.userId;
        if (match.confidence === "Needs Review") issues.push({ severity: "warning", field: "assignedPersonnel", message: `Assignment matched ${match.person.fullName} by name only.` });
      }
      if ((conditionStatus ?? "In Service") !== "In Service") issues.push({ severity: "error", field: "conditionStatus", message: "Only an in-service firearm can be assigned during import." });
    }

    const serialMatches = reference.firearms.filter((firearm) => normalizeIdentifier(firearm.serial_number) === serialKey);
    const assetKey = normalizeIdentifier(values.assetNumber);
    const assetMatches = assetKey ? reference.firearms.filter((firearm) => normalizeIdentifier(firearm.asset_number) === assetKey) : [];
    const ids = new Set([...serialMatches, ...assetMatches].map((item) => item.id));
    if (ids.size > 1 || serialMatches.length > 1 || assetMatches.length > 1) {
      issues.push({ severity: "error", message: "Serial and asset identifiers match conflicting firearm records." });
      return finalizeRow(rowNumber, values, "CONFLICT", issues);
    }
    const existing = [...serialMatches, ...assetMatches][0];
    if (!existing) return finalizeRow(rowNumber, values, "CREATE", issues);
    const assignment = reference.firearmAssignments.find((item) => item.firearm_id === existing.id && !item.returned_at);
    if (assignment && values.assignedUserId && assignment.assigned_to_user_id !== values.assignedUserId) issues.push({ severity: "error", field: "assignedPersonnel", message: "This firearm is actively assigned to a different person." });
    const changes = changeList("firearms", existing, values, {
      assetNumber: "asset_number", make: "make", model: "model", caliber: "caliber", firearmType: "firearm_type", conditionStatus: "condition_status", acquisitionDate: "acquisition_date", notes: "notes",
    });
    if (values.assignedUserId && !assignment) changes.push({ field: "assignedPersonnel", label: "Assigned person", previous: null, next: values.assignedPersonnel });
    return finalizeRow(rowNumber, values, changes.length ? "UPDATE" : "SKIP", issues, changes, existing.id, serialMatches.length ? "normalized serial number" : "asset number");
  });
}
