import type { ColumnMapping, FileMetadata, ImportDomain, ImportPayload, ImportPreview, ParsedSheet, RemediationScope } from "./types.ts";

export type WorkspaceSource = {
  id: string;
  fileId: string;
  file: FileMetadata;
  sheetName: string;
  matrix: string[][];
  domain: ImportDomain;
  headerRow: number;
  mappings: ColumnMapping[];
  excluded: boolean;
  headerConfidence: "High" | "Medium" | "Needs Review";
  uploadedAt: string;
};

export type SharedMappingRule = {
  domain: ImportDomain;
  sourceHeader: string;
  targetField: string | null;
  approvedAt: string;
};

export type WorkspaceRemediationRule = {
  sourceId: string;
  rowNumber: number;
  sourceColumn: string;
  targetField: string;
  originalValue: string;
  replacementValue: string;
  scope: RemediationScope | "file" | "workspace";
  approvedAt: string;
};

export type MergeStrategy = "skip_exact_duplicates" | "nonblank" | "newest" | "preferred_source" | "existing" | "field_source";

export type WorkspaceMergeRule = {
  domain: ImportDomain;
  strategy: MergeStrategy;
  groupKey?: string;
  preferredSourceId?: string;
  field?: string;
  approvedAt: string;
};

export type MigrationWorkspaceState = {
  version: 1;
  sources: WorkspaceSource[];
  sharedMappings: SharedMappingRule[];
  remediations: WorkspaceRemediationRule[];
  mergeRules: WorkspaceMergeRule[];
};

export type WorkspaceOverlap = {
  groupKey: string;
  domain: ImportDomain;
  classification: "exact_duplicate" | "probable_same" | "conflicting_record";
  sourceIds: string[];
  sourceRows: Array<{ sourceId: string; rowNumber: number }>;
  conflictingFields: string[];
  resolved: boolean;
};

export type WorkspaceDomainPlan = {
  domain: ImportDomain;
  uniqueRecords: number;
  payload: ImportPayload;
  preview: ImportPreview;
  overlaps: WorkspaceOverlap[];
  provenance: Record<number, { sourceId: string; sourceRowNumber: number; filename: string }>;
};

export type MigrationWorkspaceView = {
  id: string;
  status: "draft" | "ready" | "partially_completed" | "completed" | "expired";
  state: MigrationWorkspaceState;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  expiresAt: string;
};

export type WorkspaceInventoryFile = {
  hash: string;
  name: string;
  type: string;
  size: number;
  sheets: Array<Pick<ParsedSheet, "name" | "rowCount" | "columnCount"> & { sourceId: string; domain: ImportDomain; excluded: boolean; headerRow: number; headerConfidence: WorkspaceSource["headerConfidence"] }>;
};

export type WorkspaceDashboard = {
  files: number;
  domains: number;
  sourceRows: number;
  uniqueRecords: number;
  ready: number;
  warnings: number;
  blocked: number;
  duplicates: number;
  conflicts: number;
};

export const EMPTY_WORKSPACE_STATE: MigrationWorkspaceState = { version: 1, sources: [], sharedMappings: [], remediations: [], mergeRules: [] };
