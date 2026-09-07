import { createHash } from "node:crypto";

import { IMPORT_FIELDS } from "./catalog.ts";
import { cleanText, normalizeEmail, normalizeIdentifier, normalizeLabel } from "./normalize.ts";
import { validateImport, validateMappings } from "./validation.ts";
import { materializeSheet } from "./workbook.ts";
import type { ImportDomain, ImportPayload, ImportReferenceData, PersonReference, PreviewRow, ValueOverride } from "./types.ts";
import type { MigrationWorkspaceState, WorkspaceDashboard, WorkspaceDomainPlan, WorkspaceOverlap, WorkspaceSource } from "./workspace-types.ts";

const DOMAIN_ORDER: ImportDomain[] = ["personnel", "vehicles", "firearms", "equipment", "certifications"];

type StagedRow = {
  source: WorkspaceSource;
  sourceRowNumber: number;
  values: Record<string, string>;
  identityKeys: string[];
};

export const WORKSPACE_DEPENDENCIES: Partial<Record<ImportDomain, ImportDomain[]>> = {
  certifications: ["personnel"], firearms: ["personnel"], equipment: ["personnel"],
};

export function applySharedMappings(source: WorkspaceSource, state: MigrationWorkspaceState) {
  return source.mappings.map((mapping) => {
    const shared = [...state.sharedMappings].reverse().find((rule) => rule.domain === source.domain && normalizeLabel(rule.sourceHeader) === normalizeLabel(mapping.sourceColumn));
    return shared ? { ...mapping, targetField: shared.targetField, confidence: "High" as const, reason: "Workspace-approved shared mapping." } : mapping;
  });
}

function sourcePayload(source: WorkspaceSource, state: MigrationWorkspaceState): ImportPayload {
  const mappings = applySharedMappings(source, state);
  const applicable = state.remediations.filter((rule) => {
    const origin = state.sources.find((item) => item.id === rule.sourceId);
    if (rule.scope === "workspace") return rule.targetField && source.domain === origin?.domain && mappings.some((mapping) => mapping.targetField === rule.targetField);
    if (rule.scope === "file") return source.fileId === origin?.fileId && source.domain === origin.domain && mappings.some((mapping) => mapping.targetField === rule.targetField);
    return rule.sourceId === source.id;
  });
  const overrides: ValueOverride[] = applicable.map((rule) => {
    const sourceMapping = mappings.find((mapping) => mapping.targetField === rule.targetField);
    const sourceColumn = sourceMapping?.sourceColumn ?? rule.sourceColumn;
    let rowNumber = rule.rowNumber;
    if (rule.sourceId !== source.id) {
      rowNumber = materializeSheet(source.matrix, source.headerRow).rows.find((row) => row.source[sourceColumn] === rule.originalValue)?.rowNumber ?? -1;
    }
    return { rowNumber, sourceColumn, targetField: rule.targetField, originalValue: rule.originalValue, replacementValue: rule.replacementValue, scope: rule.scope === "row" ? "row" as const : "column" as const, approvedAt: rule.approvedAt };
  }).filter((override) => override.rowNumber > 0);
  return { file: source.file, domain: source.domain, sheetName: source.sheetName, headerRow: source.headerRow, matrix: source.matrix, mappings, overrides, rowDecisions: [] };
}

function identityKeys(domain: ImportDomain, values: Record<string, string>) {
  if (domain === "personnel") return [values.badgeNumber, values.employeeNumber].map(normalizeIdentifier).filter(Boolean).map((value) => `id:${value}`).concat(values.email ? [`email:${normalizeEmail(values.email)}`] : []);
  if (domain === "firearms") return values.serialNumber ? [`serial:${normalizeIdentifier(values.serialNumber)}`] : values.assetNumber ? [`asset:${normalizeIdentifier(values.assetNumber)}`] : [];
  if (domain === "vehicles") return values.vin ? [`vin:${normalizeIdentifier(values.vin)}`] : values.unitNumber ? [`unit:${normalizeIdentifier(values.unitNumber)}`] : [];
  if (domain === "equipment") return values.serialNumber ? [`serial:${normalizeIdentifier(values.serialNumber)}`] : values.assetNumber ? [`asset:${normalizeIdentifier(values.assetNumber)}`] : [];
  const person = normalizeIdentifier(values.personnelIdentifier) || normalizeEmail(values.personnelIdentifier);
  const type = normalizeLabel(values.certificationTitle);
  const detail = normalizeIdentifier(values.credentialNumber) || values.issueDate || values.expirationDate;
  return person && type && detail ? [`cert:${person}:${type}:${detail}`] : [];
}

function stagedRows(domain: ImportDomain, state: MigrationWorkspaceState): StagedRow[] {
  return state.sources.filter((source) => !source.excluded && source.domain === domain).flatMap((source) => {
    const mapped = validateMappings(sourcePayload(source, state)).mappedRows;
    return mapped.map((row) => ({ source, sourceRowNumber: row.rowNumber, values: row.values, identityKeys: identityKeys(domain, row.values) }));
  });
}

function groupRows(rows: StagedRow[]) {
  const groups: StagedRow[][] = [];
  for (const row of rows) {
    const matching = groups.filter((group) => row.identityKeys.some((key) => group.some((item) => item.identityKeys.includes(key))));
    if (!matching.length) groups.push([row]);
    else {
      const combined = [row, ...matching.flat()];
      for (const group of matching) groups.splice(groups.indexOf(group), 1);
      groups.push(combined);
    }
  }
  return groups;
}

function groupKey(domain: ImportDomain, group: StagedRow[]) {
  const keys = [...new Set(group.flatMap((row) => row.identityKeys))].sort();
  return createHash("sha256").update(`${domain}|${keys.join("|")}`).digest("hex").slice(0, 24);
}

function distinctNonblank(group: StagedRow[], field: string) {
  return [...new Set(group.map((row) => normalizeLabel(row.values[field])).filter(Boolean))];
}

function overlapFor(domain: ImportDomain, group: StagedRow[], state: MigrationWorkspaceState): WorkspaceOverlap | null {
  if (group.length < 2 || new Set(group.map((row) => row.source.id)).size < 2) return null;
  const key = groupKey(domain, group);
  const conflictingFields = IMPORT_FIELDS[domain].map((field) => field.key).filter((field) => distinctNonblank(group, field).length > 1);
  const exact = IMPORT_FIELDS[domain].every((field) => new Set(group.map((row) => normalizeLabel(row.values[field.key]))).size === 1);
  const classification = exact ? "exact_duplicate" : conflictingFields.length ? "conflicting_record" : "probable_same";
  const rules = state.mergeRules.filter((rule) => rule.domain === domain && (!rule.groupKey || rule.groupKey === key));
  const resolved = classification === "exact_duplicate"
    ? rules.some((rule) => rule.strategy === "skip_exact_duplicates")
    : rules.some((rule) => rule.strategy === "newest" || (rule.strategy === "preferred_source" && Boolean(rule.preferredSourceId) && group.some((row) => row.source.id === rule.preferredSourceId))) || (classification === "probable_same" && rules.some((rule) => rule.strategy === "nonblank")) || conflictingFields.every((field) => rules.some((rule) => rule.strategy === "field_source" && rule.field === field && Boolean(rule.preferredSourceId) && group.some((row) => row.source.id === rule.preferredSourceId)));
  return { groupKey: key, domain, classification, sourceIds: [...new Set(group.map((row) => row.source.id))], sourceRows: group.map((row) => ({ sourceId: row.source.id, rowNumber: row.sourceRowNumber })), conflictingFields, resolved };
}

function mergeGroup(domain: ImportDomain, group: StagedRow[], overlap: WorkspaceOverlap | null, state: MigrationWorkspaceState) {
  if (!overlap) return group[0];
  const rules = state.mergeRules.filter((rule) => rule.domain === domain && (!rule.groupKey || rule.groupKey === overlap.groupKey));
  const preferred = [...rules].reverse().find((rule) => rule.strategy === "preferred_source" && rule.preferredSourceId);
  const newest = rules.some((rule) => rule.strategy === "newest");
  let base = preferred ? group.find((row) => row.source.id === preferred.preferredSourceId) ?? group[0] : newest ? [...group].sort((left, right) => right.source.uploadedAt.localeCompare(left.source.uploadedAt))[0] : group[0];
  const values = { ...base.values };
  if (rules.some((rule) => rule.strategy === "nonblank")) {
    for (const field of IMPORT_FIELDS[domain]) values[field.key] = group.map((row) => row.values[field.key]).find(Boolean) ?? values[field.key];
  }
  for (const rule of rules.filter((item) => item.strategy === "field_source" && item.field && item.preferredSourceId)) {
    const selected = group.find((row) => row.source.id === rule.preferredSourceId);
    if (selected && rule.field) values[rule.field] = selected.values[rule.field];
  }
  base = { ...base, values };
  return base;
}

function compositePayload(domain: ImportDomain, selected: StagedRow[], state: MigrationWorkspaceState): ImportPayload {
  const fields = IMPORT_FIELDS[domain];
  const sources = state.sources.filter((source) => !source.excluded && source.domain === domain);
  const sha256 = createHash("sha256").update(JSON.stringify({ domain, sources: sources.map((source) => source.file.sha256), mappings: state.sharedMappings, remediations: state.remediations, merges: state.mergeRules })).digest("hex");
  return {
    file: { name: `Migration workspace · ${domain}`, size: sources.reduce((sum, source) => sum + source.file.size, 0), sha256, type: "application/vnd.tracepoint.migration+json", sheetCount: sources.length },
    domain, sheetName: `Combined ${domain}`, headerRow: 1,
    matrix: [fields.map((field) => field.key), ...selected.map((row) => fields.map((field) => row.values[field.key] ?? ""))],
    mappings: fields.map((field) => ({ sourceColumn: field.key, targetField: field.key, confidence: "High", samples: [], reason: "Workspace canonical staging field." })),
    overrides: [], rowDecisions: [],
  };
}

function plannedPeople(rows: PreviewRow[]): PersonReference[] {
  return rows.filter((row) => row.status !== "blocked" && row.action === "CREATE").map((row) => ({
    userId: `workspace:${row.rowNumber}`, fullName: cleanText(row.values.fullName) || [row.values.firstName, row.values.middleName, row.values.lastName].filter(Boolean).join(" "),
    email: cleanText(row.values.email) || null, phone: cleanText(row.values.phone) || null, badgeNumber: cleanText(row.values.badgeNumber) || null,
    employeeNumber: cleanText(row.values.employeeNumber) || null, rankTitle: cleanText(row.values.rankTitle) || null, unitName: cleanText(row.values.unitName) || null, active: row.values.active !== false,
  }));
}

export function buildWorkspacePlans(state: MigrationWorkspaceState, references: Record<ImportDomain, ImportReferenceData>): WorkspaceDomainPlan[] {
  const plans: WorkspaceDomainPlan[] = [];
  let pendingPeople: PersonReference[] = [];
  for (const domain of DOMAIN_ORDER) {
    const raw = stagedRows(domain, state);
    if (!raw.length) continue;
    const groups = groupRows(raw);
    const overlaps = groups.map((group) => overlapFor(domain, group, state)).filter((overlap): overlap is WorkspaceOverlap => Boolean(overlap));
    const selected = groups.map((group) => mergeGroup(domain, group, overlapFor(domain, group, state), state));
    const payload = compositePayload(domain, selected, state);
    const reference = { ...references[domain], people: [...references[domain].people, ...pendingPeople] };
    const validated = validateImport(payload, reference);
    const effectiveOverlaps = overlaps.map((overlap) => {
      const index = groups.findIndex((group) => groupKey(domain, group) === overlap.groupKey);
      const existingRule = state.mergeRules.some((rule) => rule.domain === domain && rule.strategy === "existing" && (!rule.groupKey || rule.groupKey === overlap.groupKey));
      return existingRule && validated.rows[index]?.action === "UPDATE" ? { ...overlap, resolved: true } : overlap;
    });
    const validatedRows = validated.rows.map((row) => {
      const overlap = effectiveOverlaps.find((item) => item.groupKey === groupKey(domain, groups[row.rowNumber - 2] ?? []));
      const existingRule = overlap && state.mergeRules.some((rule) => rule.domain === domain && rule.strategy === "existing" && (!rule.groupKey || rule.groupKey === overlap.groupKey));
      if (existingRule && overlap.resolved && row.action === "UPDATE") return { ...row, status: "valid" as const, action: "SKIP" as const, issues: [], changes: [], matchReason: "Workspace-approved existing TracePoint value precedence." };
      if (!overlap || overlap.resolved) return row;
      return { ...row, status: "blocked" as const, action: "CONFLICT" as const, issues: [...row.issues, { severity: "error" as const, message: `${overlap.classification === "exact_duplicate" ? "Exact duplicate" : overlap.classification === "probable_same" ? "Probable same record" : "Conflicting record"} across ${overlap.sourceIds.length} files requires an explicit merge decision.`, conflict: { kind: "record" as const } }] };
    });
    const mergedOut = groups.flatMap((group, index) => {
      const overlap = effectiveOverlaps.find((item) => item.groupKey === groupKey(domain, group));
      if (!overlap?.resolved) return [];
      const kept = selected[index];
      return group.filter((row) => row.source.id !== kept.source.id || row.sourceRowNumber !== kept.sourceRowNumber);
    });
    const mergedSkipRows: PreviewRow[] = mergedOut.map((row, index) => ({ rowNumber: selected.length + index + 2, status: "valid", action: "SKIP", values: row.values, issues: [], changes: [], matchReason: "Workspace-approved duplicate or precedence rule." }));
    const previewRows = [...validatedRows, ...mergedSkipRows];
    const summary = {
      ...validated.summary,
      total: previewRows.length,
      valid: previewRows.filter((row) => row.status === "valid").length,
      warnings: previewRows.filter((row) => row.status === "warning").length,
      blocked: previewRows.filter((row) => row.status === "blocked").length,
      create: previewRows.filter((row) => row.action === "CREATE").length,
      update: previewRows.filter((row) => row.action === "UPDATE").length,
      skip: previewRows.filter((row) => row.action === "SKIP").length,
      conflict: previewRows.filter((row) => row.action === "CONFLICT").length,
    };
    const provenance = Object.fromEntries([...selected, ...mergedOut].map((row, index) => [index + 2, { sourceId: row.source.id, sourceRowNumber: row.sourceRowNumber, filename: row.source.file.name }]));
    const preview = { domain, fields: IMPORT_FIELDS[domain], mappingIssues: validated.mappingIssues, rows: previewRows, summary, approvalToken: "", previewDigest: "" };
    plans.push({ domain, uniqueRecords: groups.length, payload, preview, overlaps: effectiveOverlaps, provenance });
    if (domain === "personnel") pendingPeople = plannedPeople(previewRows);
  }
  return plans;
}

export function workspaceDashboard(state: MigrationWorkspaceState, plans: WorkspaceDomainPlan[]): WorkspaceDashboard {
  const files = new Set(state.sources.filter((source) => !source.excluded).map((source) => source.fileId)).size;
  const sourceRows = state.sources.filter((source) => !source.excluded).reduce((sum, source) => sum + Math.max(0, source.matrix.length - source.headerRow), 0);
  return {
    files, domains: plans.length, sourceRows, uniqueRecords: plans.reduce((sum, plan) => sum + plan.uniqueRecords, 0),
    ready: plans.reduce((sum, plan) => sum + plan.preview.summary.valid, 0), warnings: plans.reduce((sum, plan) => sum + plan.preview.summary.warnings, 0),
    blocked: plans.reduce((sum, plan) => sum + plan.preview.summary.blocked, 0), duplicates: plans.reduce((sum, plan) => sum + plan.overlaps.filter((item) => item.classification === "exact_duplicate").length, 0),
    conflicts: plans.reduce((sum, plan) => sum + plan.overlaps.filter((item) => item.classification !== "exact_duplicate" && !item.resolved).length, 0),
  };
}

export function readyDomains(plans: WorkspaceDomainPlan[]) {
  const ready = new Set(plans.filter((plan) => plan.preview.summary.blocked === 0 && !plan.preview.mappingIssues.some((issue) => issue.severity === "error")).map((plan) => plan.domain));
  return DOMAIN_ORDER.filter((domain) => ready.has(domain) && (WORKSPACE_DEPENDENCIES[domain] ?? []).every((dependency) => !plans.some((plan) => plan.domain === dependency) || ready.has(dependency)));
}
