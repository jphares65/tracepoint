import { cleanText, normalizeEmail, normalizeIdentifier, parseBoolean, validEmail } from "../normalize.ts";
import type { ImportReferenceData, PreviewRow, ValidationIssue } from "../types.ts";
import { changeList, duplicateIssue, finalizeRow, type MappedInputRow, requiredIssue } from "./common.ts";

function findExisting(row: Record<string, string>, reference: ImportReferenceData) {
  const matches = new Map<string, { person: ImportReferenceData["people"][number]; reasons: string[] }>();
  const checks: Array<[string, (person: ImportReferenceData["people"][number]) => string]> = [
    [normalizeIdentifier(row.badgeNumber), (person) => normalizeIdentifier(person.badgeNumber)],
    [normalizeIdentifier(row.employeeNumber), (person) => normalizeIdentifier(person.employeeNumber)],
    [normalizeEmail(row.email), (person) => normalizeEmail(person.email)],
  ];
  for (const [value, get] of checks) {
    if (!value) continue;
    for (const person of reference.people.filter((candidate) => get(candidate) === value)) {
      const current = matches.get(person.userId) ?? { person, reasons: [] };
      current.reasons.push(value.includes("@") ? "email" : "agency identifier");
      matches.set(person.userId, current);
    }
  }
  return [...matches.values()];
}

export function validatePersonnel(rows: MappedInputRow[], reference: ImportReferenceData): PreviewRow[] {
  const seenBadge = new Map<string, number>();
  const seenEmployee = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  return rows.map(({ rowNumber, values: raw }) => {
    const issues: ValidationIssue[] = [];
    const active = parseBoolean(raw.active, true);
    const values = {
      employeeNumber: cleanText(raw.employeeNumber, 100),
      badgeNumber: cleanText(raw.badgeNumber, 100),
      fullName: cleanText(raw.fullName, 250),
      firstName: cleanText(raw.firstName, 100),
      middleName: cleanText(raw.middleName, 100),
      lastName: cleanText(raw.lastName, 100),
      email: normalizeEmail(raw.email),
      phone: cleanText(raw.phone, 100),
      rankTitle: cleanText(raw.rankTitle, 150),
      unitName: cleanText(raw.unitName, 150),
      active: raw.active ? (active ?? true) : null,
    };
    requiredIssue(values.badgeNumber, "badgeNumber", "Badge number", issues);
    if (!values.fullName && (!values.firstName || !values.lastName)) issues.push({ severity: "error", field: "fullName", message: "Map Full name, or map both First name and Last name." });
    requiredIssue(values.email, "email", "Email", issues);
    if (values.email && !validEmail(values.email)) issues.push({ severity: "error", field: "email", message: "Email is not valid." });
    if (raw.active && active === null) issues.push({ severity: "error", field: "active", message: `Status "${cleanText(raw.active)}" is not recognized as active or inactive.` });

    const badgeKey = normalizeIdentifier(values.badgeNumber);
    const employeeKey = normalizeIdentifier(values.employeeNumber);
    const emailKey = normalizeEmail(values.email);
    duplicateIssue(seenBadge.get(badgeKey), "badgeNumber", "Badge number", issues);
    duplicateIssue(employeeKey ? seenEmployee.get(employeeKey) : undefined, "employeeNumber", "Employee ID", issues);
    duplicateIssue(seenEmail.get(emailKey), "email", "Email", issues);
    if (badgeKey && !seenBadge.has(badgeKey)) seenBadge.set(badgeKey, rowNumber);
    if (employeeKey && !seenEmployee.has(employeeKey)) seenEmployee.set(employeeKey, rowNumber);
    if (emailKey && !seenEmail.has(emailKey)) seenEmail.set(emailKey, rowNumber);

    const matches = findExisting(raw, reference);
    if (matches.length > 1) {
      issues.push({ severity: "error", message: "The incoming identifiers point to different existing personnel records." });
      return finalizeRow(rowNumber, values, "CONFLICT", issues);
    }
    const existing = matches[0]?.person;
    if (!existing) return finalizeRow(rowNumber, values, "CREATE", issues);
    const incoming = { ...values, fullName: values.fullName || [values.firstName, values.middleName, values.lastName].filter(Boolean).join(" ") };
    const changes = changeList("personnel", existing as unknown as Record<string, unknown>, incoming, {
      employeeNumber: "employeeNumber", badgeNumber: "badgeNumber", email: "email", phone: "phone", rankTitle: "rankTitle", unitName: "unitName", active: "active", fullName: "fullName",
    });
    return finalizeRow(rowNumber, values, changes.length ? "UPDATE" : "SKIP", issues, changes, existing.userId, matches[0].reasons.join(", "));
  });
}
