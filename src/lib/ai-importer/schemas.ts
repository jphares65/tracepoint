import { IMPORT_FIELDS } from "./catalog.ts";
import { IMPORT_DOMAINS } from "./types.ts";

const confidence = { type: "string", enum: ["High", "Medium", "Needs Review"] } as const;
const domain = { type: "string", enum: [...IMPORT_DOMAINS] } as const;
const targetField = { type: "string", enum: [...new Set(Object.values(IMPORT_FIELDS).flatMap((fields) => fields.map((field) => field.key)))] } as const;
const stringArray = { type: "array", items: { type: "string" }, maxItems: 50 } as const;

export const IMPORT_INFERENCE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["domain", "sheetName", "headerRow", "mappings", "likelyDateFormats", "identifierColumns", "nameColumns", "ignoredColumns", "notes", "sheetAssessments", "normalizationSuggestions"],
  properties: {
    domain,
    sheetName: { type: "string" },
    headerRow: { type: "integer", minimum: 1, maximum: 25 },
    mappings: {
      type: "array",
      maxItems: 150,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceColumn", "targetField", "confidence", "samples", "reason"],
        properties: {
          sourceColumn: { type: "string" },
          targetField: { anyOf: [targetField, { type: "null" }] },
          confidence,
          samples: { type: "array", items: { type: "string" }, maxItems: 3 },
          reason: { type: "string" },
        },
      },
    },
    likelyDateFormats: stringArray,
    identifierColumns: stringArray,
    nameColumns: stringArray,
    ignoredColumns: stringArray,
    notes: stringArray,
    sheetAssessments: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sheetName", "disposition", "domain", "headerRow", "confidence", "reason"],
        properties: {
          sheetName: { type: "string" },
          disposition: { type: "string", enum: ["useful", "junk", "archive", "instructions"] },
          domain: { anyOf: [domain, { type: "null" }] },
          headerRow: { type: "integer", minimum: 1, maximum: 25 },
          confidence,
          reason: { type: "string" },
        },
      },
    },
    normalizationSuggestions: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceColumn", "targetField", "sourceValue", "suggestedValue", "confidence", "reason"],
        properties: {
          sourceColumn: { type: "string" },
          targetField,
          sourceValue: { type: "string" },
          suggestedValue: { type: "string" },
          confidence,
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

export const WORKSPACE_INFERENCE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["relationships", "sharedMappings", "remediations", "merges"],
  properties: {
    relationships: {
      type: "array", maxItems: 100, items: { type: "object", additionalProperties: false,
        required: ["sourceIds", "relationship", "preferredSourceId", "confidence", "reason"],
        properties: { sourceIds: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 20 }, relationship: { type: "string", enum: ["same_domain", "older_newer", "overlapping", "probable_duplicate", "source_precedence"] }, preferredSourceId: { anyOf: [{ type: "string" }, { type: "null" }] }, confidence, reason: { type: "string" } } },
    },
    sharedMappings: {
      type: "array", maxItems: 100, items: { type: "object", additionalProperties: false,
        required: ["domain", "sourceHeader", "targetField", "confidence", "reason"],
        properties: { domain, sourceHeader: { type: "string" }, targetField: { anyOf: [targetField, { type: "null" }] }, confidence, reason: { type: "string" } } },
    },
    remediations: {
      type: "array", maxItems: 100, items: { type: "object", additionalProperties: false,
        required: ["sourceId", "sourceColumn", "targetField", "sourceValue", "suggestedValue", "scope", "confidence", "reason"],
        properties: { sourceId: { type: "string" }, sourceColumn: { type: "string" }, targetField, sourceValue: { type: "string" }, suggestedValue: { type: "string" }, scope: { type: "string", enum: ["column", "file", "workspace"] }, confidence, reason: { type: "string" } } },
    },
    merges: {
      type: "array", maxItems: 100, items: { type: "object", additionalProperties: false,
        required: ["domain", "sourceIds", "strategy", "preferredSourceId", "field", "confidence", "reason"],
        properties: { domain, sourceIds: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 20 }, strategy: { type: "string", enum: ["skip_exact_duplicates", "nonblank", "newest", "preferred_source", "field_source"] }, preferredSourceId: { anyOf: [{ type: "string" }, { type: "null" }] }, field: { anyOf: [targetField, { type: "null" }] }, confidence, reason: { type: "string" } } },
    },
  },
} as const;
