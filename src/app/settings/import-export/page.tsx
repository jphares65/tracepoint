"use client";

import { ChangeEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCcw,
  Search,
  Shield,
  Upload,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";
import { useTracePointAccess } from "@/lib/tracepoint/useTracePointAccess";
import { matchesPersonnelName } from "@/lib/onboarding/personnel-name";

type ImportTypeId =
  | "personnel"
  | "firearms"
  | "off_duty_firearms"
  | "qualification_history"
  | "certifications"
  | "equipment";

type ImportStep = "type" | "upload" | "mapping" | "preview" | "report";

type FieldDefinition = {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
  help?: string;
};

type ImportTypeDefinition = {
  id: ImportTypeId;
  label: string;
  description: string;
  supportStatus: "Preview Only" | "Can Import";
  fields: FieldDefinition[];
  duplicateKeys: string[];
};

type MappingState = Record<string, string>;

type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
};
type OnboardingDatasetType =
  | "personnel"
  | "firearms"
  | "off_duty_firearms"
  | "qualification_history"
  | "certifications"
  | "equipment"
  | "equipment_requirements"
  | "reference"
  | "unknown";

type OnboardingDataset = {
  id: string;
  sourceFile: string;
  sourceSheet: string;
  detectedType: OnboardingDatasetType;
  parsed: ParsedCsv;
};

type ValidationIssue = {
  rowNumber: number;
  severity: "error" | "warning";
  field?: string;
  message: string;
};

type ImportReport = {
  created: number;
  updated: number;
  unchanged: number;
  review: number;
  skipped: number;
  failed: number;
  message: string;
  failures: string[];
  reviews: string[];
};

type PilotPersonnel = {
  id: string;
  userId: string;
  displayName: string;
  fullName: string;
  email?: string | null;
  badgeNumber?: string | null;
  rankTitle?: string | null;
};

const IMPORT_TYPES: ImportTypeDefinition[] = [
  {
    id: "personnel",
    label: "Personnel",
    description:
      "Import personnel and stage accounts pending activation.",
    supportStatus: "Can Import",
    duplicateKeys: ["badgeNumber", "email"],
    fields: [
      {
        key: "firstName",
        label: "First Name",
        required: true,
        aliases: ["first name", "firstname", "first", "given name"],
      },
      {
        key: "lastName",
        label: "Last Name",
        required: true,
        aliases: ["last name", "lastname", "last", "surname"],
      },
      {
        key: "rankTitle",
        label: "Rank",
        aliases: ["rank", "rank title", "title"],
      },
      {
        key: "badgeNumber",
        label: "Badge Number",
        required: true,
        aliases: ["badge", "badge number", "id number", "employee number"],
      },
      {
        key: "email",
        label: "Email",
        aliases: ["email", "email address", "work email"],
      },
      {
        key: "unitName",
        label: "Unit / Assignment",
        aliases: ["unit", "assignment", "division", "bureau"],
      },
      {
        key: "active",
        label: "Active",
        aliases: ["active", "status", "is active"],
      },
    ],
  },
  {
    id: "firearms",
    label: "Firearms",
    description:
      "Import firearm inventory directly into the Armory.",
    supportStatus: "Can Import",
    duplicateKeys: ["serialNumber"],
    fields: [
      {
        key: "make",
        label: "Make",
        required: true,
        aliases: ["make", "manufacturer", "brand"],
      },
      {
        key: "model",
        label: "Model",
        required: true,
        aliases: ["model"],
      },
      {
        key: "serialNumber",
        label: "Serial Number",
        required: true,
        aliases: ["serial", "serial number", "serial_number", "s/n"],
      },
      {
        key: "firearmType",
        label: "Firearm Type",
        required: true,
        aliases: ["type", "firearm type", "weapon type", "category"],
      },
      {
        key: "caliber",
        label: "Caliber / Gauge",
        required: true,
        aliases: [
          "caliber",
          "calibre",
          "cal",
          "gauge",
          "caliber gauge",
          "caliber/gauge",
          "cal gauge",
          "cal/gauge",
          "weapon caliber",
          "weapon calibre",
        ],
        help:
          "Optional during onboarding. Missing values are imported as TBD / Unknown and can be updated later.",
      },
      {
        key: "assetNumber",
        label: "Asset Number",
        aliases: ["asset", "asset number", "property number", "inventory number"],
      },
      {
        key: "conditionStatus",
        label: "Condition Status",
        aliases: ["status", "condition", "condition status"],
      },
      {
        key: "assignedOfficerName",
        label: "Assigned Officer Name",
        aliases: [
          "assigned officer",
          "assigned officer name",
          "assigned to",
          "assigned to name",
          "officer",
          "officer name",
          "employee",
        ],
        help:
          "Optional. Matches an active officer by name, email, or badge number.",
      },
      {
        key: "notes",
        label: "Notes",
        aliases: ["notes", "comments", "remarks"],
      },
    ],
  },
  {
    id: "qualification_history",
    label: "Qualification History",
    description:
      "Preview and validate historical qualification records before import.",
    supportStatus: "Can Import",
    duplicateKeys: ["officerName", "qualificationDate", "courseName"],
    fields: [
      {
        key: "officerName",
        label: "Officer Name",
        required: true,
        aliases: ["officer", "officer name", "name", "employee"],
      },
      {
        key: "badgeNumber",
        label: "Badge Number",
        aliases: ["badge", "badge number", "employee number"],
      },
      {
        key: "qualificationDate",
        label: "Qualification Date",
        required: true,
        aliases: ["date", "qualification date", "qual date"],
      },
      {
        key: "courseName",
        label: "Course / Standard",
        required: true,
        aliases: ["course", "course name", "standard", "qualification"],
      },
      {
        key: "score",
        label: "Score",
        required: true,
        aliases: ["score", "points", "qualification score"],
      },
      {
        key: "passingScore",
        label: "Passing Score",
        aliases: ["passing score", "minimum score", "minimum passing"],
      },
      {
        key: "result",
        label: "Result",
        aliases: ["result", "pass fail", "pass/fail", "status"],
      },
      {
        key: "instructor",
        label: "Instructor",
        aliases: ["instructor", "range officer", "rangemaster"],
      },
      {
        key: "notes",
        label: "Notes",
        aliases: ["notes", "comments", "remarks"],
      },
    ],
  },
  {
    id: "certifications",
    label: "Certifications",
    description:
      "Import existing officer certifications and credential history.",
    supportStatus: "Can Import",
    duplicateKeys: ["officerName", "certificationTitle", "expirationDate"],
    fields: [
      {
        key: "officerName",
        label: "Officer Name",
        required: true,
        aliases: ["officer", "officer name", "employee", "name"],
      },
      {
        key: "badgeNumber",
        label: "Badge Number",
        aliases: ["badge", "badge number", "employee number"],
      },
      {
        key: "certificationTitle",
        label: "Certification Title",
        required: true,
        aliases: ["certification", "certification title", "credential", "type"],
      },
      {
        key: "issuingOrganization",
        label: "Issuing Organization",
        aliases: ["issuing organization", "issuer", "agency", "organization"],
      },
      {
        key: "credentialNumber",
        label: "Credential Number",
        aliases: ["credential number", "certificate number", "cert number"],
      },
      {
        key: "issueDate",
        label: "Issue Date",
        aliases: ["issue date", "issued", "date issued"],
      },
      {
        key: "expirationDate",
        label: "Expiration Date",
        aliases: ["expiration date", "expires", "expiry date"],
      },
      {
        key: "notes",
        label: "Notes",
        aliases: ["notes", "comments", "remarks"],
      },
    ],
  },
  {
    id: "equipment",
    label: "Equipment",
    description:
      "Import issued equipment and readiness assets.",
    supportStatus: "Can Import",
    duplicateKeys: ["serialNumber"],
    fields: [
      {
        key: "equipmentType",
        label: "Equipment Type",
        required: true,
        aliases: ["equipment type", "asset type", "type", "category"],
      },
      {
        key: "manufacturer",
        label: "Manufacturer",
        aliases: ["manufacturer", "make", "brand"],
      },
      {
        key: "model",
        label: "Model",
        aliases: ["model"],
      },
      {
        key: "serialNumber",
        label: "Serial Number",
        aliases: ["serial", "serial number", "s/n"],
      },
      {
        key: "lotNumber",
        label: "Lot Number",
        aliases: ["lot", "lot number", "batch number"],
      },
      {
        key: "assignedOfficerName",
        label: "Assigned Officer Name",
        aliases: ["assigned officer", "assigned to", "officer", "employee"],
      },
      {
        key: "issueDate",
        label: "Issue Date",
        aliases: ["issue date", "issued date"],
      },
      {
        key: "expirationDate",
        label: "Expiration Date",
        aliases: ["expiration date", "expires", "expiry date"],
      },
      {
        key: "lastInspectionDate",
        label: "Last Inspection Date",
        aliases: ["last inspection", "last inspection date"],
      },
      {
        key: "nextInspectionDate",
        label: "Next Inspection Date",
        aliases: ["next inspection", "next inspection date"],
      },
      {
        key: "lifecycleStatus",
        label: "Lifecycle Status",
        aliases: ["lifecycle status", "status"],
      },
      {
        key: "notes",
        label: "Notes",
        aliases: ["notes", "comments", "remarks"],
      },
    ],
  },
  {
    id: "off_duty_firearms",
    label: "Off-Duty Firearms",
    description:
      "Import existing personally owned off-duty firearm records without triggering the approval workflow.",
    supportStatus: "Can Import",
    duplicateKeys: ["serialNumber"],
    fields: [
      {
        key: "officerName",
        label: "Officer Name",
        required: true,
        aliases: ["officer", "officer name", "employee", "name"],
      },
      {
        key: "badgeNumber",
        label: "Badge Number",
        aliases: ["badge", "badge number", "employee number"],
      },
      {
        key: "make",
        label: "Make",
        required: true,
        aliases: ["make", "manufacturer", "brand"],
      },
      {
        key: "model",
        label: "Model",
        required: true,
        aliases: ["model"],
      },
      {
        key: "serialNumber",
        label: "Serial Number",
        required: true,
        aliases: ["serial", "serial number", "s/n"],
      },
      {
        key: "firearmType",
        label: "Firearm Type",
        required: true,
        aliases: ["firearm type", "weapon type", "type"],
      },
      {
        key: "caliber",
        label: "Caliber",
        required: true,
        aliases: ["caliber", "calibre", "cal"],
      },
      {
        key: "capacity",
        label: "Capacity",
        aliases: ["capacity", "magazine capacity"],
      },
      {
        key: "optic",
        label: "Optic",
        aliases: ["optic", "sight"],
      },
      {
        key: "weaponLight",
        label: "Weapon Light",
        aliases: ["weapon light", "light"],
      },
      {
        key: "holster",
        label: "Holster",
        aliases: ["holster"],
      },
      {
        key: "requestStatus",
        label: "Request Status",
        aliases: ["request status", "status"],
      },
      {
        key: "authorizationStatus",
        label: "Authorization Status",
        aliases: ["authorization status", "authorization"],
      },
      {
        key: "complianceStatus",
        label: "Compliance Status",
        aliases: ["compliance status", "compliance"],
      },
      {
        key: "inspectionStatus",
        label: "Inspection Status",
        aliases: ["inspection status"],
      },
      {
        key: "approvalDate",
        label: "Approval Date",
        aliases: ["approval date", "approved date"],
      },
      {
        key: "approvalEffectiveDate",
        label: "Approval Effective Date",
        aliases: ["approval effective date", "effective date"],
      },
      {
        key: "approvalExpirationDate",
        label: "Approval Expiration Date",
        aliases: ["approval expiration date", "expiration date", "expires"],
      },
      {
        key: "notes",
        label: "Notes",
        aliases: ["notes", "comments", "remarks"],
      },
    ],
  },];

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false

  return values;
}

function parseCsv(text: string): ParsedCsv {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const parseLine = (line: string) => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      const nextCharacter = line[index + 1];

      if (character === '"' && inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = !inQuotes;
      } else if (character === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += character;
      }
    }

    values.push(current.trim());

    return values;
  };

  const headers = parseLine(lines[0]).map((header) => header.trim());

  const rows = lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() ?? "";
    });

    return row;
  });

  return { headers, rows };
}

function detectOnboardingDatasetType(
  name: string,
  headers: string[],
): OnboardingDatasetType {
  const normalizedName = normalizeHeader(name);
  const normalizedHeaders = headers.map(normalizeHeader);

  const hasAnyHeader = (...values: string[]) =>
    values.some((value) =>
      normalizedHeaders.includes(normalizeHeader(value)),
    );
  if (
    normalizedName.includes("import notes") ||
    normalizedName.includes("source snapshot") ||
    normalizedName.includes("instructions") ||
    normalizedName.includes("read me") ||
    normalizedName.includes("readme")
  ) {
    return "reference";
  }

  if (
    normalizedName.includes("off duty") ||
    normalizedName.includes("off-duty") ||
    normalizedName.includes("off duty firearm") ||
    normalizedName.includes("off-duty firearm")
  ) {
    return "off_duty_firearms";
  }


  if (
    normalizedName.includes("personnel") ||
    normalizedName.includes("officer") ||
    normalizedName.includes("employee")
  ) {
    return "personnel";
  }

  if (
    normalizedName.includes("qualification") ||
    normalizedName.includes("qual history") ||
    normalizedName.includes("range qualification")
  ) {
    return "qualification_history";
  }

  if (
    normalizedName.includes("certification") ||
    normalizedName.includes("credential")
  ) {
    return "certifications";
  }

  if (
    normalizedName.includes("equipment requirement") ||
    normalizedName.includes("equipment standard") ||
    normalizedName.includes("readiness requirement")
  ) {
    return "equipment_requirements";
  }

  if (
    normalizedName.includes("equipment") ||
    normalizedName.includes("asset")
  ) {
    return "equipment";
  }

  if (
    normalizedName.includes("firearm") ||
    normalizedName.includes("weapon") ||
    normalizedName.includes("armory")
  ) {
    return "firearms";
  }

  if (
    hasAnyHeader("first name", "last name") &&
    hasAnyHeader("badge", "badge number", "employee number")
  ) {
    return "personnel";
  }

  if (
    hasAnyHeader("qualification date", "qual date") &&
    hasAnyHeader("score", "qualification score")
  ) {
    return "qualification_history";
  }

  if (
    hasAnyHeader("certification title", "certification", "credential number") &&
    hasAnyHeader("expiration date", "issue date")
  ) {
    return "certifications";
  }

  if (
    hasAnyHeader("serial number", "manufacturer", "model") &&
    hasAnyHeader("equipment type", "asset type")
  ) {
    return "equipment";
  }

  if (
    hasAnyHeader("equipment type") &&
    hasAnyHeader("required quantity", "required by department")
  ) {
    return "equipment_requirements";
  }

  if (
    hasAnyHeader("serial number") &&
    hasAnyHeader("caliber", "caliber gauge", "firearm type")
  ) {
    return "firearms";
  }

  return "unknown";
}

function worksheetMatrixToParsedCsv(matrix: unknown[][]): ParsedCsv {
  if (matrix.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = (matrix[0] ?? []).map((value) =>
    String(value ?? "").trim(),
  );

  const rows = matrix
    .slice(1)
    .filter((values) =>
      values.some((value) => String(value ?? "").trim().length > 0),
    )
    .map((values) => {
      const row: Record<string, string> = {};

      headers.forEach((header, index) => {
        if (!header) return;
        row[header] = String(values[index] ?? "").trim();
      });

      return row;
    });

  return {
    headers: headers.filter(Boolean),
    rows,
  };
}

async function parseOnboardingFile(
  file: File,
): Promise<OnboardingDataset[]> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".csv")) {
    const parsed = parseCsv(await file.text());

    return [
      {
        id: `${file.name}-csv`,
        sourceFile: file.name,
        sourceSheet: file.name,
        detectedType: detectOnboardingDatasetType(
          file.name,
          parsed.headers,
        ),
        parsed,
      },
    ];
  }

  if (
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls")
  ) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), {
      type: "array",
    });

    return workbook.SheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];

      const matrix = XLSX.utils.sheet_to_json<unknown[]>(
        worksheet,
        {
          header: 1,
          raw: false,
          defval: "",
        },
      );

      const parsed = worksheetMatrixToParsedCsv(matrix);

      return {
        id: `${file.name}-${sheetName}`,
        sourceFile: file.name,
        sourceSheet: sheetName,
        detectedType: detectOnboardingDatasetType(
          sheetName,
          parsed.headers,
        ),
        parsed,
      };
    }).filter(
      (dataset) =>
        dataset.detectedType !== "reference" &&
        dataset.parsed.headers.length > 0 &&
        dataset.parsed.rows.length > 0,
    );
  }

  throw new Error(
    "Unsupported file type. Upload a CSV, XLSX, or XLS file.",
  );
}
function buildAutoMapping(headers: string[], definition: ImportTypeDefinition): MappingState {
  const mapping: MappingState = {};
  const normalizedHeaders = headers.map((header) => ({
    raw: header,
    normalized: normalizeHeader(header),
  }));

  definition.fields.forEach((field) => {
    const aliases = field.aliases.map(normalizeHeader);
    const exactMatch = normalizedHeaders.find((header) =>
      aliases.includes(header.normalized),
    );

    mapping[field.key] = exactMatch?.raw ?? "";
  });

  return mapping;
}

function getMappedValue(row: Record<string, string>, mapping: MappingState, fieldKey: string) {
  const sourceHeader = mapping[fieldKey];

  if (!sourceHeader) return "";

  return row[sourceHeader]?.trim() ?? "";
}

function buildMappedRows(
  rows: Record<string, string>[],
  mapping: MappingState,
  definition: ImportTypeDefinition,
) {
  return rows.map((row) => {
    const mappedRow: Record<string, string> = {};

    definition.fields.forEach((field) => {
      mappedRow[field.key] = getMappedValue(row, mapping, field.key);
    });

    return mappedRow;
  });
}

function validateRows(
  rows: Record<string, string>[],
  mapping: MappingState,
  definition: ImportTypeDefinition,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const firearmNeedsAttentionFields = new Set([
    "make",
    "model",
    "firearmType",
    "caliber",
  ]);
  const requiredFields = definition.fields.filter((field) => field.required);
  const mappedRows = buildMappedRows(rows, mapping, definition);

  definition.fields.forEach((field) => {
    if (field.required && !mapping[field.key]) {
      const needsAttention =
        definition.id === "firearms" &&
        firearmNeedsAttentionFields.has(field.key);

      issues.push({
        rowNumber: 0,
        severity: needsAttention ? "warning" : "error",
        field: field.key,
        message: needsAttention
          ? `${field.label} is not mapped. Records can still be imported and will need attention.`
          : `${field.label} is required but not mapped.`,
      });
    }
  });

  mappedRows.forEach((row, rowIndex) => {
    requiredFields.forEach((field) => {
      if (!row[field.key]) {
        const needsAttention =
          definition.id === "firearms" &&
          firearmNeedsAttentionFields.has(field.key);

        issues.push({
          rowNumber: rowIndex + 2,
          severity: needsAttention ? "warning" : "error",
          field: field.key,
          message: needsAttention
            ? `${field.label} is missing. Record can still be imported and will need attention.`
            : `${field.label} is required.`,
        });
      }
    });

    if (definition.id === "firearms") {
      const type = row.firearmType?.toLowerCase();

      if (
        type &&
        !["handgun", "rifle", "shotgun", "less lethal", "less_lethal", "other"].includes(type)
      ) {
        issues.push({
          rowNumber: rowIndex + 2,
          severity: "warning",
          field: "firearmType",
          message:
            "Firearm Type should normally be handgun, rifle, shotgun, less lethal, or other.",
        });
      }
    }

    if (definition.id === "qualification_history") {
      const score = Number(row.score);

      if (row.score && Number.isNaN(score)) {
        issues.push({
          rowNumber: rowIndex + 2,
          severity: "warning",
          field: "score",
          message: "Score is not numeric.",
        });
      }
    }
  });

  definition.duplicateKeys.forEach((fieldKey) => {
    const seen = new Map<string, number>();

    mappedRows.forEach((row, rowIndex) => {
      const value = row[fieldKey]?.trim().toLowerCase();

      if (!value) return;

      if (seen.has(value)) {
        issues.push({
          rowNumber: rowIndex + 2,
          severity: "warning",
          field: fieldKey,
          message: `Possible duplicate ${fieldKey}. First seen on row ${seen.get(value)}.`,
        });
      } else {
        seen.set(value, rowIndex + 2);
      }
    });
  });

  return issues;
}

function normalizeFirearmType(value: string) {
  const normalized = value.trim().toLowerCase();

  if (normalized === "less lethal") return "less_lethal";
  if (["handgun", "rifle", "shotgun", "less_lethal", "other"].includes(normalized)) {
    return normalized;
  }

  return "other";
}

function normalizeStatus(value: string) {
  const normalized = value.trim().toLowerCase();

  if (normalized.includes("out")) return "Out of Service";
  if (normalized.includes("maintenance")) return "Maintenance";
  if (normalized.includes("inspection")) return "Inspection Required";
  if (normalized.includes("retired")) return "Retired";

  return "In Service";
}

const PERSONNEL_RANK_PREFIXES = [
  "chief",
  "deputy chief",
  "captain",
  "capt",
  "lt",
  "lieutenant",
  "sgt",
  "sergeant",
  "cpl",
  "corporal",
  "det",
  "detective",
  "officer",
  "patrolman",
  "patrol officer",
  "po",
  "spo",
  "special police officer",
];

function normalizePersonLookup(value: string) {
  let normalized = value
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ");

  for (const prefix of PERSONNEL_RANK_PREFIXES.sort(
    (left, right) => right.length - left.length,
  )) {
    if (normalized === prefix) return "";

    if (normalized.startsWith(`${prefix} `)) {
      normalized = normalized.slice(prefix.length).trim();
      break;
    }
  }

  return normalized;
}

function getLastName(value: string) {
  const normalized = normalizePersonLookup(value);
  const parts = normalized.split(" ").filter(Boolean);

  return parts.at(-1) ?? "";
}

function getPersonnelMatch(
  value: string,
  personnel: PilotPersonnel[],
): PilotPersonnel | null {
  const normalized = normalizePersonLookup(value);

  if (!normalized) return null;

  const exactIdentifierMatches = personnel.filter((person) => {
    const identifiers = [
      person.email ?? "",
      person.badgeNumber ?? "",
      person.badgeNumber ? `badge ${person.badgeNumber}` : "",
    ]
      .filter(Boolean)
      .map(normalizePersonLookup);

    return identifiers.includes(normalized);
  });

  if (exactIdentifierMatches.length === 1) {
    return exactIdentifierMatches[0];
  }

  if (exactIdentifierMatches.length > 1) {
    return null;
  }

  const nameMatches = personnel.filter(
    (person) =>
      matchesPersonnelName(person.fullName, value) ||
      matchesPersonnelName(person.displayName, value),
  );

  if (nameMatches.length === 1) {
    return nameMatches[0];
  }

  return null;
}

async function importPersonnel(
  row: Record<string, string>,
  departmentId: string,
) {
  const response = await fetch("/api/settings/onboarding/personnel", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      departmentId,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      badgeNumber: row.badgeNumber,
      rankTitle: row.rankTitle,
      unitName: row.unitName,
      active: row.active,
    }),
  });

  const payload = (await response.json()) as {
    error?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || "Personnel import failed.");
  }

  return payload;
}

async function importFirearm(
  row: Record<string, string>,
  departmentId: string,
  assignedToUserId?: string,
) {
  const response = await fetch("/api/settings/onboarding/firearms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      departmentId,
      make: row.make?.trim() || "TBD / Unknown",
      model: row.model?.trim() || "TBD / Unknown",
      serialNumber: row.serialNumber,
      firearmType: row.firearmType?.trim()
        ? normalizeFirearmType(row.firearmType)
        : undefined,
      caliber: row.caliber?.trim() || "TBD / Unknown",
      assetNumber: row.assetNumber,
      conditionStatus: normalizeStatus(row.conditionStatus || "In Service"),
      notes: row.notes,
      assignedToUserId: assignedToUserId || undefined,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    status?: "created" | "updated" | "unchanged";
    changedFields?: string[];
    conflicts?: Array<{
      field: string;
      existingValue: unknown;
      incomingValue: unknown;
    }>;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? "Import failed.");
  }

  return payload;
}


type CsvValue = string | number | boolean | null | undefined;

function csvEscape(value: CsvValue) {
  const stringValue = value === null || value === undefined ? "" : String(value);

  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n")
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function downloadCsv(fileName: string, rows: Record<string, CsvValue>[]) {
  const headers =
    rows.length > 0
      ? Object.keys(rows[0])
      : ["No records available for this export."];

  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadTemplate(fileName: string, headers: string[]) {
  const csv = `${headers.join(",")}\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    let message = "Export request failed.";

    try {
      const payload = (await response.json()) as { error?: string };
      message = payload.error ?? message;
    } catch {
      // no-op
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

const exportDate = () => new Date().toISOString().slice(0, 10);


function ImportWizardContent() {
  const searchParams = useSearchParams();

  const platformDepartmentId =
    searchParams.get("platformDepartmentId")?.trim() ?? "";

  const { departmentId: activeDepartmentId } = useTracePointAccess({
    enabled: !platformDepartmentId,
  });

  const departmentId =
    platformDepartmentId || activeDepartmentId;
  const [onboardingDatasets, setOnboardingDatasets] =
    useState<OnboardingDataset[]>([]);
  const [onboardingFileName, setOnboardingFileName] =
    useState("");
  const [onboardingLoading, setOnboardingLoading] =
    useState(false);
  const [onboardingError, setOnboardingError] =
    useState<string | null>(null);
  const [selectedTypeId, setSelectedTypeId] = useState<ImportTypeId>("personnel");
  const [step, setStep] = useState<ImportStep>("type");
  const [fileName, setFileName] = useState("");
  const [parsedCsv, setParsedCsv] = useState<ParsedCsv>({ headers: [], rows: [] });
  const [mapping, setMapping] = useState<MappingState>({});
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const [reportType, setReportType] =
    useState("off-duty-firearms");

  const [reportOfficerId, setReportOfficerId] = useState("all");
  const [reportDateMode, setReportDateMode] = useState<
    "all" | "custom"
  >("all");
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [reportStatus, setReportStatus] = useState("all");
  const [reportIncludeWorkflow, setReportIncludeWorkflow] =
    useState(true);
  const [reportIncludeInspections, setReportIncludeInspections] =
    useState(true);
  const [reportIncludeNotes, setReportIncludeNotes] =
    useState(true);
  const [reportGenerating, setReportGenerating] =
    useState(false);
  const [reportOfficerOptions, setReportOfficerOptions] =
    useState<
      Array<{
        id: string;
        name: string;
        badge: string;
      }>
    >([]);

  const [exportError, setExportError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [personnel, setPersonnel] = useState<PilotPersonnel[]>([]);
  const [personnelError, setPersonnelError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadPersonnel() {
      try {
        const payload = await fetchJson<{
          personnel?: PilotPersonnel[];
        }>(`/api/settings/onboarding/personnel-directory?departmentId=${encodeURIComponent(departmentId)}`);

        if (!isMounted) return;

        setPersonnel(payload.personnel ?? []);
        setPersonnelError(null);
      } catch (error) {
        if (!isMounted) return;

        setPersonnel([]);
        setPersonnelError(
          error instanceof Error
            ? error.message
            : "Personnel directory could not be loaded.",
        );
      }
    }

    void loadPersonnel();

    return () => {
      isMounted = false;
    };
  }, [departmentId]);

  const selectedDefinition = useMemo(
    () => IMPORT_TYPES.find((type) => type.id === selectedTypeId) ?? IMPORT_TYPES[0],
    [selectedTypeId],
  );

  const mappedRows = useMemo(
    () => buildMappedRows(parsedCsv.rows, mapping, selectedDefinition),
    [parsedCsv.rows, mapping, selectedDefinition],
  );

  const validationIssues = useMemo(() => {
    const issues = validateRows(
      parsedCsv.rows,
      mapping,
      selectedDefinition,
    );

    if (selectedDefinition.id === "firearms") {
      mappedRows.forEach((row, rowIndex) => {
        const assignedOfficerName =
          row.assignedOfficerName?.trim() ?? "";

        if (
          assignedOfficerName &&
          !getPersonnelMatch(assignedOfficerName, personnel)
        ) {
          issues.push({
            rowNumber: rowIndex + 2,
            severity: "error",
            field: "assignedOfficerName",
            message:
              `Assigned officer "${assignedOfficerName}" did not uniquely match an active personnel record.`,
          });
        }
      });
    }

    return issues;
  }, [
    mappedRows,
    parsedCsv.rows,
    mapping,
    selectedDefinition,
    personnel,
  ]);

  const blockingErrors = validationIssues.filter((issue) => issue.severity === "error");

  const filteredPreviewRows = useMemo(() => {
    if (!search.trim()) return mappedRows.slice(0, 25);

    const normalized = search.toLowerCase();

    return mappedRows
      .filter((row) =>
        Object.values(row).some((value) => value.toLowerCase().includes(normalized)),
      )
      .slice(0, 25);
  }, [mappedRows, search]);

  async function handleOnboardingFile(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file) return;

    setOnboardingLoading(true);
    setOnboardingError(null);

    try {
      const datasets = await parseOnboardingFile(file);

      if (datasets.length === 0) {
        throw new Error(
          "No usable data sheets or records were found in this file.",
        );
      }

      setOnboardingFileName(file.name);
      setOnboardingDatasets(datasets);
    } catch (error) {
      setOnboardingFileName("");
      setOnboardingDatasets([]);
      setOnboardingError(
        error instanceof Error
          ? error.message
          : "Unable to read onboarding file.",
      );
    } finally {
      setOnboardingLoading(false);
      event.target.value = "";
    }
  }
  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    const text = await file.text();
    const parsed = parseCsv(text);
    const nextMapping = buildAutoMapping(parsed.headers, selectedDefinition);

    setFileName(file.name);
    setParsedCsv(parsed);
    setMapping(nextMapping);
    setReport(null);
    setStep("mapping");
  }

  function resetWizard() {
    setStep("type");
    setFileName("");
    setParsedCsv({ headers: [], rows: [] });
    setMapping({});
    setSearch("");
    setReport(null);
    setImporting(false);
  }

  async function handleImport() {
    if (
      selectedDefinition.id !== "personnel" &&
      selectedDefinition.id !== "firearms" &&
      selectedDefinition.id !== "qualification_history" &&
      selectedDefinition.id !== "certifications" &&
      selectedDefinition.id !== "equipment" &&
      selectedDefinition.id !== "off_duty_firearms"
    ) {
      setReport({
        created: 0,
        updated: 0,
        unchanged: 0,
        review: 0,
        skipped: mappedRows.length,
        failed: 0,
        message:
          "This import type currently supports validation and preview only.",
        failures: [],
        reviews: [],
      });
      setStep("report");
      return;
    }

    if (!departmentId) {
      setReport({
        created: 0,
        updated: 0,
        unchanged: 0,
        review: 0,
        skipped: 0,
        failed: mappedRows.length,
        message: "No active department is available for import.",
        failures: ["An active department is required before importing."],
        reviews: [],
      });
      setStep("report");
      return;
    }

    setImporting(true);

    const failures: string[] = [];
    const reviews: string[] = [];
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let review = 0;

    const recordImportResult = (
      payload: {
        status?: "created" | "updated" | "unchanged";
        conflicts?: Array<{
          field?: string;
          existingValue?: unknown;
          incomingValue?: unknown;
        }>;
      },
      rowNumber: number,
    ) => {
      if ((payload.conflicts?.length ?? 0) > 0) {
        review += 1;

        const fields = payload.conflicts
          ?.map((conflict) => conflict.field)
          .filter(Boolean)
          .join(", ");

        reviews.push(
          `Row ${rowNumber}: Existing TracePoint data was preserved. Conflicting field${(payload.conflicts?.length ?? 0) === 1 ? "" : "s"}: ${fields || "unknown"}.`,
        );
      } else if (payload.status === "updated") {
        updated += 1;
      } else if (payload.status === "unchanged") {
        unchanged += 1;
      } else {
        created += 1;
      }
    };

    for (const [index, row] of mappedRows.entries()) {
      try {
        if (selectedDefinition.id === "personnel") {
          await importPersonnel(row, departmentId);
          created += 1;
          continue;
        }

        if (selectedDefinition.id === "certifications") {
          const officerName = row.officerName?.trim() ?? "";
          const matchedOfficer = officerName
            ? getPersonnelMatch(officerName, personnel)
            : null;

          if (!matchedOfficer) {
            throw new Error(
              `Officer "${officerName}" did not uniquely match an active personnel record.`,
            );
          }

          const response = await fetch(
            "/api/settings/onboarding/certifications",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                departmentId,
                userId: matchedOfficer.userId,
                certificationTitle: row.certificationTitle,
                issuingOrganization: row.issuingOrganization,
                credentialNumber: row.credentialNumber,
                issueDate: row.issueDate,
                expirationDate: row.expirationDate,
                notes: row.notes,
              }),
            },
          );

          const payload = await response.json();

          if (!response.ok) {
            throw new Error(
              payload?.error ?? "Certification could not be imported.",
            );
          }

          recordImportResult(payload, index + 2);
          continue;
        }
        if (selectedDefinition.id === "equipment") {
          const assignedOfficerName =
            row.assignedOfficerName?.trim() ?? "";

          const matchedOfficer = assignedOfficerName
            ? getPersonnelMatch(assignedOfficerName, personnel)
            : null;

          if (assignedOfficerName && !matchedOfficer) {
            throw new Error(
              `Assigned officer "${assignedOfficerName}" did not uniquely match an active personnel record.`,
            );
          }

          const response = await fetch(
            "/api/settings/onboarding/equipment",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                departmentId,
                equipmentType: row.equipmentType,
                manufacturer: row.manufacturer,
                model: row.model?.trim() || "TBD / Unknown",
                serialNumber: row.serialNumber,
                lotNumber: row.lotNumber,
                assignedToUserId: matchedOfficer?.userId,
                issueDate: row.issueDate,
                expirationDate: row.expirationDate,
                lastInspectionDate: row.lastInspectionDate,
                nextInspectionDate: row.nextInspectionDate,
                lifecycleStatus: row.lifecycleStatus,
                notes: row.notes,
              }),
            },
          );

          const payload = await response.json();

          if (!response.ok) {
            throw new Error(
              payload?.error ?? "Equipment could not be imported.",
            );
          }

          recordImportResult(payload, index + 2);
          continue;
        }
        if (selectedDefinition.id === "off_duty_firearms") {
          const officerName = row.officerName?.trim() ?? "";
          const matchedOfficer = officerName
            ? getPersonnelMatch(officerName, personnel)
            : null;

          if (!matchedOfficer) {
            throw new Error(
              `Officer "${officerName}" did not uniquely match an active personnel record.`,
            );
          }

          const response = await fetch(
            "/api/settings/onboarding/off-duty-firearms",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                departmentId,
                officerUserId: matchedOfficer.userId,
                make: row.make?.trim() || "TBD / Unknown",
                model: row.model?.trim() || "TBD / Unknown",
                firearmType: row.firearmType,
                serialNumber: row.serialNumber,
                caliber: row.caliber?.trim() || "TBD / Unknown",
                capacity: row.capacity,
                optic: row.optic,
                weaponLight: row.weaponLight,
                holster: row.holster,
                requestStatus: row.requestStatus,
                authorizationStatus: row.authorizationStatus,
                complianceStatus: row.complianceStatus,
                inspectionStatus: row.inspectionStatus,
                approvalDate: row.approvalDate,
                approvalEffectiveDate: row.approvalEffectiveDate,
                approvalExpirationDate: row.approvalExpirationDate,
                notes: row.notes,
              }),
            },
          );

          const payload = await response.json();

          if (!response.ok) {
            throw new Error(
              payload?.error ?? "Off-duty firearm could not be imported.",
            );
          }

          recordImportResult(payload, index + 2);
          continue;
        }
        if (selectedDefinition.id === "qualification_history") {
          const response = await fetch(
            "/api/settings/onboarding/qualification-history",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                departmentId,
                officerName: row.officerName,
                badgeNumber: row.badgeNumber,
                qualificationDate: row.qualificationDate,
                courseName: row.courseName,
                score: row.score,
                passingScore: row.passingScore,
                result: row.result,
                instructor: row.instructor,
                notes: row.notes,
              }),
            },
          );

          const payload = await response.json();

          if (!response.ok) {
            throw new Error(
              payload?.error ??
                "Historical qualification could not be imported.",
            );
          }

          recordImportResult(payload, index + 2);
          continue;
        }

        const assignedOfficerName =
          row.assignedOfficerName?.trim() ?? "";

        const matchedOfficer = assignedOfficerName
          ? getPersonnelMatch(assignedOfficerName, personnel)
          : null;

        if (assignedOfficerName && !matchedOfficer) {
          throw new Error(
            `Assigned officer "${assignedOfficerName}" did not uniquely match an active personnel record.`,
          );
        }

        const payload = await importFirearm(
          row,
          departmentId,
          matchedOfficer?.userId,
        );
        recordImportResult(payload, index + 2);
      } catch (error) {
        failures.push(
          `Row ${index + 2}: ${
            error instanceof Error
              ? error.message
              : "Unknown import error"
          }`,
        );
      }
    }

    setReport({
      created,
      updated,
      unchanged,
      review,
      skipped: 0,
      failed: failures.length,
      message:
        selectedDefinition.id === "personnel"
          ? failures.length === 0
            ? "Personnel import completed. Accounts are staged pending activation."
            : "Personnel import completed with errors."
          : failures.length === 0
            ? `${selectedDefinition.label} import completed.`
            : `${selectedDefinition.label} import completed with errors.`,
      failures,
      reviews,
    });

    setImporting(false);
    setStep("report");
  }


  async function handleExportPersonnel() {
    setExporting("personnel");
    setExportError(null);

    try {
      const payload = await fetchJson<{
        personnel?: Array<{
          displayName?: string;
          fullName?: string;
          email?: string | null;
          badgeNumber?: string | null;
          rankTitle?: string | null;
          unitName?: string | null;
          employeeNumber?: string | null;
          assignment?: string | null;
          roles?: string[];
          isActive?: boolean;
        }>;
      }>("/api/pilot/personnel");

      const rows = (payload.personnel ?? []).map((person) => ({
        displayName: person.displayName,
        fullName: person.fullName,
        email: person.email,
        badgeNumber: person.badgeNumber,
        employeeNumber: person.employeeNumber,
        rankTitle: person.rankTitle,
        unitName: person.unitName,
        assignment: person.assignment,
        roles: person.roles?.join("; "),
        isActive: person.isActive,
      }));

      downloadCsv(`tracepoint-personnel-${exportDate()}.csv`, rows);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "Personnel export failed.",
      );
    } finally {
      setExporting(null);
    }
  }

  async function handleExportFirearms() {
    setExporting("firearms");
    setExportError(null);

    try {
      const payload = await fetchJson<{
        firearms?: Array<{
          make?: string;
          model?: string;
          serial_number?: string;
          firearm_type?: string;
          caliber?: string | null;
          asset_number?: string | null;
          condition_status?: string | null;
          notes?: string | null;
          is_active?: boolean;
          active_assignment?: {
            assigned_to_name?: string;
            assigned_at?: string;
          } | null;
        }>;
      }>("/api/armory/firearms");

      const rows = (payload.firearms ?? []).map((firearm) => ({
        make: firearm.make,
        model: firearm.model,
        serialNumber: firearm.serial_number,
        firearmType: firearm.firearm_type,
        caliber: firearm.caliber,
        assetNumber: firearm.asset_number,
        conditionStatus: firearm.condition_status,
        assignedTo: firearm.active_assignment?.assigned_to_name,
        assignedAt: firearm.active_assignment?.assigned_at,
        isActive: firearm.is_active,
        notes: firearm.notes,
      }));

      downloadCsv(`tracepoint-firearms-${exportDate()}.csv`, rows);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "Firearms export failed.",
      );
    } finally {
      setExporting(null);
    }
  }

  async function handleExportAmmunition() {
    setExporting("ammunition");
    setExportError(null);

    try {
      const payload = await fetchJson<{
        workspace?: {
          dutyLots?: Array<Record<string, any>>;
          trainingLots?: Array<Record<string, any>>;
        };
      }>("/api/pilot/ammunition");

      const dutyRows = (payload.workspace?.dutyLots ?? []).map((lot) => ({
        workspace: "Duty",
        caliber: lot.caliber,
        manufacturer: lot.manufacturer,
        loadDescription: lot.loadDescription,
        lotNumber: lot.lotNumber,
        purchaseDate: lot.purchaseDate,
        quantityOnHand: lot.quantityOnHand,
        replacementDueDate: lot.replacementDueDate,
        recallFlag: lot.recallFlag,
        costPerRound: "",
        lowStockThreshold: "",
        notes: lot.notes,
      }));

      const trainingRows = (payload.workspace?.trainingLots ?? []).map((lot) => ({
        workspace: "Training",
        caliber: lot.caliber,
        manufacturer: lot.manufacturer,
        loadDescription: lot.loadDescription,
        lotNumber: lot.lotNumber,
        purchaseDate: lot.purchaseDate,
        quantityOnHand: lot.quantityOnHand,
        replacementDueDate: "",
        recallFlag: "",
        costPerRound: lot.costPerRound,
        lowStockThreshold: lot.lowStockThreshold,
        notes: lot.notes,
      }));

      downloadCsv(`tracepoint-ammunition-${exportDate()}.csv`, [
        ...dutyRows,
        ...trainingRows,
      ]);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "Ammunition export failed.",
      );
    } finally {
      setExporting(null);
    }
  }


  async function handleExportQualifications() {
    setExporting("qualifications");
    setExportError(null);

    try {
      const [workspacePayload, personnelPayload] = await Promise.all([
        fetchJson<{
          workspace?: {
            rangeDays?: Array<{
              id: string;
              title?: string;
              status?: string;
              date?: string;
              location?: string;
            }>;
            drillLibrary?: Array<{
              id: string;
              name?: string;
              category?: string;
            }>;
            results?: Array<{
              id: string;
              rangeDayId: string;
              drillId: string;
              officerId: string;
              runNumber?: number;
              firearmId?: string;
              score?: number;
              passed?: boolean;
              completed?: boolean;
              instructorId?: string;
              notes?: string;
              deficiencyObserved?: boolean;
              remedialTrainingRecommended?: boolean;
              malfunctionIds?: string[];
            }>;
            malfunctions?: Array<{
              id: string;
              drillRunId?: string;
            }>;
          };
        }>("/api/pilot/range-workspace"),

        fetchJson<{
          personnel?: PilotPersonnel[];
        }>("/api/pilot/personnel"),
      ]);

      const workspace = workspacePayload.workspace;
      const personnel = personnelPayload.personnel ?? [];

      const personnelById = new Map<string, PilotPersonnel>();

      personnel.forEach((person) => {
        personnelById.set(person.id, person);

        if (person.userId) {
          personnelById.set(person.userId, person);
        }
      });

      const rangeDayById = new Map(
        (workspace?.rangeDays ?? []).map((rangeDay) => [
          rangeDay.id,
          rangeDay,
        ]),
      );

      const drillById = new Map(
        (workspace?.drillLibrary ?? []).map((drill) => [
          drill.id,
          drill,
        ]),
      );

      const rows = (workspace?.results ?? [])
        .map((result) => {
          const drill = drillById.get(result.drillId);

          const drillName = drill?.name ?? "";
          const drillCategory = drill?.category ?? "";

          const classification =
            `${drillName} ${drillCategory}`.toLowerCase();

          const isQualification =
            classification.includes("qualification") ||
            classification.includes("qualifying");

          const isRifle = classification.includes("rifle");

          if (!isQualification && !isRifle) {
            return null;
          }

          const rangeDay = rangeDayById.get(result.rangeDayId);
          const officer = personnelById.get(result.officerId);

          const instructor = result.instructorId
            ? personnelById.get(result.instructorId)
            : undefined;

          const runNumber = result.runNumber ?? 1;

          const runLabel = isRifle
            ? `Run ${runNumber}`
            : runNumber === 1
              ? "Day Qualification"
              : runNumber === 2
                ? "Night Qualification"
                : `Run ${runNumber}`;

          const malfunctionCount = (
            workspace?.malfunctions ?? []
          ).filter(
            (malfunction) =>
              malfunction.drillRunId === result.id ||
              result.malfunctionIds?.includes(malfunction.id),
          ).length;

          return {
            officerName:
              officer?.displayName ||
              officer?.fullName ||
              result.officerId,
            badgeNumber: officer?.badgeNumber,
            rankTitle: officer?.rankTitle,
            officerId: result.officerId,

            qualificationDate: rangeDay?.date,
            rangeDayTitle: rangeDay?.title,
            rangeDayStatus: rangeDay?.status,
            location: rangeDay?.location,

            drillName,
            drillCategory,
            runNumber,
            runLabel,

            score: result.score,

            result:
              result.passed === true
                ? "Pass"
                : result.passed === false
                  ? "Fail"
                  : result.completed
                    ? "Completed"
                    : "Incomplete",

            passed: result.passed,
            completed: result.completed,

            firearmId: result.firearmId,

            instructor:
              instructor?.displayName ||
              instructor?.fullName ||
              result.instructorId,

            instructorId: result.instructorId,

            deficiencyObserved:
              result.deficiencyObserved,

            remedialTrainingRecommended:
              result.remedialTrainingRecommended,

            malfunctionCount,
            notes: result.notes,

            rangeDayId: result.rangeDayId,
            resultId: result.id,
          };
        })
        .filter(
          (row): row is NonNullable<typeof row> =>
            row !== null,
        )
        .sort((a, b) =>
          String(b.qualificationDate ?? "").localeCompare(
            String(a.qualificationDate ?? ""),
          ),
        );

      downloadCsv(
        `tracepoint-qualifications-${exportDate()}.csv`,
        rows,
      );
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Qualifications export failed.",
      );
    } finally {
      setExporting(null);
    }
  }

  async function handleExportTrainingRecords() {
    setExporting("training-records");
    setExportError(null);

    try {
      const [workspacePayload, personnelPayload] = await Promise.all([
        fetchJson<{
          workspace?: {
            rangeDays?: Array<{
              id: string;
              title?: string;
              status?: string;
              date?: string;
              location?: string;
            }>;
            drillLibrary?: Array<{
              id: string;
              name?: string;
              category?: string;
            }>;
            results?: Array<{
              id: string;
              rangeDayId: string;
              drillId: string;
              officerId: string;
              runNumber?: number;
              firearmId?: string;
              score?: number;
              passed?: boolean;
              completed?: boolean;
              instructorId?: string;
              notes?: string;
              deficiencyObserved?: boolean;
              remedialTrainingRecommended?: boolean;
              malfunctionIds?: string[];
            }>;
            malfunctions?: Array<{
              id: string;
              drillRunId?: string;
            }>;
          };
        }>("/api/pilot/range-workspace"),

        fetchJson<{
          personnel?: PilotPersonnel[];
        }>("/api/pilot/personnel"),
      ]);

      const workspace = workspacePayload.workspace;
      const personnel = personnelPayload.personnel ?? [];

      const personnelById = new Map<string, PilotPersonnel>();

      personnel.forEach((person) => {
        personnelById.set(person.id, person);

        if (person.userId) {
          personnelById.set(person.userId, person);
        }
      });

      const rangeDayById = new Map(
        (workspace?.rangeDays ?? []).map((rangeDay) => [
          rangeDay.id,
          rangeDay,
        ]),
      );

      const drillById = new Map(
        (workspace?.drillLibrary ?? []).map((drill) => [
          drill.id,
          drill,
        ]),
      );

      const rows = (workspace?.results ?? [])
        .map((result) => {
          const rangeDay = rangeDayById.get(result.rangeDayId);
          const drill = drillById.get(result.drillId);
          const officer = personnelById.get(result.officerId);

          const instructor = result.instructorId
            ? personnelById.get(result.instructorId)
            : undefined;

          const malfunctionCount = (
            workspace?.malfunctions ?? []
          ).filter(
            (malfunction) =>
              malfunction.drillRunId === result.id ||
              result.malfunctionIds?.includes(malfunction.id),
          ).length;

          const runNumber = result.runNumber ?? 1;

          return {
            officerName:
              officer?.displayName ||
              officer?.fullName ||
              result.officerId,

            badgeNumber: officer?.badgeNumber,
            rankTitle: officer?.rankTitle,
            officerId: result.officerId,

            trainingDate: rangeDay?.date,
            rangeDayTitle: rangeDay?.title,
            rangeDayStatus: rangeDay?.status,
            location: rangeDay?.location,

            drillName: drill?.name,
            drillCategory: drill?.category,

            runNumber,
            runLabel: `Run ${runNumber}`,

            score: result.score,

            result:
              result.passed === true
                ? "Pass"
                : result.passed === false
                  ? "Fail"
                  : result.completed
                    ? "Completed"
                    : "Incomplete",

            passed: result.passed,
            completed: result.completed,

            firearmId: result.firearmId,

            instructor:
              instructor?.displayName ||
              instructor?.fullName ||
              result.instructorId,

            instructorId: result.instructorId,

            deficiencyObserved:
              result.deficiencyObserved,

            remedialTrainingRecommended:
              result.remedialTrainingRecommended,

            malfunctionCount,
            notes: result.notes,

            rangeDayId: result.rangeDayId,
            drillId: result.drillId,
            resultId: result.id,
          };
        })
        .sort((a, b) =>
          String(b.trainingDate ?? "").localeCompare(
            String(a.trainingDate ?? ""),
          ),
        );

      downloadCsv(
        `tracepoint-training-records-${exportDate()}.csv`,
        rows,
      );
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Training records export failed.",
      );
    } finally {
      setExporting(null);
    }
  }

  async function handleExportRangeDays() {
    setExporting("range-days");
    setExportError(null);

    try {
      const [workspacePayload, personnelPayload] = await Promise.all([
        fetchJson<{
          workspace?: {
            rangeDays?: Array<{
              id: string;
              title?: string;
              status?: string;
              date?: string;
              location?: string;
              notes?: string;
            }>;
            drillLibrary?: Array<{
              id: string;
              name?: string;
              category?: string;
            }>;
            results?: Array<{
              id: string;
              rangeDayId: string;
              drillId: string;
              officerId: string;
              instructorId?: string;
              completed?: boolean;
              passed?: boolean;
              score?: number;
              firearmId?: string;
              deficiencyObserved?: boolean;
              remedialTrainingRecommended?: boolean;
              malfunctionIds?: string[];
            }>;
            malfunctions?: Array<{
              id: string;
              drillRunId?: string;
            }>;
          };
        }>("/api/pilot/range-workspace"),

        fetchJson<{
          personnel?: PilotPersonnel[];
        }>("/api/pilot/personnel"),
      ]);

      const workspace = workspacePayload.workspace;
      const personnel = personnelPayload.personnel ?? [];

      const personnelById = new Map<string, PilotPersonnel>();

      personnel.forEach((person) => {
        personnelById.set(person.id, person);

        if (person.userId) {
          personnelById.set(person.userId, person);
        }
      });

      const drillById = new Map(
        (workspace?.drillLibrary ?? []).map((drill) => [
          drill.id,
          drill,
        ]),
      );

      const results = workspace?.results ?? [];
      const malfunctions = workspace?.malfunctions ?? [];

      const rows = (workspace?.rangeDays ?? [])
        .map((rangeDay) => {
          const rangeDayResults = results.filter(
            (result) => result.rangeDayId === rangeDay.id,
          );

          const officerIds = Array.from(
            new Set(
              rangeDayResults
                .map((result) => result.officerId)
                .filter(Boolean),
            ),
          );

          const instructorIds = Array.from(
            new Set(
              rangeDayResults
                .map((result) => result.instructorId)
                .filter((value): value is string => Boolean(value)),
            ),
          );

          const drillIds = Array.from(
            new Set(
              rangeDayResults
                .map((result) => result.drillId)
                .filter(Boolean),
            ),
          );

          const firearmIds = Array.from(
            new Set(
              rangeDayResults
                .map((result) => result.firearmId)
                .filter((value): value is string => Boolean(value)),
            ),
          );

          const resultIds = new Set(
            rangeDayResults.map((result) => result.id),
          );

          const malfunctionCount = malfunctions.filter(
            (malfunction) =>
              Boolean(
                malfunction.drillRunId &&
                  resultIds.has(malfunction.drillRunId),
              ),
          ).length;

          const officerNames = officerIds.map((officerId) => {
            const officer = personnelById.get(officerId);

            return (
              officer?.displayName ||
              officer?.fullName ||
              officerId
            );
          });

          const instructorNames = instructorIds.map(
            (instructorId) => {
              const instructor = personnelById.get(instructorId);

              return (
                instructor?.displayName ||
                instructor?.fullName ||
                instructorId
              );
            },
          );

          const drillNames = drillIds.map((drillId) => {
            const drill = drillById.get(drillId);

            return drill?.name || drillId;
          });

          const completedResults = rangeDayResults.filter(
            (result) => result.completed,
          ).length;

          const passedResults = rangeDayResults.filter(
            (result) => result.passed === true,
          ).length;

          const failedResults = rangeDayResults.filter(
            (result) => result.passed === false,
          ).length;

          const deficiencyCount = rangeDayResults.filter(
            (result) => result.deficiencyObserved,
          ).length;

          const remedialRecommendedCount = rangeDayResults.filter(
            (result) => result.remedialTrainingRecommended,
          ).length;

          return {
            rangeDayId: rangeDay.id,
            date: rangeDay.date,
            title: rangeDay.title,
            status: rangeDay.status,
            location: rangeDay.location,

            officerCount: officerIds.length,
            officers: officerNames.join("; "),

            instructorCount: instructorIds.length,
            instructors: instructorNames.join("; "),

            drillCount: drillIds.length,
            drills: drillNames.join("; "),

            firearmCount: firearmIds.length,
            firearmIds: firearmIds.join("; "),

            resultCount: rangeDayResults.length,
            completedResults,
            passedResults,
            failedResults,

            deficiencyCount,
            remedialRecommendedCount,
            malfunctionCount,

            notes: rangeDay.notes,
          };
        })
        .sort((a, b) =>
          String(b.date ?? "").localeCompare(
            String(a.date ?? ""),
          ),
        );

      downloadCsv(
        `tracepoint-range-days-${exportDate()}.csv`,
        rows,
      );
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Range Days export failed.",
      );
    } finally {
      setExporting(null);
    }
  }

  async function handleExportCertifications() {
    setExporting("certifications");
    setExportError(null);

    try {
      const payload = await fetchJson<{
        certifications?: Array<{
          id: string;
          user_id: string;
          certification_type_id?: string | null;
          certification_title: string;
          issuing_organization?: string | null;
          credential_number?: string | null;
          issue_date?: string | null;
          expiration_date?: string | null;
          reminder_days?: number[] | null;
          notes?: string | null;
          document_url?: string | null;
          is_active?: boolean;
        }>;
        members?: Array<{
          user_id: string;
          full_name: string;
          badge_number?: string | null;
          rank_title?: string | null;
          is_active?: boolean;
        }>;
        certificationTypes?: Array<{
          id: string;
          name: string;
          description?: string | null;
          category: string;
          issuing_organization?: string | null;
          expiration_required: boolean;
          default_valid_days?: number | null;
          default_due_soon_days: number;
          is_active: boolean;
        }>;
        requirements?: Array<{
          id: string;
          certification_type_id: string;
          is_required: boolean;
          valid_days?: number | null;
          due_soon_days?: number | null;
          is_active: boolean;
          notes?: string | null;
        }>;
      }>("/api/training/certifications");

      const membersById = new Map(
        (payload.members ?? []).map((member) => [
          member.user_id,
          member,
        ]),
      );

      const typesById = new Map(
        (payload.certificationTypes ?? []).map((type) => [
          type.id,
          type,
        ]),
      );

      const requirementsByTypeId = new Map(
        (payload.requirements ?? []).map((requirement) => [
          requirement.certification_type_id,
          requirement,
        ]),
      );

      const rows = (payload.certifications ?? [])
        .map((certification) => {
          const member = membersById.get(certification.user_id);

          const type = certification.certification_type_id
            ? typesById.get(certification.certification_type_id)
            : undefined;

          const requirement = certification.certification_type_id
            ? requirementsByTypeId.get(
                certification.certification_type_id,
              )
            : undefined;

          return {
            officerName:
              member?.full_name ||
              certification.user_id,

            badgeNumber:
              member?.badge_number,

            rankTitle:
              member?.rank_title,

            userId:
              certification.user_id,

            certificationTitle:
              certification.certification_title,

            certificationTypeId:
              certification.certification_type_id,

            category:
              type?.category,

            typeDescription:
              type?.description,

            issuingOrganization:
              certification.issuing_organization ||
              type?.issuing_organization,

            credentialNumber:
              certification.credential_number,

            issueDate:
              certification.issue_date,

            expirationDate:
              certification.expiration_date,

            expirationRequired:
              type?.expiration_required,

            defaultValidDays:
              type?.default_valid_days,

            defaultDueSoonDays:
              type?.default_due_soon_days,

            requiredByDepartment:
              requirement?.is_required,

            requirementValidDays:
              requirement?.valid_days,

            requirementDueSoonDays:
              requirement?.due_soon_days,

            requirementNotes:
              requirement?.notes,

            reminderDays:
              certification.reminder_days?.join("; "),

            documentUrl:
              certification.document_url,

            notes:
              certification.notes,

            certificationId:
              certification.id,
          };
        })
        .sort((a, b) =>
          String(a.officerName ?? "").localeCompare(
            String(b.officerName ?? ""),
          ),
        );

      downloadCsv(
        `tracepoint-certifications-${exportDate()}.csv`,
        rows,
      );
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Certifications export failed.",
      );
    } finally {
      setExporting(null);
    }
  }

  async function handleExportEquipment() {
    setExporting("equipment");
    setExportError(null);

    try {
      const [assetsPayload, typesPayload, requirementsPayload] =
        await Promise.all([
          fetchJson<{
            items?: Array<{
              id: string;
              equipment_type_id: string;

              manufacturer?: string | null;
              model?: string | null;
              serial_number?: string | null;
              lot_number?: string | null;

              assigned_user_id?: string | null;

              issue_date?: string | null;
              expiration_date?: string | null;

              last_inspection_date?: string | null;
              next_inspection_date?: string | null;

              lifecycle_status:
                | "active"
                | "out_of_service"
                | "removed";

              notes?: string | null;
              document_url?: string | null;
            }>;

            members?: Array<{
              userId: string;
              fullName: string;
              badgeNumber?: string | null;
              rankTitle?: string | null;
            }>;
          }>("/api/equipment/assets"),

          fetchJson<{
            items?: Array<{
              id: string;
              name: string;
              category: string;
              description?: string | null;

              expiration_required: boolean;
              default_valid_days?: number | null;
              default_due_soon_days: number;

              inspection_required: boolean;
              default_inspection_interval_days?: number | null;
              default_inspection_due_soon_days: number;

              is_active: boolean;
            }>;
          }>("/api/equipment/types"),

          fetchJson<{
            items?: Array<{
              id: string;
              equipment_type_id: string;
              is_required: boolean;
              required_quantity: number;

              valid_days?: number | null;
              due_soon_days?: number | null;

              inspection_interval_days?: number | null;
              inspection_due_soon_days?: number | null;

              is_active: boolean;
              notes?: string | null;
            }>;
          }>("/api/equipment/requirements"),
        ]);

      const membersById = new Map(
        (assetsPayload.members ?? []).map((member) => [
          member.userId,
          member,
        ]),
      );

      const typesById = new Map(
        (typesPayload.items ?? []).map((type) => [
          type.id,
          type,
        ]),
      );

      const requirementsByTypeId = new Map(
        (requirementsPayload.items ?? []).map((requirement) => [
          requirement.equipment_type_id,
          requirement,
        ]),
      );

      const rows = (assetsPayload.items ?? [])
        .map((asset) => {
          const type = typesById.get(
            asset.equipment_type_id,
          );

          const requirement = requirementsByTypeId.get(
            asset.equipment_type_id,
          );

          const member = asset.assigned_user_id
            ? membersById.get(asset.assigned_user_id)
            : undefined;

          return {
            equipmentId: asset.id,

            equipmentType:
              type?.name ||
              asset.equipment_type_id,

            equipmentTypeId:
              asset.equipment_type_id,

            category:
              type?.category,

            typeDescription:
              type?.description,

            manufacturer:
              asset.manufacturer,

            model:
              asset.model,

            serialNumber:
              asset.serial_number,

            lotNumber:
              asset.lot_number,

            assignedOfficer:
              member?.fullName,

            badgeNumber:
              member?.badgeNumber,

            rankTitle:
              member?.rankTitle,

            assignedUserId:
              asset.assigned_user_id,

            issueDate:
              asset.issue_date,

            expirationDate:
              asset.expiration_date,

            expirationRequired:
              type?.expiration_required,

            defaultValidDays:
              type?.default_valid_days,

            defaultExpirationDueSoonDays:
              type?.default_due_soon_days,

            lastInspectionDate:
              asset.last_inspection_date,

            nextInspectionDate:
              asset.next_inspection_date,

            inspectionRequired:
              type?.inspection_required,

            defaultInspectionIntervalDays:
              type?.default_inspection_interval_days,

            defaultInspectionDueSoonDays:
              type?.default_inspection_due_soon_days,

            requiredByDepartment:
              requirement?.is_required,

            requiredQuantity:
              requirement?.required_quantity,

            requirementValidDays:
              requirement?.valid_days,

            requirementDueSoonDays:
              requirement?.due_soon_days,

            requirementInspectionIntervalDays:
              requirement?.inspection_interval_days,

            requirementInspectionDueSoonDays:
              requirement?.inspection_due_soon_days,

            requirementNotes:
              requirement?.notes,

            lifecycleStatus:
              asset.lifecycle_status,

            documentUrl:
              asset.document_url,

            notes:
              asset.notes,
          };
        })
        .sort((a, b) => {
          const typeCompare = String(
            a.equipmentType ?? "",
          ).localeCompare(
            String(b.equipmentType ?? ""),
          );

          if (typeCompare !== 0) {
            return typeCompare;
          }

          return String(
            a.assignedOfficer ?? "",
          ).localeCompare(
            String(b.assignedOfficer ?? ""),
          );
        });

      downloadCsv(
        `tracepoint-equipment-${exportDate()}.csv`,
        rows,
      );
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Equipment export failed.",
      );
    } finally {
      setExporting(null);
    }
  }

  async function handleExportOffDutyFirearms() {
    setExporting("off-duty-firearms");
    setExportError(null);

    try {
      const payload = await fetchJson<{
        records?: Array<{
          id: string;
          officerId: string;
          officer: string;
          badge: string;
          unit: string;

          make: string;
          model: string;
          firearmType: string;
          serial: string;
          caliber: string;
          capacity: string;
          optic: string;
          weaponLight: string;
          holster: string;

          proofOwnership: boolean;
          qualificationReviewed: boolean;
          inspectionReviewed: boolean;
          policyAcknowledged: boolean;

          officerNotes: string;

          requestStatus:
            | "Draft"
            | "Pending Command Review"
            | "Returned for Correction"
            | "Approved"
            | "Denied"
            | "Withdrawn";

          authorizationStatus:
            | "Not Authorized"
            | "Authorized"
            | "Expiring Soon"
            | "Expired"
            | "Revoked";

          submittedAt: string;
          reviewedAt?: string;
          reviewedBy?: string;

          approvalDate?: string;
          approvalExpires?: string;

          decisionNotes?: string;

          lastQual: string;
          qualificationStatus: string;
          qualificationReason: string;

          inspectionStatus:
            | "Not Inspected"
            | "Current"
            | "Due Soon"
            | "Overdue";

          compliance:
            | "Authorized"
            | "At Risk"
            | "Non-Compliant";

          auditTrail?: Array<{
            id: string;
            action:
              | "Submitted"
              | "Resubmitted"
              | "Approved"
              | "Denied"
              | "Returned for Correction"
              | "Revoked";
            actor: string;
            actorRole: string;
            timestamp: string;
            notes?: string;
          }>;
        }>;
      }>("/api/off-duty-firearms");

      const rows = (payload.records ?? [])
        .map((record) => {
          const auditTrail = record.auditTrail ?? [];

          const auditHistory = auditTrail
            .map((event) => {
              const parts = [
                event.timestamp,
                event.action,
                event.actor,
                event.actorRole,
              ];

              if (event.notes) {
                parts.push(event.notes);
              }

              return parts.join(" | ");
            })
            .join(" || ");

          const submittedEvents = auditTrail.filter(
            (event) =>
              event.action === "Submitted" ||
              event.action === "Resubmitted",
          );

          const approvalEvents = auditTrail.filter(
            (event) => event.action === "Approved",
          );

          const denialEvents = auditTrail.filter(
            (event) => event.action === "Denied",
          );

          const returnEvents = auditTrail.filter(
            (event) =>
              event.action === "Returned for Correction",
          );

          const revocationEvents = auditTrail.filter(
            (event) => event.action === "Revoked",
          );

          return {
            requestId: record.id,

            officerName: record.officer,
            badgeNumber: record.badge,
            unit: record.unit,
            officerId: record.officerId,

            make: record.make,
            model: record.model,
            firearmType: record.firearmType,
            serialNumber: record.serial,
            caliber: record.caliber,
            capacity: record.capacity,
            optic: record.optic,
            weaponLight: record.weaponLight,
            holster: record.holster,

            proofOwnership: record.proofOwnership,
            qualificationReviewed:
              record.qualificationReviewed,
            inspectionReviewed:
              record.inspectionReviewed,
            policyAcknowledged:
              record.policyAcknowledged,

            officerNotes: record.officerNotes,

            requestStatus: record.requestStatus,
            authorizationStatus:
              record.authorizationStatus,

            submittedAt: record.submittedAt,
            reviewedAt: record.reviewedAt,
            reviewedBy: record.reviewedBy,

            approvalEffectiveDate:
              record.approvalDate,

            approvalExpirationDate:
              record.approvalExpires,

            decisionNotes:
              record.decisionNotes,

            qualificationStatus:
              record.qualificationStatus,

            qualificationReason:
              record.qualificationReason,

            inspectionStatus:
              record.inspectionStatus,

            complianceStatus:
              record.compliance,

            workflowEventCount:
              auditTrail.length,

            submissionEventCount:
              submittedEvents.length,

            approvalEventCount:
              approvalEvents.length,

            denialEventCount:
              denialEvents.length,

            returnForCorrectionCount:
              returnEvents.length,

            revocationEventCount:
              revocationEvents.length,

            auditHistory,
          };
        })
        .sort((a, b) =>
          String(b.submittedAt ?? "").localeCompare(
            String(a.submittedAt ?? ""),
          ),
        );

      downloadCsv(
        `tracepoint-off-duty-firearms-${exportDate()}.csv`,
        rows,
      );
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Off-Duty Firearms export failed.",
      );
    } finally {
      setExporting(null);
    }
  }

  async function handleExportCompleteAuditHistory() {
    setExporting("complete-audit-history");
    setExportError(null);

    try {
      const payload = await fetchJson<{
        events?: Array<{
          id: string;
          entity_type?: string | null;
          entity_id?: string | null;
          action?: string | null;
          changed_by_user_id?: string | null;
          change_note?: string | null;
          changed_fields?: unknown;
          old_values?: unknown;
          new_values?: unknown;
          created_at?: string | null;
        }>;
        count?: number;
      }>("/api/settings/audit-log/export");

      const stringifyAuditValue = (value: unknown) => {
        if (value === null || value === undefined) {
          return "";
        }

        if (typeof value === "string") {
          return value;
        }

        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      };

      const rows = (payload.events ?? []).map((event) => ({
        auditEventId: event.id,
        timestamp: event.created_at,
        entityType: event.entity_type,
        entityId: event.entity_id,
        action: event.action,
        changedByUserId: event.changed_by_user_id,
        changeNote: event.change_note,
        changedFields: stringifyAuditValue(
          event.changed_fields,
        ),
        oldValues: stringifyAuditValue(
          event.old_values,
        ),
        newValues: stringifyAuditValue(
          event.new_values,
        ),
      }));

      downloadCsv(
        `tracepoint-complete-audit-history-${exportDate()}.csv`,
        rows,
      );
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Complete Audit History export failed.",
      );
    } finally {
      setExporting(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadReportOfficerOptions() {
      try {
        const payload = await fetchJson<{
          records?: Array<{
            officerId: string;
            officer: string;
            badge: string;
          }>;
        }>("/api/off-duty-firearms");

        if (cancelled) {
          return;
        }

        const unique = new Map<
          string,
          {
            id: string;
            name: string;
            badge: string;
          }
        >();

        for (const record of payload.records ?? []) {
          if (!unique.has(record.officerId)) {
            unique.set(record.officerId, {
              id: record.officerId,
              name: record.officer,
              badge: record.badge,
            });
          }
        }

        setReportOfficerOptions(
          Array.from(unique.values()).sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        );
      } catch {
        // Report generation will surface API errors if needed.
      }
    }

    void loadReportOfficerOptions();

    return () => {
      cancelled = true;
    };
  }, [departmentId]);


  async function handleGenerateCompleteReport() {
    setReportGenerating(true);
    setExportError(null);

    try {
      type JsonObject = Record<string, any>;

      async function safeReportFetch(
        name: string,
        url: string,
      ): Promise<{
        name: string;
        ok: boolean;
        data: JsonObject;
        error?: string;
      }> {
        try {
          const data = await fetchJson<JsonObject>(url);

          return {
            name,
            ok: true,
            data,
          };
        } catch (error) {
          return {
            name,
            ok: false,
            data: {},
            error:
              error instanceof Error
                ? error.message
                : `${name} could not be loaded.`,
          };
        }
      }

      const results = await Promise.all([
        safeReportFetch(
          "Personnel",
          "/api/pilot/personnel",
        ),
        safeReportFetch(
          "Range / Training",
          "/api/pilot/range-workspace",
        ),
        safeReportFetch(
          "Certifications",
          "/api/training/certifications",
        ),
        safeReportFetch(
          "Equipment",
          "/api/equipment/assets",
        ),
        safeReportFetch(
          "Equipment Types",
          "/api/equipment/types",
        ),
        safeReportFetch(
          "Off-Duty Firearms",
          "/api/off-duty-firearms",
        ),
        safeReportFetch(
          "Audit History",
          "/api/settings/audit-log/export",
        ),
        safeReportFetch(
          "Firearms",
          "/api/armory/firearms",
        ),
        safeReportFetch(
          "Ammunition",
          "/api/pilot/ammunition",
        ),
      ]);

      const byName = new Map(
        results.map((result) => [
          result.name,
          result,
        ]),
      );

      const personnelData =
        byName.get("Personnel")?.data ?? {};

      const rangeData =
        byName.get("Range / Training")?.data ?? {};

      const certificationData =
        byName.get("Certifications")?.data ?? {};

      const equipmentData =
        byName.get("Equipment")?.data ?? {};

      const equipmentTypesData =
        byName.get("Equipment Types")?.data ?? {};

      const offDutyData =
        byName.get("Off-Duty Firearms")?.data ?? {};

      const auditData =
        byName.get("Audit History")?.data ?? {};

      const firearmsData =
        byName.get("Firearms")?.data ?? {};

      const ammunitionData =
        byName.get("Ammunition")?.data ?? {};

      const personnel =
        personnelData.personnel ??
        personnelData.members ??
        [];

      const workspace =
        rangeData.workspace ??
        rangeData;

      const rangeDays =
        workspace.rangeDays ?? [];

      const drills =
        workspace.drillLibrary ?? [];

      const trainingResults =
        workspace.results ?? [];

      const certifications =
        certificationData.certifications ?? [];

      const equipment =
        equipmentData.items ?? [];

      const equipmentTypes =
        equipmentTypesData.items ?? [];

      const offDuty =
        offDutyData.records ?? [];

      const audit =
        auditData.events ?? [];

      const firearms =
        firearmsData.firearms ??
        firearmsData.items ??
        [];

      const ammunitionWorkspace =
        ammunitionData.workspace ??
        ammunitionData;

      const dutyLots =
        ammunitionWorkspace.dutyLots ?? [];

      const trainingLots =
        ammunitionWorkspace.trainingLots ?? [];

      const selectedOfficerId =
        reportOfficerId === "all"
          ? null
          : reportOfficerId;

      function recordMatchesOfficer(
        possibleIds: unknown[],
      ) {
        if (!selectedOfficerId) {
          return true;
        }

        return possibleIds.some(
          (value) =>
            String(value ?? "") ===
            selectedOfficerId,
        );
      }

      function inDateRange(
        value?: string | null,
      ) {
        if (
          reportDateMode !== "custom" ||
          !value
        ) {
          return true;
        }

        const parsed = new Date(
          value.length === 10
            ? `${value}T12:00:00`
            : value,
        );

        if (
          Number.isNaN(parsed.getTime())
        ) {
          return false;
        }

        if (reportStartDate) {
          const start = new Date(
            `${reportStartDate}T00:00:00`,
          );

          if (parsed < start) {
            return false;
          }
        }

        if (reportEndDate) {
          const end = new Date(
            `${reportEndDate}T23:59:59.999`,
          );

          if (parsed > end) {
            return false;
          }
        }

        return true;
      }

      const personnelMap = new Map<
        string,
        {
          name: string;
          badge: string;
          rank: string;
        }
      >();

      for (const member of personnel) {
        const name =
          member.fullName ??
          member.displayName ??
          member.full_name ??
          member.name ??
          member.userId ??
          member.user_id ??
          member.id ??
          "Unknown Officer";

        const value = {
          name: String(name),
          badge: String(
            member.badgeNumber ??
              member.badge_number ??
              "",
          ),
          rank: String(
            member.rankTitle ??
              member.rank_title ??
              "",
          ),
        };

        for (const id of [
          member.id,
          member.userId,
          member.user_id,
        ]) {
          if (id) {
            personnelMap.set(
              String(id),
              value,
            );
          }
        }
      }

      for (
        const member of
        certificationData.members ?? []
      ) {
        const id =
          member.user_id ??
          member.userId;

        if (id) {
          personnelMap.set(
            String(id),
            {
              name: String(
                member.full_name ??
                  member.fullName ??
                  id,
              ),
              badge: String(
                member.badge_number ??
                  member.badgeNumber ??
                  "",
              ),
              rank: String(
                member.rank_title ??
                  member.rankTitle ??
                  "",
              ),
            },
          );
        }
      }

      for (
        const member of
        equipmentData.members ?? []
      ) {
        const id =
          member.userId ??
          member.user_id;

        if (id) {
          personnelMap.set(
            String(id),
            {
              name: String(
                member.fullName ??
                  member.full_name ??
                  id,
              ),
              badge: String(
                member.badgeNumber ??
                  member.badge_number ??
                  "",
              ),
              rank: String(
                member.rankTitle ??
                  member.rank_title ??
                  "",
              ),
            },
          );
        }
      }

      const rangeDaysById =
        new Map<string, any>();

      for (const rangeDay of rangeDays) {
        if (rangeDay.id) {
          rangeDaysById.set(
            String(rangeDay.id),
            rangeDay,
          );
        }
      }

      const drillsById =
        new Map<string, any>();

      for (const drill of drills) {
        if (drill.id) {
          drillsById.set(
            String(drill.id),
            drill,
          );
        }
      }

      const equipmentTypesById =
        new Map<string, any>();

      for (const type of equipmentTypes) {
        if (type.id) {
          equipmentTypesById.set(
            String(type.id),
            type,
          );
        }
      }

      const filteredTraining =
        trainingResults.filter(
          (result: any) => {
            if (
              !recordMatchesOfficer([
                result.officerId,
                result.officer_id,
                result.userId,
                result.user_id,
              ])
            ) {
              return false;
            }

            const day =
              rangeDaysById.get(
                String(
                  result.rangeDayId ??
                    result.range_day_id ??
                    "",
                ),
              );

            return inDateRange(
              day?.date ??
                result.date ??
                result.trainingDate,
            );
          },
        );

      const filteredQualifications =
        filteredTraining.filter(
          (result: any) => {
            const drill =
              drillsById.get(
                String(
                  result.drillId ??
                    result.drill_id ??
                    "",
                ),
              );

            const classification =
              `${drill?.name ?? ""} ${
                drill?.category ?? ""
              }`.toLowerCase();

            return (
              classification.includes(
                "qualification",
              ) ||
              classification.includes(
                "qualifying",
              ) ||
              classification.includes(
                "rifle",
              )
            );
          },
        );

      const filteredRangeDays =
        rangeDays.filter(
          (rangeDay: any) => {
            if (
              !inDateRange(
                rangeDay.date,
              )
            ) {
              return false;
            }

            if (!selectedOfficerId) {
              return true;
            }

            return filteredTraining.some(
              (result: any) =>
                String(
                  result.rangeDayId ??
                    result.range_day_id ??
                    "",
                ) ===
                String(rangeDay.id),
            );
          },
        );

      const filteredCertifications =
        certifications.filter(
          (certification: any) => {
            if (
              !recordMatchesOfficer([
                certification.user_id,
                certification.userId,
                certification.officerId,
              ])
            ) {
              return false;
            }

            return inDateRange(
              certification.issue_date ??
                certification.issueDate ??
                certification.expiration_date ??
                certification.expirationDate,
            );
          },
        );

      const filteredEquipment =
        equipment.filter(
          (asset: any) => {
            if (
              !recordMatchesOfficer([
                asset.assigned_user_id,
                asset.assignedUserId,
                asset.userId,
              ])
            ) {
              return false;
            }

            return inDateRange(
              asset.issue_date ??
                asset.issueDate ??
                asset.expiration_date ??
                asset.expirationDate,
            );
          },
        );

      const filteredOffDuty =
        offDuty.filter(
          (record: any) => {
            if (
              !recordMatchesOfficer([
                record.officerId,
                record.officer_id,
                record.userId,
              ])
            ) {
              return false;
            }

            if (
              !inDateRange(
                record.submittedAt ??
                  record.submitted_at,
              )
            ) {
              return false;
            }

            if (
              reportStatus !== "all" &&
              record.requestStatus !==
                reportStatus
            ) {
              return false;
            }

            return true;
          },
        );

      const filteredAudit =
        audit.filter(
          (event: any) => {
            if (
              !inDateRange(
                event.created_at ??
                  event.createdAt,
              )
            ) {
              return false;
            }

            if (!selectedOfficerId) {
              return true;
            }

            return (
              String(
                event.changed_by_user_id ??
                  event.changedByUserId ??
                  "",
              ) === selectedOfficerId
            );
          },
        );

      const {
        PDFDocument,
        StandardFonts,
        rgb,
      } = await import("pdf-lib");

      const pdf =
        await PDFDocument.create();

      const regular =
        await pdf.embedFont(
          StandardFonts.Helvetica,
        );

      const bold =
        await pdf.embedFont(
          StandardFonts.HelveticaBold,
        );

      let logo:
        | Awaited<
            ReturnType<typeof pdf.embedPng>
          >
        | null = null;

      try {
        const logoResponse =
          await fetch(
            "/tracepoint-logo-dark.png",
          );

        if (logoResponse.ok) {
          logo = await pdf.embedPng(
            await logoResponse.arrayBuffer(),
          );
        }
      } catch {
        logo = null;
      }

      const WIDTH = 612;
      const HEIGHT = 792;
      const LEFT = 44;
      const RIGHT = 44;
      const BOTTOM = 52;

      const dark = rgb(
        2 / 255,
        6 / 255,
        23 / 255,
      );

      const textColor = rgb(
        15 / 255,
        23 / 255,
        42 / 255,
      );

      const muted = rgb(
        71 / 255,
        85 / 255,
        105 / 255,
      );

      const border = rgb(
        203 / 255,
        213 / 255,
        225 / 255,
      );

      const white = rgb(1, 1, 1);

      let page =
        pdf.addPage([
          WIDTH,
          HEIGHT,
        ]);

      let y = 630;

      function clean(
        value: unknown,
      ) {
        if (
          value === null ||
          value === undefined ||
          value === ""
        ) {
          return "â€”";
        }

        return String(value);
      }

      function dateText(
        value?: string | null,
      ) {
        if (!value) {
          return "â€”";
        }

        const date = new Date(
          value.length === 10
            ? `${value}T12:00:00`
            : value,
        );

        if (
          Number.isNaN(
            date.getTime(),
          )
        ) {
          return value;
        }

        return date.toLocaleDateString();
      }

      function dateTimeText(
        value?: string | null,
      ) {
        if (!value) {
          return "â€”";
        }

        const date =
          new Date(value);

        if (
          Number.isNaN(
            date.getTime(),
          )
        ) {
          return value;
        }

        return date.toLocaleString();
      }

      function wrapText(
        value: unknown,
        maxWidth: number,
        size: number,
        font = regular,
      ) {
        const words =
          clean(value).split(/\s+/);

        const lines: string[] = [];
        let current = "";

        for (const word of words) {
          const test = current
            ? `${current} ${word}`
            : word;

          if (
            font.widthOfTextAtSize(
              test,
              size,
            ) <= maxWidth
          ) {
            current = test;
          } else {
            if (current) {
              lines.push(current);
            }

            current = word;
          }
        }

        if (current) {
          lines.push(current);
        }

        return lines.length
          ? lines
          : [""];
      }

      function drawMasthead() {
        page.drawRectangle({
          x: 0,
          y: 652,
          width: WIDTH,
          height: 140,
          color: dark,
        });

        if (logo) {
          const dimensions =
            logo.scale(0.16);

          const maxWidth = 190;

          const ratio =
            dimensions.width >
            maxWidth
              ? maxWidth /
                dimensions.width
              : 1;

          page.drawImage(logo, {
            x: LEFT,
            y: 718,
            width:
              dimensions.width *
              ratio,
            height:
              dimensions.height *
              ratio,
          });
        } else {
          page.drawText(
            "TRACEPOINT",
            {
              x: LEFT,
              y: 740,
              size: 20,
              font: bold,
              color: white,
            },
          );
        }

        page.drawText(
          "COMPLETE TRACEPOINT REPORT",
          {
            x: LEFT,
            y: 688,
            size: 15,
            font: bold,
            color: white,
          },
        );

        page.drawText(
          "Operational Accountability. Verified.",
          {
            x: LEFT,
            y: 670,
            size: 8,
            font: regular,
            color: rgb(
              203 / 255,
              213 / 255,
              225 / 255,
            ),
          },
        );

        y = 630;
      }

      function nextPage() {
        page =
          pdf.addPage([
            WIDTH,
            HEIGHT,
          ]);

        drawMasthead();
      }

      function ensureSpace(
        required: number,
      ) {
        if (
          y - required <
          BOTTOM
        ) {
          nextPage();
        }
      }

      function write(
        value: unknown,
        options?: {
          bold?: boolean;
          size?: number;
          indent?: number;
        },
      ) {
        const size =
          options?.size ?? 8;

        const indent =
          options?.indent ?? 0;

        const font =
          options?.bold
            ? bold
            : regular;

        const lines =
          wrapText(
            value,
            WIDTH -
              LEFT -
              RIGHT -
              indent,
            size,
            font,
          );

        ensureSpace(
          lines.length *
            (size + 4) +
            3,
        );

        for (const row of lines) {
          page.drawText(row, {
            x:
              LEFT +
              indent,
            y,
            size,
            font,
            color: textColor,
          });

          y -= size + 4;
        }
      }

      function field(
        label: string,
        value: unknown,
      ) {
        write(
          `${label}: ${clean(
            value,
          )}`,
        );
      }

      function section(
        title: string,
      ) {
        ensureSpace(34);

        y -= 8;

        page.drawText(title, {
          x: LEFT,
          y,
          size: 11,
          font: bold,
          color: textColor,
        });

        y -= 7;

        page.drawLine({
          start: {
            x: LEFT,
            y,
          },
          end: {
            x:
              WIDTH -
              RIGHT,
            y,
          },
          thickness: 0.7,
          color: border,
        });

        y -= 15;
      }

      function itemHeading(
        value: string,
      ) {
        ensureSpace(24);

        write(value, {
          bold: true,
          size: 9,
        });

        y -= 2;
      }

      drawMasthead();

      const selectedOfficer =
        selectedOfficerId
          ? personnelMap.get(
              selectedOfficerId,
            )
          : null;

      section(
        "REPORT PARAMETERS",
      );

      field(
        "Officer",
        selectedOfficer
          ?.name ??
          (selectedOfficerId
            ? selectedOfficerId
            : "All Officers"),
      );

      field(
        "Reporting Period",
        reportDateMode === "all"
          ? "All Time"
          : `${
              reportStartDate
                ? dateText(
                    reportStartDate,
                  )
                : "Beginning"
            } through ${
              reportEndDate
                ? dateText(
                    reportEndDate,
                  )
                : "Present"
            }`,
      );

      field(
        "Generated",
        new Date().toLocaleString(),
      );

      section(
        "EXECUTIVE SUMMARY",
      );

      field(
        "Personnel Records",
        personnel.length,
      );

      field(
        "Firearms",
        firearms.length,
      );

      field(
        "Duty Ammunition Lots",
        dutyLots.length,
      );

      field(
        "Training Ammunition Lots",
        trainingLots.length,
      );

      field(
        "Qualification Records",
        filteredQualifications.length,
      );

      field(
        "Training Records",
        filteredTraining.length,
      );

      field(
        "Range Days",
        filteredRangeDays.length,
      );

      field(
        "Certifications",
        filteredCertifications.length,
      );

      field(
        "Equipment Assets",
        filteredEquipment.length,
      );

      field(
        "Off-Duty Firearm Requests",
        filteredOffDuty.length,
      );

      field(
        "Audit Events",
        filteredAudit.length,
      );

      const failedSections =
        results.filter(
          (result) =>
            !result.ok,
        );

      if (
        failedSections.length
      ) {
        section(
          "DATA AVAILABILITY",
        );

        write(
          "The report was generated successfully, but the following sections could not be retrieved:",
        );

        for (
          const failed of
          failedSections
        ) {
          write(
            `${failed.name}: ${
              failed.error ??
              "Unavailable"
            }`,
            {
              indent: 10,
            },
          );
        }
      }

      section(
        "QUALIFICATION HISTORY",
      );

      if (
        !filteredQualifications.length
      ) {
        write(
          "No matching qualification records.",
        );
      }

      for (
        const result of
        filteredQualifications
      ) {
        const day =
          rangeDaysById.get(
            String(
              result.rangeDayId ??
                result.range_day_id ??
                "",
            ),
          );

        const drill =
          drillsById.get(
            String(
              result.drillId ??
                result.drill_id ??
                "",
            ),
          );

        const officer =
          personnelMap.get(
            String(
              result.officerId ??
                result.officer_id ??
                "",
            ),
          );

        itemHeading(
          `${dateText(
            day?.date,
          )} â€” ${
            officer?.name ??
            "Officer"
          }`,
        );

        field(
          "Course / Drill",
          drill?.name,
        );

        field(
          "Category",
          drill?.category,
        );

        field(
          "Score",
          result.score,
        );

        field(
          "Result",
          result.passed === true
            ? "Pass"
            : result.passed === false
              ? "Fail"
              : result.completed
                ? "Completed"
                : "Incomplete",
        );

        if (
          reportIncludeNotes &&
          result.notes
        ) {
          field(
            "Notes",
            result.notes,
          );
        }

        y -= 5;
      }

      section(
        "TRAINING RECORDS",
      );

      if (
        !filteredTraining.length
      ) {
        write(
          "No matching training records.",
        );
      }

      for (
        const result of
        filteredTraining
      ) {
        const day =
          rangeDaysById.get(
            String(
              result.rangeDayId ??
                result.range_day_id ??
                "",
            ),
          );

        const drill =
          drillsById.get(
            String(
              result.drillId ??
                result.drill_id ??
                "",
            ),
          );

        const officer =
          personnelMap.get(
            String(
              result.officerId ??
                result.officer_id ??
                "",
            ),
          );

        itemHeading(
          `${dateText(
            day?.date,
          )} â€” ${
            drill?.name ??
            "Training Activity"
          }`,
        );

        field(
          "Officer",
          officer?.name,
        );

        field(
          "Range Day",
          day?.title,
        );

        field(
          "Location",
          day?.location,
        );

        field(
          "Score",
          result.score,
        );

        field(
          "Completed",
          result.completed
            ? "Yes"
            : "No",
        );

        y -= 5;
      }

      section("RANGE DAYS");

      if (
        !filteredRangeDays.length
      ) {
        write(
          "No matching range days.",
        );
      }

      for (
        const day of
        filteredRangeDays
      ) {
        itemHeading(
          `${dateText(
            day.date,
          )} â€” ${clean(
            day.title,
          )}`,
        );

        field(
          "Status",
          day.status,
        );

        field(
          "Location",
          day.location,
        );

        if (
          reportIncludeNotes &&
          day.notes
        ) {
          field(
            "Notes",
            day.notes,
          );
        }

        y -= 5;
      }

      section(
        "CERTIFICATIONS",
      );

      if (
        !filteredCertifications.length
      ) {
        write(
          "No matching certification records.",
        );
      }

      for (
        const certification of
        filteredCertifications
      ) {
        const officer =
          personnelMap.get(
            String(
              certification.user_id ??
                certification.userId ??
                "",
            ),
          );

        itemHeading(
          `${officer?.name ?? "Officer"} â€” ${
            certification.certification_title ??
            certification.title ??
            "Certification"
          }`,
        );

        field(
          "Issuing Organization",
          certification.issuing_organization ??
            certification.issuingOrganization,
        );

        field(
          "Credential Number",
          certification.credential_number ??
            certification.credentialNumber,
        );

        field(
          "Issue Date",
          dateText(
            certification.issue_date ??
              certification.issueDate,
          ),
        );

        field(
          "Expiration Date",
          dateText(
            certification.expiration_date ??
              certification.expirationDate,
          ),
        );

        if (
          reportIncludeNotes &&
          certification.notes
        ) {
          field(
            "Notes",
            certification.notes,
          );
        }

        y -= 5;
      }

      section("EQUIPMENT");

      if (
        !filteredEquipment.length
      ) {
        write(
          "No matching equipment records.",
        );
      }

      for (
        const asset of
        filteredEquipment
      ) {
        const type =
          equipmentTypesById.get(
            String(
              asset.equipment_type_id ??
                asset.equipmentTypeId ??
                "",
            ),
          );

        const officer =
          personnelMap.get(
            String(
              asset.assigned_user_id ??
                asset.assignedUserId ??
                "",
            ),
          );

        itemHeading(
          `${type?.name ?? "Equipment"} â€” ${
            officer?.name ??
            "Unassigned"
          }`,
        );

        field(
          "Manufacturer / Model",
          [
            asset.manufacturer,
            asset.model,
          ]
            .filter(Boolean)
            .join(" "),
        );

        field(
          "Serial Number",
          asset.serial_number ??
            asset.serialNumber,
        );

        field(
          "Lifecycle Status",
          asset.lifecycle_status ??
            asset.lifecycleStatus,
        );

        field(
          "Issue Date",
          dateText(
            asset.issue_date ??
              asset.issueDate,
          ),
        );

        field(
          "Expiration Date",
          dateText(
            asset.expiration_date ??
              asset.expirationDate,
          ),
        );

        if (
          reportIncludeNotes &&
          asset.notes
        ) {
          field(
            "Notes",
            asset.notes,
          );
        }

        y -= 5;
      }

      section(
        "OFF-DUTY FIREARMS",
      );

      if (
        !filteredOffDuty.length
      ) {
        write(
          "No matching off-duty firearm requests.",
        );
      }

      for (
        const record of
        filteredOffDuty
      ) {
        itemHeading(
          `${record.officer ?? "Officer"} â€” ${
            record.make ?? ""
          } ${
            record.model ?? ""
          }`,
        );

        field(
          "Serial Number",
          record.serial,
        );

        field(
          "Caliber",
          record.caliber,
        );

        field(
          "Request Status",
          record.requestStatus,
        );

        field(
          "Authorization Status",
          record.authorizationStatus,
        );

        field(
          "Submitted",
          dateTimeText(
            record.submittedAt,
          ),
        );

        field(
          "Qualification Status",
          record.qualificationStatus,
        );

        field(
          "Inspection Status",
          record.inspectionStatus,
        );

        field(
          "Compliance",
          record.compliance,
        );

        if (
          reportIncludeNotes
        ) {
          field(
            "Officer Notes",
            record.officerNotes,
          );

          field(
            "Decision Notes",
            record.decisionNotes,
          );
        }

        if (
          reportIncludeWorkflow &&
          Array.isArray(
            record.auditTrail,
          )
        ) {
          for (
            const event of
            record.auditTrail
          ) {
            write(
              `${dateTimeText(
                event.timestamp,
              )} â€” ${
                event.action ??
                ""
              } â€” ${
                event.actor ??
                ""
              }`,
              {
                indent: 12,
                size: 7.5,
              },
            );
          }
        }

        y -= 6;
      }

      section(
        "FIREARMS INVENTORY",
      );

      if (!firearms.length) {
        write(
          "No firearm inventory records returned.",
        );
      }

      for (
        const firearm of
        firearms
      ) {
        itemHeading(
          `${
            firearm.make ??
            "Firearm"
          } ${
            firearm.model ??
            ""
          }`,
        );

        field(
          "Serial Number",
          firearm.serial_number ??
            firearm.serialNumber ??
            firearm.serial,
        );

        field(
          "Caliber",
          firearm.caliber,
        );

        field(
          "Status",
          firearm.status ??
            firearm.lifecycle_status,
        );

        y -= 4;
      }

      section("AMMUNITION");

      field(
        "Duty Lots",
        dutyLots.length,
      );

      field(
        "Training Lots",
        trainingLots.length,
      );

      section(
        "AUDIT HISTORY",
      );

      if (
        !filteredAudit.length
      ) {
        write(
          "No matching audit events.",
        );
      }

      for (
        const event of
        filteredAudit
      ) {
        itemHeading(
          `${dateTimeText(
            event.created_at ??
              event.createdAt,
          )} â€” ${clean(
            event.action,
          )}`,
        );

        field(
          "Entity Type",
          event.entity_type ??
            event.entityType,
        );

        field(
          "Entity ID",
          event.entity_id ??
            event.entityId,
        );

        field(
          "Changed By User ID",
          event.changed_by_user_id ??
            event.changedByUserId,
        );

        if (
          reportIncludeNotes &&
          (
            event.change_note ??
            event.changeNote
          )
        ) {
          field(
            "Change Note",
            event.change_note ??
              event.changeNote,
          );
        }

        y -= 4;
      }

      const pages =
        pdf.getPages();

      for (
        let index = 0;
        index <
        pages.length;
        index += 1
      ) {
        const footer =
          pages[index];

        footer.drawLine({
          start: {
            x: LEFT,
            y: 36,
          },
          end: {
            x:
              WIDTH -
              RIGHT,
            y: 36,
          },
          thickness: 0.5,
          color: border,
        });

        footer.drawText(
          "TracePoint â€” Operational Accountability. Verified.",
          {
            x: LEFT,
            y: 21,
            size: 7,
            font: regular,
            color: muted,
          },
        );

        const pageNumber =
          `Page ${
            index + 1
          } of ${
            pages.length
          }`;

        footer.drawText(
          pageNumber,
          {
            x:
              WIDTH -
              RIGHT -
              regular.widthOfTextAtSize(
                pageNumber,
                7,
              ),
            y: 21,
            size: 7,
            font: regular,
            color: muted,
          },
        );
      }

      const pdfBytes =
        await pdf.save();

      const blob =
        new Blob(
          [
            new Uint8Array(
              pdfBytes,
            ),
          ],
          {
            type: "application/pdf",
          },
        );

      const url =
        URL.createObjectURL(
          blob,
        );

      const anchor =
        document.createElement(
          "a",
        );

      anchor.href = url;
      anchor.download =
        `tracepoint-complete-report-${exportDate()}.pdf`;

      document.body.appendChild(
        anchor,
      );

      anchor.click();

      document.body.removeChild(
        anchor,
      );

      window.setTimeout(
        () =>
          URL.revokeObjectURL(
            url,
          ),
        1000,
      );
    } catch (error) {
      console.error(
        "Complete TracePoint Report failed:",
        error,
      );

      setExportError(
        error instanceof Error
          ? error.message
          : "The Complete TracePoint Report could not be generated.",
      );
    } finally {
      setReportGenerating(false);
    }
  }

  async function handleGenerateReport() {
    setExportError(null);

    try {
      if (reportType === "complete") {
        await handleGenerateCompleteReport();
        return;
      }

      if (reportType === "off-duty-firearms") {
        await handleGenerateOffDutyReport();
        return;
      }

      setExportError(
        "The selected report type is not yet connected to the report engine.",
      );
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "The TracePoint report could not be generated.",
      );
    }
  }
  async function handleGenerateOffDutyReport() {
    setReportGenerating(true);
    setExportError(null);

    try {
      const payload = await fetchJson<{
        records?: Array<{
          id: string;
          officerId: string;
          officer: string;
          badge: string;
          unit: string;

          make: string;
          model: string;
          firearmType: string;
          serial: string;
          caliber: string;
          capacity: string;
          optic: string;
          weaponLight: string;
          holster: string;

          proofOwnership: boolean;
          qualificationReviewed: boolean;
          inspectionReviewed: boolean;
          policyAcknowledged: boolean;

          officerNotes: string;

          requestStatus:
            | "Draft"
            | "Pending Command Review"
            | "Returned for Correction"
            | "Approved"
            | "Denied"
            | "Withdrawn";

          authorizationStatus:
            | "Not Authorized"
            | "Authorized"
            | "Expiring Soon"
            | "Expired"
            | "Revoked";

          submittedAt: string;
          reviewedAt?: string;
          reviewedBy?: string;
          approvalDate?: string;
          approvalExpires?: string;
          decisionNotes?: string;

          qualificationStatus: string;
          qualificationReason: string;

          inspectionStatus:
            | "Not Inspected"
            | "Current"
            | "Due Soon"
            | "Overdue";

          compliance:
            | "Authorized"
            | "At Risk"
            | "Non-Compliant";

          auditTrail?: Array<{
            id: string;
            action:
              | "Submitted"
              | "Resubmitted"
              | "Approved"
              | "Denied"
              | "Returned for Correction"
              | "Revoked";
            actor: string;
            actorRole: string;
            timestamp: string;
            notes?: string;
          }>;
        }>;
      }>("/api/off-duty-firearms");

      let records = payload.records ?? [];

      if (reportOfficerId !== "all") {
        records = records.filter(
          (record) => record.officerId === reportOfficerId,
        );
      }

      if (reportStatus !== "all") {
        records = records.filter(
          (record) => record.requestStatus === reportStatus,
        );
      }

      if (reportDateMode === "custom") {
        if (reportStartDate) {
          const start = new Date(
            `${reportStartDate}T00:00:00`,
          ).getTime();

          records = records.filter((record) => {
            const submitted = new Date(
              record.submittedAt,
            ).getTime();

            return (
              Number.isFinite(submitted) &&
              submitted >= start
            );
          });
        }

        if (reportEndDate) {
          const end = new Date(
            `${reportEndDate}T23:59:59.999`,
          ).getTime();

          records = records.filter((record) => {
            const submitted = new Date(
              record.submittedAt,
            ).getTime();

            return (
              Number.isFinite(submitted) &&
              submitted <= end
            );
          });
        }
      }

      records = [...records].sort((a, b) =>
        String(a.submittedAt).localeCompare(
          String(b.submittedAt),
        ),
      );

      if (records.length === 0) {
        throw new Error(
          "No off-duty firearm records match the selected report filters.",
        );
      }

      const inspectionResults = new Map<
        string,
        Array<{
          id: string;
          inspectionDate: string;
          result: "Pass" | "Fail";
          notes?: string;
          inspectedBy: string;
          inspectedByUserId: string;
          createdAt: string;
        }>
      >();

      if (reportIncludeInspections) {
        const inspectionPayloads = await Promise.all(
          records.map(async (record) => {
            try {
              const result = await fetchJson<{
                inspections?: Array<{
                  id: string;
                  inspectionDate: string;
                  result: "Pass" | "Fail";
                  notes?: string;
                  inspectedBy: string;
                  inspectedByUserId: string;
                  createdAt: string;
                }>;
              }>(
                `/api/off-duty-firearms/${record.id}/inspections`,
              );

              return [
                record.id,
                result.inspections ?? [],
              ] as const;
            } catch {
              return [record.id, []] as const;
            }
          }),
        );

        for (const [requestId, inspections] of inspectionPayloads) {
          inspectionResults.set(requestId, [...inspections]);
        }
      }

      const {
        PDFDocument,
        StandardFonts,
        rgb,
      } = await import("pdf-lib");

      const pdf = await PDFDocument.create();

      const regularFont = await pdf.embedFont(
        StandardFonts.Helvetica,
      );

      const boldFont = await pdf.embedFont(
        StandardFonts.HelveticaBold,
      );

      let logo:
        | Awaited<ReturnType<typeof pdf.embedPng>>
        | null = null;

      try {
        const logoResponse = await fetch(
          "/tracepoint-logo-dark.png",
        );

        if (logoResponse.ok) {
          const logoBytes =
            await logoResponse.arrayBuffer();

          logo = await pdf.embedPng(logoBytes);
        }
      } catch {
        logo = null;
      }

      const PAGE_WIDTH = 612;
      const PAGE_HEIGHT = 792;
      const MARGIN_X = 48;
      const TOP_Y = 735;
      const BOTTOM_Y = 52;

      const textColor = rgb(
        15 / 255,
        23 / 255,
        42 / 255,
      );

      const mutedColor = rgb(
        71 / 255,
        85 / 255,
        105 / 255,
      );

      const lineColor = rgb(
        203 / 255,
        213 / 255,
        225 / 255,
      );

      let page = pdf.addPage([
        PAGE_WIDTH,
        PAGE_HEIGHT,
      ]);

      let y = TOP_Y;

      function clean(value: unknown) {
        if (
          value === null ||
          value === undefined ||
          value === ""
        ) {
          return "â€”";
        }

        return String(value);
      }

      function formatDateTime(value?: string) {
        if (!value) {
          return "â€”";
        }

        const parsed = new Date(value);

        if (Number.isNaN(parsed.getTime())) {
          return value;
        }

        return parsed.toLocaleString();
      }

      function formatDate(value?: string) {
        if (!value) {
          return "â€”";
        }

        const parsed = new Date(
          value.length === 10
            ? `${value}T00:00:00`
            : value,
        );

        if (Number.isNaN(parsed.getTime())) {
          return value;
        }

        return parsed.toLocaleDateString();
      }

      function wrapText(
        value: unknown,
        maxWidth: number,
        fontSize: number,
        font = regularFont,
      ) {
        const words = clean(value).split(/\s+/);
        const lines: string[] = [];

        let current = "";

        for (const word of words) {
          const candidate = current
            ? `${current} ${word}`
            : word;

          if (
            font.widthOfTextAtSize(
              candidate,
              fontSize,
            ) <= maxWidth
          ) {
            current = candidate;
          } else {
            if (current) {
              lines.push(current);
            }

            current = word;
          }
        }

        if (current) {
          lines.push(current);
        }

        return lines.length > 0
          ? lines
          : [""];
      }

      function drawPageHeader() {
        if (logo) {
          const dimensions = logo.scale(0.12);

          const maxWidth = 125;
          const ratio =
            dimensions.width > maxWidth
              ? maxWidth / dimensions.width
              : 1;

          page.drawImage(logo, {
            x: MARGIN_X,
            y: 716,
            width: dimensions.width * ratio,
            height: dimensions.height * ratio,
          });
        } else {
          page.drawText("TRACEPOINT", {
            x: MARGIN_X,
            y: 735,
            size: 17,
            font: boldFont,
            color: textColor,
          });
        }

        page.drawText(
          "OFF-DUTY FIREARMS REPORT",
          {
            x: MARGIN_X,
            y: 690,
            size: 16,
            font: boldFont,
            color: textColor,
          },
        );

        page.drawLine({
          start: {
            x: MARGIN_X,
            y: 678,
          },
          end: {
            x: PAGE_WIDTH - MARGIN_X,
            y: 678,
          },
          thickness: 1,
          color: lineColor,
        });

        y = 660;
      }

      function newPage() {
        page = pdf.addPage([
          PAGE_WIDTH,
          PAGE_HEIGHT,
        ]);

        drawPageHeader();
      }

      function ensureSpace(required: number) {
        if (y - required < BOTTOM_Y) {
          newPage();
        }
      }

      function drawTextLine(
        value: string,
        options?: {
          bold?: boolean;
          size?: number;
          indent?: number;
          color?: typeof textColor;
        },
      ) {
        const fontSize = options?.size ?? 9;
        const indent = options?.indent ?? 0;

        ensureSpace(fontSize + 7);

        page.drawText(value, {
          x: MARGIN_X + indent,
          y,
          size: fontSize,
          font: options?.bold
            ? boldFont
            : regularFont,
          color: options?.color ?? textColor,
        });

        y -= fontSize + 5;
      }

      function drawWrapped(
        value: unknown,
        options?: {
          label?: string;
          bold?: boolean;
          size?: number;
          indent?: number;
        },
      ) {
        const fontSize = options?.size ?? 9;
        const indent = options?.indent ?? 0;
        const available =
          PAGE_WIDTH -
          MARGIN_X * 2 -
          indent;

        const prefix = options?.label
          ? `${options.label}: `
          : "";

        const lines = wrapText(
          `${prefix}${clean(value)}`,
          available,
          fontSize,
          options?.bold
            ? boldFont
            : regularFont,
        );

        ensureSpace(
          lines.length * (fontSize + 4) + 3,
        );

        for (const line of lines) {
          page.drawText(line, {
            x: MARGIN_X + indent,
            y,
            size: fontSize,
            font: options?.bold
              ? boldFont
              : regularFont,
            color: textColor,
          });

          y -= fontSize + 4;
        }
      }

      function sectionHeading(title: string) {
        ensureSpace(28);

        y -= 4;

        page.drawText(title, {
          x: MARGIN_X,
          y,
          size: 10,
          font: boldFont,
          color: textColor,
        });

        y -= 6;

        page.drawLine({
          start: {
            x: MARGIN_X,
            y,
          },
          end: {
            x: PAGE_WIDTH - MARGIN_X,
            y,
          },
          thickness: 0.6,
          color: lineColor,
        });

        y -= 14;
      }

      function labelValue(
        label: string,
        value: unknown,
      ) {
        drawWrapped(value, {
          label,
          size: 9,
        });
      }

      drawPageHeader();

      const selectedOfficer =
        reportOfficerId === "all"
          ? "All Officers"
          : reportOfficerOptions.find(
              (officer) =>
                officer.id === reportOfficerId,
            )?.name ?? "Selected Officer";

      const reportingPeriod =
        reportDateMode === "all"
          ? "All Time"
          : `${
              reportStartDate
                ? formatDate(reportStartDate)
                : "Beginning"
            } through ${
              reportEndDate
                ? formatDate(reportEndDate)
                : "Present"
            }`;

      drawTextLine(
        "REPORT INFORMATION",
        {
          bold: true,
          size: 10,
        },
      );

      labelValue(
        "Officer",
        selectedOfficer,
      );

      labelValue(
        "Reporting Period",
        reportingPeriod,
      );

      labelValue(
        "Request Status",
        reportStatus === "all"
          ? "All Statuses"
          : reportStatus,
      );

      labelValue(
        "Generated",
        new Date().toLocaleString(),
      );

      y -= 8;

      sectionHeading("SUMMARY");

      const approved = records.filter(
        (record) =>
          record.requestStatus === "Approved",
      ).length;

      const pending = records.filter(
        (record) =>
          record.requestStatus ===
          "Pending Command Review",
      ).length;

      const denied = records.filter(
        (record) =>
          record.requestStatus === "Denied",
      ).length;

      const returned = records.filter(
        (record) =>
          record.requestStatus ===
          "Returned for Correction",
      ).length;

      const authorized = records.filter(
        (record) =>
          record.authorizationStatus ===
          "Authorized",
      ).length;

      labelValue(
        "Matching Requests",
        records.length,
      );

      labelValue("Approved", approved);
      labelValue("Pending", pending);
      labelValue("Denied", denied);
      labelValue(
        "Returned for Correction",
        returned,
      );
      labelValue(
        "Currently Authorized",
        authorized,
      );

      y -= 8;

      for (
        let recordIndex = 0;
        recordIndex < records.length;
        recordIndex += 1
      ) {
        const record = records[recordIndex];

        ensureSpace(120);

        sectionHeading(
          `REQUEST ${recordIndex + 1} OF ${records.length}`,
        );

        drawTextLine(
          `${record.officer} â€” ${record.make} ${record.model}`,
          {
            bold: true,
            size: 11,
          },
        );

        labelValue(
          "Request ID",
          record.id,
        );

        labelValue(
          "Badge",
          record.badge,
        );

        labelValue(
          "Unit",
          record.unit,
        );

        labelValue(
          "Submitted",
          formatDateTime(record.submittedAt),
        );

        labelValue(
          "Request Status",
          record.requestStatus,
        );

        labelValue(
          "Authorization Status",
          record.authorizationStatus,
        );

        labelValue(
          "Compliance Status",
          record.compliance,
        );

        sectionHeading("FIREARM DETAILS");

        labelValue(
          "Make / Model",
          `${record.make} ${record.model}`,
        );

        labelValue(
          "Firearm Type",
          record.firearmType,
        );

        labelValue(
          "Serial Number",
          record.serial,
        );

        labelValue(
          "Caliber",
          record.caliber,
        );

        labelValue(
          "Capacity",
          record.capacity,
        );

        labelValue(
          "Optic",
          record.optic,
        );

        labelValue(
          "Weapon Light",
          record.weaponLight,
        );

        labelValue(
          "Holster",
          record.holster,
        );

        sectionHeading("COMPLIANCE REVIEW");

        labelValue(
          "Proof of Ownership",
          record.proofOwnership
            ? "Acknowledged"
            : "Not Acknowledged",
        );

        labelValue(
          "Qualification Requirement Reviewed",
          record.qualificationReviewed
            ? "Yes"
            : "No",
        );

        labelValue(
          "Inspection Requirement Reviewed",
          record.inspectionReviewed
            ? "Yes"
            : "No",
        );

        labelValue(
          "Policy Acknowledged",
          record.policyAcknowledged
            ? "Yes"
            : "No",
        );

        labelValue(
          "Qualification Status",
          record.qualificationStatus,
        );

        labelValue(
          "Qualification Detail",
          record.qualificationReason,
        );

        labelValue(
          "Inspection Status",
          record.inspectionStatus,
        );

        sectionHeading("COMMAND REVIEW");

        labelValue(
          "Reviewed By",
          record.reviewedBy,
        );

        labelValue(
          "Reviewed",
          record.reviewedAt
            ? formatDateTime(record.reviewedAt)
            : "â€”",
        );

        labelValue(
          "Authorization Effective",
          record.approvalDate
            ? formatDate(record.approvalDate)
            : "â€”",
        );

        labelValue(
          "Authorization Expires",
          record.approvalExpires
            ? formatDate(record.approvalExpires)
            : "â€”",
        );

        if (reportIncludeNotes) {
          labelValue(
            "Decision Notes",
            record.decisionNotes,
          );

          labelValue(
            "Officer Notes",
            record.officerNotes,
          );
        }

        if (
          reportIncludeWorkflow &&
          (record.auditTrail?.length ?? 0) > 0
        ) {
          sectionHeading("WORKFLOW HISTORY");

          for (const event of record.auditTrail ?? []) {
            drawTextLine(
              `${formatDateTime(event.timestamp)} â€” ${event.action}`,
              {
                bold: true,
                size: 8,
              },
            );

            drawWrapped(
              `${event.actor} (${event.actorRole})`,
              {
                size: 8,
                indent: 10,
              },
            );

            if (
              reportIncludeNotes &&
              event.notes
            ) {
              drawWrapped(event.notes, {
                size: 8,
                indent: 10,
              });
            }

            y -= 3;
          }
        }

        if (reportIncludeInspections) {
          const inspections =
            inspectionResults.get(record.id) ??
            [];

          sectionHeading("INSPECTION HISTORY");

          if (inspections.length === 0) {
            drawTextLine(
              "No inspections recorded.",
              {
                size: 8,
                color: mutedColor,
              },
            );
          } else {
            for (const inspection of inspections) {
              drawTextLine(
                `${formatDate(inspection.inspectionDate)} â€” ${inspection.result}`,
                {
                  bold: true,
                  size: 8,
                },
              );

              drawWrapped(
                `Inspector: ${inspection.inspectedBy}`,
                {
                  size: 8,
                  indent: 10,
                },
              );

              drawWrapped(
                `Recorded: ${formatDateTime(inspection.createdAt)}`,
                {
                  size: 8,
                  indent: 10,
                },
              );

              if (
                reportIncludeNotes &&
                inspection.notes
              ) {
                drawWrapped(
                  inspection.notes,
                  {
                    size: 8,
                    indent: 10,
                  },
                );
              }

              y -= 3;
            }
          }
        }

        y -= 12;
      }

      const pages = pdf.getPages();
      const generatedAt =
        new Date().toLocaleString();

      for (
        let index = 0;
        index < pages.length;
        index += 1
      ) {
        const footerPage = pages[index];

        footerPage.drawLine({
          start: {
            x: MARGIN_X,
            y: 36,
          },
          end: {
            x: PAGE_WIDTH - MARGIN_X,
            y: 36,
          },
          thickness: 0.5,
          color: lineColor,
        });

        footerPage.drawText(
          "TracePoint â€” Operational Accountability. Verified.",
          {
            x: MARGIN_X,
            y: 22,
            size: 7,
            font: regularFont,
            color: mutedColor,
          },
        );

        const pageLabel =
          `Page ${index + 1} of ${pages.length}`;

        const pageLabelWidth =
          regularFont.widthOfTextAtSize(
            pageLabel,
            7,
          );

        footerPage.drawText(
          pageLabel,
          {
            x:
              PAGE_WIDTH -
              MARGIN_X -
              pageLabelWidth,
            y: 22,
            size: 7,
            font: regularFont,
            color: mutedColor,
          },
        );

        footerPage.drawText(
          generatedAt,
          {
            x: MARGIN_X,
            y: 11,
            size: 6,
            font: regularFont,
            color: mutedColor,
          },
        );
      }

      const bytes = await pdf.save();

      const blob = new Blob(
        [new Uint8Array(bytes)],
        {
          type: "application/pdf",
        },
      );

      const url = URL.createObjectURL(blob);

      const link =
        document.createElement("a");

      link.href = url;

      link.download =
        `tracepoint-off-duty-firearms-report-${exportDate()}.pdf`;

      document.body.appendChild(link);

      link.click();
      link.remove();

      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "The TracePoint report could not be generated.",
      );
    } finally {
      setReportGenerating(false);
    }
  }
  function handleDownloadFirearmsTemplate() {
    downloadTemplate("tracepoint-firearms-template.csv", [
      "make",
      "model",
      "serialNumber",
      "firearmType",
      "caliber",
      "assetNumber",
      "conditionStatus",
      "assignedOfficerName",
      "notes",
    ]);
  }

  function handleDownloadPersonnelTemplate() {
    downloadTemplate("tracepoint-personnel-template.csv", [
      "firstName",
      "lastName",
      "rankTitle",
      "badgeNumber",
      "email",
      "unitName",
      "active",
    ]);
  }

  function handleDownloadQualificationTemplate() {
    downloadTemplate("tracepoint-qualification-history-template.csv", [
      "officerName",
      "badgeNumber",
      "qualificationDate",
      "courseName",
      "score",
      "passingScore",
      "result",
      "instructor",
      "notes",
    ]);
  }


  const steps: { id: ImportStep; label: string }[] = [
    { id: "type", label: "Type" },
    { id: "upload", label: "Upload" },
    { id: "mapping", label: "Mapping" },
    { id: "preview", label: "Preview" },
    { id: "report", label: "Report" },
  ];

  return (
    <TracePointShell activePage="Settings" accessEnabled={!platformDepartmentId}>
      <div className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-6 lg:p-8">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
          <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-6 shadow-sm">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">
                  Settings / Import & Export
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">
                  Import Wizard
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                  Upload CSV exports, map agency fields to TracePoint fields,
                  preview validation issues, and import supported records. Firearms
                  can import now; personnel and qualification history are staged
                  for preview/validation until their normalized import targets
                  are finalized.
                </p>
              </div>

              <button
                type="button"
                onClick={resetWizard}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
              >
                <RefreshCcw className="h-4 w-4" />
                Reset Wizard
              </button>
            </div>

            <div className="mt-6 grid gap-2 sm:grid-cols-5">
              {steps.map((item, index) => {
                const active = item.id === step;

                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border px-3 py-2 text-sm font-bold ${
                      active
                        ? "border-sky-600 bg-sky-950/50 text-sky-200"
                        : "border-slate-800 bg-slate-950/70 text-slate-400"
                    }`}
                  >
                    <span className="mr-2 text-xs">{index + 1}</span>
                    {item.label}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
            <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-6">
              <div className="flex items-center gap-3">
                <div>
                  
            <div className="mb-8 rounded-2xl border border-slate-700 bg-slate-950 p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
                    TracePoint Report Builder
                  </p>
                  <h2 className="mt-1 text-lg font-bold text-white">
                    Branded Reports
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
                    Generate presentation-ready TracePoint reports using department records and selected reporting criteria.
                  </p>
                </div>


              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Report Type
                  </span>
                  <select
                    value={reportType}
                    onChange={(event) =>
                      setReportType(event.target.value)
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  >
                    <option value="complete">
                      Complete TracePoint Report
                    </option>

                    <option value="off-duty-firearms">
                      Off-Duty Firearms
                    </option>

                    <option value="qualifications">
                      Qualification History
                    </option>

                    <option value="training-records">
                      Training Records
                    </option>

                    <option value="equipment">
                      Equipment
                    </option>

                    <option value="certifications">
                      Certifications
                    </option>

                    <option value="officer-history">
                      Officer Historical Report
                    </option>

                    <option value="range-days">
                      Range Day Report
                    </option>

                    <option value="audit-history">
                      Audit History
                    </option>
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Officer
                  </span>
                  <select
                    value={reportOfficerId}
                    onChange={(event) =>
                      setReportOfficerId(event.target.value)
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  >
                    <option value="all">
                      All Officers
                    </option>

                    {reportOfficerOptions.map((officer) => (
                      <option
                        key={officer.id}
                        value={officer.id}
                      >
                        {officer.name}
                        {officer.badge
                          ? ` â€” ${officer.badge}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Date Range
                  </span>
                  <select
                    value={reportDateMode}
                    onChange={(event) =>
                      setReportDateMode(
                        event.target.value as
                          | "all"
                          | "custom",
                      )
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  >
                    <option value="all">
                      All Time
                    </option>
                    <option value="custom">
                      Custom Range
                    </option>
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Request Status
                  </span>
                  <select
                    value={reportStatus}
                    onChange={(event) =>
                      setReportStatus(event.target.value)
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  >
                    <option value="all">
                      All Statuses
                    </option>
                    <option value="Draft">
                      Draft
                    </option>
                    <option value="Pending Command Review">
                      Pending Command Review
                    </option>
                    <option value="Returned for Correction">
                      Returned for Correction
                    </option>
                    <option value="Approved">
                      Approved
                    </option>
                    <option value="Denied">
                      Denied
                    </option>
                    <option value="Withdrawn">
                      Withdrawn
                    </option>
                  </select>
                </label>
              </div>

              {reportDateMode === "custom" && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      From
                    </span>
                    <input
                      type="date"
                      value={reportStartDate}
                      onChange={(event) =>
                        setReportStartDate(
                          event.target.value,
                        )
                      }
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      Through
                    </span>
                    <input
                      type="date"
                      value={reportEndDate}
                      onChange={(event) =>
                        setReportEndDate(
                          event.target.value,
                        )
                      }
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                    />
                  </label>
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={reportIncludeWorkflow}
                    onChange={(event) =>
                      setReportIncludeWorkflow(
                        event.target.checked,
                      )
                    }
                  />
                  Workflow history
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={reportIncludeInspections}
                    onChange={(event) =>
                      setReportIncludeInspections(
                        event.target.checked,
                      )
                    }
                  />
                  Inspection history
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={reportIncludeNotes}
                    onChange={(event) =>
                      setReportIncludeNotes(
                        event.target.checked,
                      )
                    }
                  />
                  Notes
                </label>
              </div>

              <div className="mt-5">
                <button
                  type="button"
                  onClick={() =>
                    void handleGenerateReport()
                  }
                  disabled={reportGenerating}
                  className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {reportGenerating
                    ? "Generating Report..."
                    : "Generate Report"}
                </button>

                {exportError ? (
                  <div className="mt-3 rounded-xl border border-red-800 bg-red-950/40 px-3 py-2 text-sm font-medium text-red-200">
                    {exportError}
                  </div>
                ) : null}
              </div>
            </div>
<h2 className="text-xl font-bold text-white">Export Center</h2>
                  <p className="mt-1 text-sm text-slate-300">
                    Download current TracePoint data as CSV files.
                  </p>
                </div>
              </div>

              {exportError ? (
                <div className="mt-4 rounded-2xl border border-red-800 bg-red-950/40 p-3 text-sm font-medium text-red-200">
                  {exportError}
                </div>
              ) : null}

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <button
                  type="button"
                  onClick={() => void handleExportPersonnel()}
                  disabled={exporting !== null}
                  className="rounded-2xl border border-slate-700 bg-slate-950 p-4 text-left transition hover:border-emerald-500 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="text-sm font-bold text-white">Personnel</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Export active department personnel records.
                  </p>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
                    {exporting === "personnel" ? "Exporting..." : "Download CSV"}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => void handleExportFirearms()}
                  disabled={exporting !== null}
                  className="rounded-2xl border border-slate-700 bg-slate-950 p-4 text-left transition hover:border-emerald-500 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="text-sm font-bold text-white">Firearms</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Export live Armory inventory and assignment status.
                  </p>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
                    {exporting === "firearms" ? "Exporting..." : "Download CSV"}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => void handleExportAmmunition()}
                  disabled={exporting !== null}
                  className="rounded-2xl border border-slate-700 bg-slate-950 p-4 text-left transition hover:border-emerald-500 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="text-sm font-bold text-white">Ammunition</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Export duty and training ammunition lots.
                  </p>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
                    {exporting === "ammunition" ? "Exporting..." : "Download CSV"}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportQualifications()}
                  disabled={exporting !== null}
                  className="rounded-2xl border border-slate-700 bg-slate-950 p-4 text-left transition hover:border-emerald-500 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="text-sm font-bold text-white">
                    Qualifications
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Export saved qualification history from Range Day results.
                  </p>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
                    {exporting === "qualifications"
                      ? "Exporting..."
                      : "Download CSV"}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportTrainingRecords()}
                  disabled={exporting !== null}
                  className="rounded-2xl border border-slate-700 bg-slate-950 p-4 text-left transition hover:border-emerald-500 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="text-sm font-bold text-white">
                    Training Records
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Export all saved officer training activity and results.
                  </p>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
                    {exporting === "training-records"
                      ? "Exporting..."
                      : "Download CSV"}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportRangeDays()}
                  disabled={exporting !== null}
                  className="rounded-2xl border border-slate-700 bg-slate-950 p-4 text-left transition hover:border-emerald-500 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="text-sm font-bold text-white">
                    Range Days
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Export Range Day events, participation, drills, and result totals.
                  </p>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
                    {exporting === "range-days"
                      ? "Exporting..."
                      : "Download CSV"}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportCertifications()}
                  disabled={exporting !== null}
                  className="rounded-2xl border border-slate-700 bg-slate-950 p-4 text-left transition hover:border-emerald-500 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="text-sm font-bold text-white">
                    Certifications
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Export officer credentials, expiration data, and certification requirements.
                  </p>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
                    {exporting === "certifications"
                      ? "Exporting..."
                      : "Download CSV"}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportEquipment()}
                  disabled={exporting !== null}
                  className="rounded-2xl border border-slate-700 bg-slate-950 p-4 text-left transition hover:border-emerald-500 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="text-sm font-bold text-white">
                    Equipment
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Export equipment assets, assignments, lifecycle status, expirations, inspections, and requirements.
                  </p>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
                    {exporting === "equipment"
                      ? "Exporting..."
                      : "Download CSV"}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportOffDutyFirearms()}
                  disabled={exporting !== null}
                  className="rounded-2xl border border-slate-700 bg-slate-950 p-4 text-left transition hover:border-emerald-500 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="text-sm font-bold text-white">
                    Off-Duty Firearms
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Export off-duty firearm requests, authorization status, compliance data, and workflow history.
                  </p>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
                    {exporting === "off-duty-firearms"
                      ? "Exporting..."
                      : "Download CSV"}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportCompleteAuditHistory()}
                  disabled={exporting !== null}
                  className="rounded-2xl border border-slate-700 bg-slate-950 p-4 text-left transition hover:border-emerald-500 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="text-sm font-bold text-white">
                    Complete Audit History
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Export the complete retained department audit history, including entity references and before/after change data.
                  </p>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
                    {exporting === "complete-audit-history"
                      ? "Exporting..."
                      : "Download CSV"}
                  </p>
                </button>
              </div>
            </div>

            <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-6">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="h-6 w-6 text-sky-300" />
                <div>
                  <h2 className="text-xl font-bold text-white">
                    Download Templates
                  </h2>
                  <p className="mt-1 text-sm text-slate-300">
                    Blank CSV templates for clean agency import prep.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3">
                <button
                  type="button"
                  onClick={handleDownloadFirearmsTemplate}
                  className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-left text-sm font-semibold text-slate-200 transition hover:border-sky-500 hover:bg-slate-900"
                >
                  Firearms Template
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPersonnelTemplate}
                  className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-left text-sm font-semibold text-slate-200 transition hover:border-sky-500 hover:bg-slate-900"
                >
                  Personnel Template
                </button>
                <button
                  type="button"
                  onClick={handleDownloadQualificationTemplate}
                  className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-left text-sm font-semibold text-slate-200 transition hover:border-sky-500 hover:bg-slate-900"
                >
                  Qualification History Template
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-sky-900/70 bg-sky-950/20 p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <Upload className="h-7 w-7 text-sky-300" />
                  <h2 className="text-xl font-bold text-white">
                    Agency Onboarding
                  </h2>
                </div>

                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                  Upload a TracePoint onboarding workbook or an existing structured
                  agency CSV/Excel file. TracePoint will identify the datasets,
                  inspect the columns, and prepare them for supervised mapping.
                </p>
              </div>

              <span className="rounded-full border border-sky-700 bg-sky-950/60 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-sky-200">
                Multi-Dataset Import
              </span>
            </div>

            <label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-[2rem] border border-dashed border-sky-800 bg-slate-950/60 p-8 text-center transition hover:border-sky-500">
              {onboardingLoading ? (
                <Loader2 className="h-10 w-10 animate-spin text-sky-300" />
              ) : (
                <FileSpreadsheet className="h-10 w-10 text-sky-300" />
              )}

              <span className="mt-3 text-lg font-bold text-white">
                {onboardingLoading
                  ? "Reading agency data..."
                  : "Choose onboarding workbook or data file"}
              </span>

              <span className="mt-1 text-sm text-slate-400">
                CSV, XLSX, and XLS are supported.
              </span>

              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={handleOnboardingFile}
                disabled={onboardingLoading}
                className="hidden"
              />
            </label>

            {onboardingError ? (
              <div className="mt-4 rounded-2xl border border-red-800 bg-red-950/40 p-3 text-sm font-medium text-red-200">
                {onboardingError}
              </div>
            ) : null}

            {onboardingDatasets.length > 0 ? (
              <div className="mt-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-white">
                      {onboardingFileName}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {onboardingDatasets.length} dataset
                      {onboardingDatasets.length === 1 ? "" : "s"} detected.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setOnboardingFileName("");
                      setOnboardingDatasets([]);
                      setOnboardingError(null);
                    }}
                    className="text-sm font-semibold text-slate-400 transition hover:text-white"
                  >
                    Clear file
                  </button>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                  {onboardingDatasets.map((dataset) => {
                    const definition =
                      dataset.detectedType === "personnel" ||
                      dataset.detectedType === "firearms" ||
                      dataset.detectedType === "off_duty_firearms" ||
                      dataset.detectedType === "qualification_history"
                        ? IMPORT_TYPES.find(
                            (type) => type.id === dataset.detectedType,
                          )
                        : null;

                    const detectedLabel =
                      definition?.label ??
                      (dataset.detectedType === "certifications"
                        ? "Certifications"
                        : dataset.detectedType === "equipment"
                          ? "Equipment"
                          : dataset.detectedType === "equipment_requirements"
                            ? "Equipment Requirements"
                            : "Needs Review");

                    return (
                      <div
                        key={dataset.id}
                        className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-bold text-white">
                              {dataset.sourceSheet}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">
                              {dataset.parsed.rows.length} row
                              {dataset.parsed.rows.length === 1 ? "" : "s"}
                            </p>
                          </div>

                          {dataset.detectedType === "unknown" ? (
                            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-300" />
                          ) : (
                            <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-300" />
                          )}
                        </div>

                        <div className="mt-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                            Detected As
                          </p>
                          <p
                            className={`mt-1 text-sm font-bold ${
                              dataset.detectedType === "unknown"
                                ? "text-amber-200"
                                : "text-sky-200"
                            }`}
                          >
                            {detectedLabel}
                          </p>
                        </div>

                        <div className="mt-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                            Columns
                          </p>
                          <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-400">
                            {dataset.parsed.headers.join(" â€¢ ")}
                          </p>
                        </div>

                        {definition ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTypeId(definition.id);
                              setFileName(
                                dataset.sourceSheet ||
                                  dataset.sourceFile,
                              );
                              setParsedCsv(dataset.parsed);
                              setMapping(
                                buildAutoMapping(
                                  dataset.parsed.headers,
                                  definition,
                                ),
                              );
                              setReport(null);
                              setStep("mapping");
                            }}
                            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-sky-800 bg-sky-950/50 px-3 py-2 text-xs font-bold text-sky-100 transition hover:border-sky-500"
                          >
                            Review Mapping
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <p className="mt-5 text-xs font-medium text-slate-500">
                            Mapping support will be added for this dataset.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>
          {step === "type" && (
            <section className="grid gap-4 lg:grid-cols-3">
              {IMPORT_TYPES.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => {
                    setSelectedTypeId(type.id);
                    setStep("upload");
                  }}
                  className={`rounded-[2rem] border p-5 text-left transition hover:border-sky-500 ${
                    selectedTypeId === type.id
                      ? "border-sky-600 bg-sky-950/40"
                      : "border-slate-800 bg-slate-900/90"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <FileSpreadsheet className="h-7 w-7 text-sky-300" />
                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-bold ${
                        type.supportStatus === "Can Import"
                          ? "border-emerald-700 bg-emerald-950/50 text-emerald-200"
                          : "border-amber-700 bg-amber-950/50 text-amber-200"
                      }`}
                    >
                      {type.supportStatus}
                    </span>
                  </div>
                  <h2 className="mt-4 text-xl font-bold text-white">{type.label}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {type.description}
                  </p>
                </button>
              ))}
            </section>
          )}

          {step === "upload" && (
            <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-6">
              <h2 className="text-xl font-bold text-white">
                Upload {selectedDefinition.label} CSV
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                CSV import is currently supported. Excel support can
                be added after we lock the field mappings.
              </p>

              <label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-[2rem] border border-dashed border-slate-700 bg-slate-950/70 p-10 text-center transition hover:border-sky-500">
                <Upload className="h-10 w-10 text-sky-300" />
                <span className="mt-3 text-lg font-bold text-white">
                  Choose CSV file
                </span>
                <span className="mt-1 text-sm text-slate-400">
                  The wizard will auto-detect likely field mappings.
                </span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFile}
                  className="hidden"
                />
              </label>

              <div className="mt-6 flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep("type")}
                  className="rounded-2xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                >
                  Back
                </button>
              </div>
            </section>
          )}

          {step === "mapping" && (
            <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-6">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">Field Mapping</h2>
                  <p className="mt-2 text-sm text-slate-300">
                    {fileName} â€¢ {parsedCsv.rows.length} row
                    {parsedCsv.rows.length === 1 ? "" : "s"} detected.
                  </p>
                </div>

                <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-bold text-slate-300">
                  {selectedDefinition.label}
                </span>
              </div>

              {selectedDefinition.id === "firearms" && personnelError ? (
                <div className="mt-5 rounded-2xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
                  Personnel matching is unavailable: {personnelError}
                </div>
              ) : null}

              <div className="mt-6 grid gap-3 lg:grid-cols-2">
                {selectedDefinition.fields.map((field) => (
                  <label
                    key={field.key}
                    className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-bold text-slate-100">
                        {field.label}
                        {field.required ? (
                          <span className="ml-1 text-red-300">*</span>
                        ) : null}
                      </span>
                      {mapping[field.key] ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      ) : field.required ? (
                        <AlertTriangle className="h-4 w-4 text-red-300" />
                      ) : null}
                    </div>
                    <select
                      value={mapping[field.key] ?? ""}
                      onChange={(event) =>
                        setMapping((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                      className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
                    >
                      <option value="">Do not import</option>
                      {parsedCsv.headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
                <button
                  type="button"
                  onClick={() => setStep("upload")}
                  className="rounded-2xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep("preview")}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-950 hover:bg-slate-200"
                >
                  Continue to Preview
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </section>
          )}

          {step === "preview" && (
            <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">Preview & Validate</h2>
                  <p className="mt-2 text-sm text-slate-300">
                    Review mapped rows before importing.
                  </p>
                </div>

                <label className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search preview..."
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none focus:border-sky-500 sm:w-72"
                  />
                </label>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Rows
                  </p>
                  <p className="mt-2 text-3xl font-bold text-white">
                    {mappedRows.length}
                  </p>
                </div>
                <div className="rounded-2xl border border-red-800 bg-red-950/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-300">
                    Errors
                  </p>
                  <p className="mt-2 text-3xl font-bold text-red-200">
                    {blockingErrors.length}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-800 bg-amber-950/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
                    Warnings
                  </p>
                  <p className="mt-2 text-3xl font-bold text-amber-200">
                    {
                      validationIssues.filter((issue) => issue.severity === "warning")
                        .length
                    }
                  </p>
                </div>
              </div>

              {validationIssues.length > 0 && (
                <div className="mt-5 max-h-60 overflow-auto rounded-2xl border border-slate-800 bg-slate-950/70">
                  {validationIssues.slice(0, 30).map((issue, index) => (
                    <div
                      key={`${issue.rowNumber}-${issue.field}-${index}`}
                      className="flex gap-3 border-b border-slate-800 p-3 text-sm last:border-b-0"
                    >
                      {issue.severity === "error" ? (
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-300" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
                      )}
                      <div>
                        <p className="font-semibold text-slate-100">
                          {issue.rowNumber === 0 ? "Mapping" : `Row ${issue.rowNumber}`}
                        </p>
                        <p className="text-slate-300">{issue.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-800">
                <div className="max-h-[420px] overflow-auto">
                  <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
                    <thead className="sticky top-0 bg-slate-950 text-xs uppercase tracking-[0.18em] text-slate-400">
                      <tr>
                        {selectedDefinition.fields.map((field) => (
                          <th key={field.key} className="px-4 py-3 font-semibold">
                            {field.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 bg-slate-900">
                      {filteredPreviewRows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {selectedDefinition.fields.map((field) => (
                            <td key={field.key} className="px-4 py-3 text-slate-300">
                              {row[field.key] || (
                                <span className="text-slate-600">â€”</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
                <button
                  type="button"
                  onClick={() => setStep("mapping")}
                  className="rounded-2xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                >
                  Back
                </button>

                <button
                  type="button"
                  onClick={() => void handleImport()}
                  disabled={importing || blockingErrors.length > 0}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-950 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ClipboardCheck className="h-4 w-4" />
                  )}
                  {selectedDefinition.supportStatus === "Can Import"
                    ? "Import Records"
                    : "Generate Preview Report"}
                </button>
              </div>
            </section>
          )}

          {step === "report" && report && (
            <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-6">
              <div className="flex items-center gap-3">
                <Shield className="h-7 w-7 text-sky-300" />
                <div>
                  <h2 className="text-xl font-bold text-white">Import Report</h2>
                  <p className="mt-1 text-sm text-slate-300">{report.message}</p>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-2xl border border-emerald-800 bg-emerald-950/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
                    Created
                  </p>
                  <p className="mt-2 text-3xl font-bold text-emerald-200">
                    {report.created}
                  </p>
                </div>

                <div className="rounded-2xl border border-sky-800 bg-sky-950/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200">
                    Updated
                  </p>
                  <p className="mt-2 text-3xl font-bold text-sky-200">
                    {report.updated}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
                    Unchanged
                  </p>
                  <p className="mt-2 text-3xl font-bold text-slate-200">
                    {report.unchanged}
                  </p>
                </div>

                <div className="rounded-2xl border border-amber-800 bg-amber-950/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
                    Needs Review
                  </p>
                  <p className="mt-2 text-3xl font-bold text-amber-200">
                    {report.review}
                  </p>
                </div>

                <div className="rounded-2xl border border-amber-800 bg-amber-950/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
                    Skipped
                  </p>
                  <p className="mt-2 text-3xl font-bold text-amber-200">
                    {report.skipped}
                  </p>
                </div>

                <div className="rounded-2xl border border-red-800 bg-red-950/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-200">
                    Failed
                  </p>
                  <p className="mt-2 text-3xl font-bold text-red-200">
                    {report.failed}
                  </p>
                </div>
              </div>

              {report.reviews.length > 0 && (
                <div className="mt-5 rounded-2xl border border-amber-800 bg-amber-950/40 p-4">
                  <h3 className="font-bold text-amber-100">Needs Review</h3>
                  <ul className="mt-3 space-y-2 text-sm text-amber-200">
                    {report.reviews.slice(0, 50).map((reviewItem) => (
                      <li key={reviewItem}>{reviewItem}</li>
                    ))}
                  </ul>
                </div>
              )}
              {report.failures.length > 0 && (
                <div className="mt-5 rounded-2xl border border-red-800 bg-red-950/40 p-4">
                  <h3 className="font-bold text-red-100">Failures</h3>
                  <ul className="mt-3 space-y-2 text-sm text-red-200">
                    {report.failures.slice(0, 50).map((failure) => (
                      <li key={failure}>{failure}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={resetWizard}
                  className="rounded-2xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                >
                  Start New Import
                </button>
                {selectedDefinition.id === "personnel" ? (
                  <a
                    href="/settings"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-950 hover:bg-slate-200"
                  >
                    View Users & Roles
                    <ArrowRight className="h-4 w-4" />
                  </a>
                ) : selectedDefinition.id === "firearms" ? (
                  <a
                    href="/firearms"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-950 hover:bg-slate-200"
                  >
                    View Armory
                    <ArrowRight className="h-4 w-4" />
                  </a>
                ) : null}
              </div>
            </section>
          )}
        </div>
      </div>
    </TracePointShell>
  );
}























export default function ImportWizardPage() {
  return (
    <Suspense fallback={null}>
      <ImportWizardContent />
    </Suspense>
  );
}

















