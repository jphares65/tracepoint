import { cleanText, normalizeIdentifier, normalizeLabel, parseImportDate } from "../normalize.ts";
import type { ImportReferenceData, PreviewRow, ValidationIssue } from "../types.ts";
import { changeList, duplicateIssue, finalizeRow, personMatch, requiredIssue, type MappedInputRow } from "./common.ts";

export function validateCertifications(rows: MappedInputRow[], reference: ImportReferenceData): PreviewRow[] {
  const seen = new Map<string, number>();
  return rows.map(({ rowNumber, values: raw }) => {
    const issues: ValidationIssue[] = [];
    const issueDate = parseImportDate(raw.issueDate);
    const expirationDate = parseImportDate(raw.expirationDate);
    const values = {
      personnelIdentifier: cleanText(raw.personnelIdentifier, 320), certificationTitle: cleanText(raw.certificationTitle, 250),
      credentialNumber: cleanText(raw.credentialNumber, 250), issueDate: issueDate.value, expirationDate: expirationDate.value,
      issuingOrganization: cleanText(raw.issuingOrganization, 250), notes: cleanText(raw.notes, 2000),
      userId: null as string | null, certificationTypeId: null as string | null,
    };
    requiredIssue(values.personnelIdentifier, "personnelIdentifier", "Personnel identifier", issues);
    requiredIssue(values.certificationTitle, "certificationTitle", "Certification type / name", issues);
    if (issueDate.error) issues.push({ severity: "error", field: "issueDate", message: issueDate.error });
    if (issueDate.warning) issues.push({ severity: "warning", field: "issueDate", message: issueDate.warning });
    if (expirationDate.error) issues.push({ severity: "error", field: "expirationDate", message: expirationDate.error });
    if (expirationDate.warning) issues.push({ severity: "warning", field: "expirationDate", message: expirationDate.warning });
    if (issueDate.value && expirationDate.value && expirationDate.value < issueDate.value) issues.push({ severity: "error", field: "expirationDate", message: "Expiration date cannot be before issue date." });

    const person = personMatch(values.personnelIdentifier, reference.people);
    if (person.kind === "none") issues.push({ severity: "error", field: "personnelIdentifier", message: "Personnel record was not found among active members of this agency." });
    if (person.kind === "ambiguous") issues.push({ severity: "error", field: "personnelIdentifier", message: "Personnel identifier is ambiguous. Use badge number, employee ID, or email." });
    if (person.kind === "one") {
      values.userId = person.person.userId;
      if (person.confidence === "Needs Review") issues.push({ severity: "warning", field: "personnelIdentifier", message: `Personnel matched ${person.person.fullName} by name only.` });
    }

    const types = reference.certificationTypes.filter((type) => type.is_active !== false && normalizeLabel(type.name) === normalizeLabel(values.certificationTitle));
    if (types.length === 0) issues.push({ severity: "error", field: "certificationTitle", message: `Certification type "${values.certificationTitle}" is not configured for this agency.` });
    if (types.length > 1) issues.push({ severity: "error", field: "certificationTitle", message: "Certification name matches multiple configured types." });
    if (types.length === 1) {
      values.certificationTypeId = types[0].id;
      values.certificationTitle = cleanText(types[0].name, 250);
      if (types[0].expiration_required === true && !expirationDate.value) issues.push({ severity: "error", field: "expirationDate", message: `Expiration date is required for ${values.certificationTitle}.` });
    }
    if (!values.credentialNumber && !values.issueDate && !values.expirationDate) issues.push({ severity: "error", message: "A certification number, issue date, or expiration date is required for safe duplicate detection." });

    const key = [values.userId, values.certificationTypeId, normalizeIdentifier(values.credentialNumber) || values.issueDate || values.expirationDate].join(":" );
    if (values.userId && values.certificationTypeId) duplicateIssue(seen.get(key), "certificationTitle", "Certification record", issues);
    if (values.userId && values.certificationTypeId && !seen.has(key)) seen.set(key, rowNumber);
    const matches = reference.certifications.filter((record) => {
      if (record.user_id !== values.userId || record.certification_type_id !== values.certificationTypeId) return false;
      if (values.credentialNumber) return normalizeIdentifier(record.credential_number) === normalizeIdentifier(values.credentialNumber);
      if (values.issueDate) return record.issue_date === values.issueDate;
      return record.expiration_date === values.expirationDate;
    });
    if (matches.length > 1) {
      issues.push({ severity: "error", message: "Multiple existing certification records match this row." });
      return finalizeRow(rowNumber, values, "CONFLICT", issues);
    }
    const existing = matches[0];
    if (!existing) return finalizeRow(rowNumber, values, "CREATE", issues);
    const changes = changeList("certifications", existing, values, {
      credentialNumber: "credential_number", issueDate: "issue_date", expirationDate: "expiration_date", issuingOrganization: "issuing_organization", notes: "notes",
    });
    return finalizeRow(rowNumber, values, changes.length ? "UPDATE" : "SKIP", issues, changes, existing.id, values.credentialNumber ? "certification number" : values.issueDate ? "issue date" : "expiration date");
  });
}
