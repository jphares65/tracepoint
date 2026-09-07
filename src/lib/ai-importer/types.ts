export const IMPORT_DOMAINS = [
  "personnel",
  "firearms",
  "certifications",
  "vehicles",
  "equipment",
] as const;

export type ImportDomain = (typeof IMPORT_DOMAINS)[number];
export type MappingConfidence = "High" | "Medium" | "Needs Review";
export type ImportAction = "CREATE" | "UPDATE" | "SKIP" | "CONFLICT";
export type IssueSeverity = "warning" | "error";

export type ImportField = {
  key: string;
  label: string;
  required?: boolean;
  aliases: readonly string[];
  description?: string;
  kind?: "text" | "date" | "integer" | "decimal" | "boolean" | "email";
};
export type ColumnMapping = {
  sourceColumn: string;
  targetField: string | null;
  confidence: MappingConfidence;
  samples: string[];
  reason?: string;
};

export type ParsedSheet = {
  name: string;
  matrix: string[][];
  rowCount: number;
  columnCount: number;
  probableHeaderRow: number;
};

export type FileMetadata = {
  name: string;
  size: number;
  sha256: string;
  type: string;
  sheetCount: number;
};

export type ImportInterpretation = {
  provider: string;
  usedFallback: boolean;
  domain: ImportDomain;
  sheetName: string;
  headerRow: number;
  mappings: ColumnMapping[];
  likelyDateFormats: string[];
  identifierColumns: string[];
  nameColumns: string[];
  ignoredColumns: string[];
  notes: string[];
};

export type ImportPayload = {
  file: FileMetadata;
  domain: ImportDomain;
  sheetName: string;
  headerRow: number;
  matrix: string[][];
  mappings: ColumnMapping[];
};

export type ValidationIssue = {
  severity: IssueSeverity;
  field?: string;
  message: string;
};

export type ImportChange = {
  field: string;
  label: string;
  previous: string | number | boolean | null;
  next: string | number | boolean | null;
};

export type PreviewRow = {
  rowNumber: number;
  status: "valid" | "warning" | "blocked";
  action: ImportAction;
  values: Record<string, string | number | boolean | null>;
  issues: ValidationIssue[];
  changes: ImportChange[];
  matchId?: string;
  matchReason?: string;
};

export type PreviewSummary = {
  total: number;
  valid: number;
  warnings: number;
  blocked: number;
  create: number;
  update: number;
  skip: number;
  conflict: number;
};

export type ImportPreview = {
  domain: ImportDomain;
  fields: ImportField[];
  mappingIssues: ValidationIssue[];
  rows: PreviewRow[];
  summary: PreviewSummary;
  approvalToken: string;
  previewDigest: string;
};

export type PersonReference = {
  userId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  badgeNumber: string | null;
  employeeNumber: string | null;
  rankTitle: string | null;
  unitName: string | null;
  active: boolean;
};

export type ExistingReference = Record<string, unknown> & { id: string };

export type ImportReferenceData = {
  people: PersonReference[];
  firearms: ExistingReference[];
  firearmAssignments: ExistingReference[];
  certificationTypes: ExistingReference[];
  certifications: ExistingReference[];
  vehicles: ExistingReference[];
  fleetEquipment: ExistingReference[];
  equipmentTypes: ExistingReference[];
  equipment: ExistingReference[];
};

export type ImportExecutionResult = {
  jobId: string;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  warnings: number;
  failures: Array<{ rowNumber: number; message: string }>;
  rejectedRows: Array<{
    rowNumber: number;
    reason: string;
    values: Record<string, string | number | boolean | null>;
  }>;
};
