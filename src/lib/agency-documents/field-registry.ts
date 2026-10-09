export type DocumentFieldCategory = "People" | "Agency" | "Firearms" | "Qualifications / Range" | "Document";

export type DocumentFieldDefinition = {
  key: string;
  label: string;
  category: DocumentFieldCategory;
  description: string;
  dataType: "text" | "date" | "number" | "boolean";
  supportsFormatting: boolean;
};

/** Stable, friendly document fields. Templates never persist physical database columns. */
export const DOCUMENT_FIELD_REGISTRY: readonly DocumentFieldDefinition[] = [
  { key: "person.full_name", label: "Full name", category: "People", description: "The selected person's complete name.", dataType: "text", supportsFormatting: true },
  { key: "person.first_name", label: "First name", category: "People", description: "The selected person's first name.", dataType: "text", supportsFormatting: true },
  { key: "person.last_name", label: "Last name", category: "People", description: "The selected person's last name.", dataType: "text", supportsFormatting: true },
  { key: "person.badge_number", label: "Badge number", category: "People", description: "The selected person's badge number.", dataType: "text", supportsFormatting: true },
  { key: "person.rank", label: "Rank", category: "People", description: "The selected person's rank.", dataType: "text", supportsFormatting: true },
  { key: "person.email", label: "Email", category: "People", description: "The selected person's work email.", dataType: "text", supportsFormatting: true },
  { key: "agency.name", label: "Agency name", category: "Agency", description: "The current agency's full name.", dataType: "text", supportsFormatting: true },
  { key: "agency.short_name", label: "Short name", category: "Agency", description: "The current agency's short name.", dataType: "text", supportsFormatting: true },
  { key: "agency.ori", label: "ORI", category: "Agency", description: "The agency ORI when configured.", dataType: "text", supportsFormatting: true },
  { key: "agency.address", label: "Address", category: "Agency", description: "The agency address when configured.", dataType: "text", supportsFormatting: true },
  { key: "agency.chief_name", label: "Chief / Director name", category: "Agency", description: "The agency leader when configured.", dataType: "text", supportsFormatting: true },
  { key: "document.report_year", label: "Document report year", category: "Document", description: "The report year selected when generating this document.", dataType: "number", supportsFormatting: true },
  { key: "document.report_date", label: "Document report date", category: "Document", description: "The date the document is generated, unless a value is supplied when generating.", dataType: "date", supportsFormatting: true },
  { key: "firearm.manufacturer", label: "Manufacturer", category: "Firearms", description: "The selected firearm manufacturer.", dataType: "text", supportsFormatting: true },
  { key: "firearm.model", label: "Model", category: "Firearms", description: "The selected firearm model.", dataType: "text", supportsFormatting: true },
  { key: "firearm.serial_number", label: "Serial number", category: "Firearms", description: "The selected firearm serial number.", dataType: "text", supportsFormatting: true },
  { key: "firearm.caliber", label: "Caliber", category: "Firearms", description: "The selected firearm caliber.", dataType: "text", supportsFormatting: true },
  { key: "firearm.asset_number", label: "Asset number", category: "Firearms", description: "The selected firearm asset number.", dataType: "text", supportsFormatting: true },
  { key: "firearm.assigned_officer", label: "Assigned officer", category: "Firearms", description: "The firearm's currently assigned officer.", dataType: "text", supportsFormatting: true },
  { key: "firearm.type", label: "Firearm type", category: "Firearms", description: "The selected firearm type.", dataType: "text", supportsFormatting: true },
  { key: "qualification.date", label: "Qualification date", category: "Qualifications / Range", description: "The selected qualification date.", dataType: "date", supportsFormatting: true },
  { key: "qualification.course_name", label: "Course / drill name", category: "Qualifications / Range", description: "The selected qualification course or drill.", dataType: "text", supportsFormatting: true },
  { key: "qualification.score", label: "Score", category: "Qualifications / Range", description: "The selected qualification score.", dataType: "number", supportsFormatting: true },
  { key: "qualification.result", label: "Result / Pass-Fail", category: "Qualifications / Range", description: "The selected qualification result.", dataType: "text", supportsFormatting: true },
  { key: "qualification.instructor", label: "Instructor", category: "Qualifications / Range", description: "The recorded qualification instructor.", dataType: "text", supportsFormatting: true },
] as const;

export function searchDocumentFields(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return DOCUMENT_FIELD_REGISTRY;
  return DOCUMENT_FIELD_REGISTRY.filter((field) => `${field.label} ${field.category} ${field.description}`.toLowerCase().includes(normalized));
}

export function getDocumentField(key: string) {
  return DOCUMENT_FIELD_REGISTRY.find((field) => field.key === key) ?? null;
}
