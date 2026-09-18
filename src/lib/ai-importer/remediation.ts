import { fieldFor } from "./catalog.ts";
import { cleanText, normalizeLabel, parseImportDate } from "./normalize.ts";
import type { MappedInputRow } from "./adapters/common.ts";
import type { CanonicalOption, ImportDomain, ImportPayload, ImportReferenceData, PreviewRow, ValidationIssue } from "./types.ts";

const STATIC_OPTIONS: Partial<Record<ImportDomain, Record<string, CanonicalOption[]>>> = {
  personnel: {
    active: [{ value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }],
  },
  firearms: {
    firearmType: [
      { value: "handgun", label: "Handgun" }, { value: "rifle", label: "Rifle" }, { value: "shotgun", label: "Shotgun" },
      { value: "less_lethal", label: "Less lethal" }, { value: "other", label: "Other" },
    ],
    conditionStatus: ["In Service", "Out of Service", "Maintenance", "Inspection Required", "Retired"].map((value) => ({ value, label: value })),
  },
  vehicles: {
    status: ["Available", "Attention", "Maintenance", "Out of Service", "Retired"].map((value) => ({ value, label: value })),
  },
  equipment: {
    lifecycleStatus: [
      { value: "active", label: "Active" }, { value: "maintenance", label: "Maintenance" }, { value: "expired", label: "Expired" },
    ],
  },
};

const KNOWN_ALIASES: Record<string, string> = {
  "in service": "Available",
  "notebook computer": "Laptop Computer",
};

function uniqueOptions(options: CanonicalOption[]) {
  return [...new Map(options.map((option) => [option.value, option])).values()];
}

function peopleOptions(reference: ImportReferenceData): CanonicalOption[] {
  return reference.people.filter((person) => person.active).map((person) => {
    const value = person.badgeNumber || person.employeeNumber || person.email || "";
    return { value, label: `${person.fullName}${person.badgeNumber ? ` · Badge ${person.badgeNumber}` : ""}` };
  }).filter((option) => option.value);
}

export function canonicalOptions(domain: ImportDomain, field: string, reference: ImportReferenceData): CanonicalOption[] {
  const staticOptions = STATIC_OPTIONS[domain]?.[field] ?? [];
  if (domain === "certifications" && field === "certificationTitle") {
    return uniqueOptions(reference.certificationTypes.filter((item) => item.is_active !== false).map((item) => ({ value: cleanText(item.name, 250), label: cleanText(item.name, 250) })).filter((item) => item.value));
  }
  if (domain === "equipment" && field === "equipmentType") {
    return uniqueOptions(reference.equipmentTypes.filter((item) => item.is_active !== false).map((item) => ({ value: cleanText(item.name, 250), label: cleanText(item.name, 250) })).filter((item) => item.value));
  }
  if (["assignedPersonnel", "personnelIdentifier"].includes(field)) return peopleOptions(reference);
  return staticOptions;
}

export function numericSuggestion(value: unknown, integer: boolean) {
  const text = cleanText(value, 100).replaceAll(",", "").toLowerCase();
  const match = text.match(/^([+-]?\d+(?:\.\d+)?)\s*([km])$/);
  if (!match) return undefined;
  const number = Number(match[1]) * (match[2] === "k" ? 1_000 : 1_000_000);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number))) return undefined;
  return String(number);
}

function suggestedCanonical(sourceValue: string, options: CanonicalOption[]) {
  const normalized = normalizeLabel(sourceValue);
  const alias = KNOWN_ALIASES[normalized];
  if (alias) {
    const match = options.find((option) => normalizeLabel(option.value) === normalizeLabel(alias));
    if (match) return match.value;
  }
  const sourceTokens = new Set(normalized.split(" ").filter((token) => token.length > 2));
  const candidates = options.filter((option) => {
    const tokens = normalizeLabel(option.label).split(" ");
    return tokens.some((token) => sourceTokens.has(token));
  });
  return candidates.length === 1 ? candidates[0].value : undefined;
}

export function importScopeIsSafe(payload: ImportPayload, targetField: string) {
  const kind = fieldFor(payload.domain, targetField)?.kind;
  return kind === "date" || kind === "boolean";
}

export function applyValueOverrides(rows: MappedInputRow[], originalRows: MappedInputRow[], payload: ImportPayload): MappedInputRow[] {
  const originalByRow = new Map(originalRows.map((row) => [row.rowNumber, row]));
  return rows.map((row) => {
    const values = { ...row.values };
    for (const override of payload.overrides ?? []) {
      const originalAnchor = originalByRow.get(override.rowNumber);
      if (!originalAnchor || originalAnchor.values[override.targetField] !== override.originalValue) continue;
      if (override.scope === "row") {
        if (row.rowNumber === override.rowNumber) values[override.targetField] = override.replacementValue;
        continue;
      }
      if (override.scope === "column") {
        if (originalByRow.get(row.rowNumber)?.values[override.targetField] === override.originalValue) values[override.targetField] = override.replacementValue;
        continue;
      }
      if (!importScopeIsSafe(payload, override.targetField)) continue;
      const anchorKind = fieldFor(payload.domain, override.targetField)?.kind;
      for (const mapping of payload.mappings) {
        if (!mapping.targetField || fieldFor(payload.domain, mapping.targetField)?.kind !== anchorKind) continue;
        if (originalByRow.get(row.rowNumber)?.values[mapping.targetField] === override.originalValue) values[mapping.targetField] = override.replacementValue;
      }
    }
    return { ...row, values };
  });
}

export function annotateResolvableIssues(payload: ImportPayload, rows: PreviewRow[], workingRows: MappedInputRow[], originalRows: MappedInputRow[], reference: ImportReferenceData) {
  const workingByRow = new Map(workingRows.map((row) => [row.rowNumber, row.values]));
  const originalByRow = new Map(originalRows.map((row) => [row.rowNumber, row.values]));
  const sourceByField = new Map(payload.mappings.filter((mapping) => mapping.targetField).map((mapping) => [mapping.targetField!, mapping.sourceColumn]));
  return rows.map((row) => ({
    ...row,
    issues: row.issues.map((issue): ValidationIssue => {
      if (!issue.field && row.action === "CONFLICT") return { ...issue, conflict: issue.conflict ?? { kind: "record" } };
      if (!issue.field || issue.conflict) return issue;
      const field = fieldFor(payload.domain, issue.field);
      const sourceColumn = sourceByField.get(issue.field);
      if (!field || !sourceColumn) return issue;
      const sourceValue = workingByRow.get(row.rowNumber)?.[issue.field] ?? "";
      const originalValue = originalByRow.get(row.rowNumber)?.[issue.field] ?? "";
      const options = canonicalOptions(payload.domain, issue.field, reference);
      if (options.length) return { ...issue, sourceColumn, sourceValue, originalValue, resolution: { control: "enum", options, suggestedValue: suggestedCanonical(sourceValue, options) } };
      if (field.kind === "integer" || field.kind === "decimal") return { ...issue, sourceColumn, sourceValue, originalValue, resolution: { control: "number", suggestedValue: numericSuggestion(sourceValue, field.kind === "integer") } };
      if (field.kind === "date") return { ...issue, sourceColumn, sourceValue, originalValue, resolution: { control: "date", suggestedValue: parseImportDate(sourceValue).value ?? undefined, expectedFormat: "YYYY-MM-DD", allowImportScope: true } };
      if (field.kind === "boolean") return { ...issue, sourceColumn, sourceValue, originalValue, resolution: { control: "enum", options: STATIC_OPTIONS.personnel?.active, allowImportScope: true } };
      return { ...issue, sourceColumn, sourceValue, originalValue, resolution: { control: "text" } };
    }),
  }));
}
