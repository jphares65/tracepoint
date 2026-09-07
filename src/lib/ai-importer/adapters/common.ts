import { fieldFor } from "../catalog.ts";
import { cleanText, normalizeEmail, normalizeIdentifier, normalizeLabel } from "../normalize.ts";
import type { ImportChange, ImportDomain, PersonReference, PreviewRow, ValidationIssue } from "../types.ts";

export type MappedInputRow = { rowNumber: number; values: Record<string, string> };

export function personMatch(value: unknown, people: PersonReference[], activeOnly = true) {
  const input = cleanText(value, 320);
  if (!input) return { kind: "none" as const };
  const pool = activeOnly ? people.filter((person) => person.active) : people;
  const identifier = normalizeIdentifier(input);
  const email = normalizeEmail(input);
  const stable = pool.filter((person) =>
    (email.includes("@") && normalizeEmail(person.email) === email) ||
    (identifier && [person.badgeNumber, person.employeeNumber].some((candidate) => normalizeIdentifier(candidate) === identifier)),
  );
  if (stable.length === 1) return { kind: "one" as const, person: stable[0], reason: email.includes("@") ? "email" : "agency identifier", confidence: "High" as const };
  if (stable.length > 1) return { kind: "ambiguous" as const, people: stable };

  const name = normalizeLabel(input.replace(/^(chief|capt(?:ain)?|lt|lieutenant|sgt|sergeant|cpl|corporal|det|detective|officer)\.?\s+/i, ""));
  const byName = pool.filter((person) => normalizeLabel(person.fullName) === name);
  if (byName.length === 1) return { kind: "one" as const, person: byName[0], reason: "name only", confidence: "Needs Review" as const };
  if (byName.length > 1) return { kind: "ambiguous" as const, people: byName };
  return { kind: "none" as const };
}

export function changeList(domain: ImportDomain, existing: Record<string, unknown>, incoming: Record<string, unknown>, columns: Record<string, string>) {
  const changes: ImportChange[] = [];
  for (const [field, column] of Object.entries(columns)) {
    const next = incoming[field];
    if (next === null || next === undefined || next === "") continue;
    const previous = existing[column] as string | number | boolean | null | undefined;
    const same = typeof next === "string" && typeof previous === "string"
      ? normalizeLabel(next) === normalizeLabel(previous)
      : next === previous || String(next) === String(previous ?? "");
    if (!same) changes.push({ field, label: fieldFor(domain, field)?.label ?? field, previous: previous ?? null, next: next as string | number | boolean });
  }
  return changes;
}

export function finalizeRow(rowNumber: number, values: Record<string, string | number | boolean | null>, action: PreviewRow["action"], issues: ValidationIssue[], changes: ImportChange[] = [], matchId?: string, matchReason?: string): PreviewRow {
  const blocked = issues.some((issue) => issue.severity === "error") || action === "CONFLICT";
  return {
    rowNumber,
    values,
    action: blocked ? "CONFLICT" : action,
    issues,
    changes,
    matchId,
    matchReason,
    status: blocked ? "blocked" : issues.length > 0 ? "warning" : "valid",
  };
}

export function requiredIssue(value: unknown, field: string, label: string, issues: ValidationIssue[]) {
  if (!cleanText(value)) issues.push({ severity: "error", field, message: `${label} is required.` });
}

export function duplicateIssue(firstRow: number | undefined, field: string, label: string, issues: ValidationIssue[]) {
  if (firstRow) issues.push({ severity: "error", field, message: `${label} duplicates spreadsheet row ${firstRow}. Resolve the duplicate before import.` });
}
