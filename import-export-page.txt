"use client";

import { ChangeEvent, useMemo, useState } from "react";
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

type ImportTypeId = "personnel" | "firearms" | "qualification_history";

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
  pilotStatus: "Preview Only" | "Can Import";
  fields: FieldDefinition[];
  duplicateKeys: string[];
};

type MappingState = Record<string, string>;

type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
};

type ValidationIssue = {
  rowNumber: number;
  severity: "error" | "warning";
  field?: string;
  message: string;
};

type ImportReport = {
  created: number;
  skipped: number;
  failed: number;
  message: string;
  failures: string[];
};

const IMPORT_TYPES: ImportTypeDefinition[] = [
  {
    id: "personnel",
    label: "Personnel",
    description:
      "Preview officers/personnel before the full personnel-table import workflow is finalized.",
    pilotStatus: "Preview Only",
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
      "Import firearm inventory directly into the live Armory pilot records.",
    pilotStatus: "Can Import",
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
        label: "Caliber",
        aliases: ["caliber", "calibre"],
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
      "Preview historical qualification results before normalized import is wired to the range workspace.",
    pilotStatus: "Preview Only",
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
];

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
  const requiredFields = definition.fields.filter((field) => field.required);
  const mappedRows = buildMappedRows(rows, mapping, definition);

  definition.fields.forEach((field) => {
    if (field.required && !mapping[field.key]) {
      issues.push({
        rowNumber: 0,
        severity: "error",
        field: field.key,
        message: `${field.label} is required but not mapped.`,
      });
    }
  });

  mappedRows.forEach((row, rowIndex) => {
    requiredFields.forEach((field) => {
      if (!row[field.key]) {
        issues.push({
          rowNumber: rowIndex + 2,
          severity: "error",
          field: field.key,
          message: `${field.label} is required.`,
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

async function importFirearm(row: Record<string, string>) {
  const response = await fetch("/api/armory/firearms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      make: row.make,
      model: row.model,
      serialNumber: row.serialNumber,
      firearmType: normalizeFirearmType(row.firearmType || "other"),
      caliber: row.caliber,
      assetNumber: row.assetNumber,
      conditionStatus: normalizeStatus(row.conditionStatus || "In Service"),
      notes: row.notes,
    }),
  });

  if (!response.ok) {
    let message = "Import failed.";

    try {
      const payload = (await response.json()) as { error?: string };
      message = payload.error ?? message;
    } catch {
      // no-op
    }

    throw new Error(message);
  }
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


export default function ImportWizardPage() {
  const [selectedTypeId, setSelectedTypeId] = useState<ImportTypeId>("personnel");
  const [step, setStep] = useState<ImportStep>("type");
  const [fileName, setFileName] = useState("");
  const [parsedCsv, setParsedCsv] = useState<ParsedCsv>({ headers: [], rows: [] });
  const [mapping, setMapping] = useState<MappingState>({});
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  const selectedDefinition = useMemo(
    () => IMPORT_TYPES.find((type) => type.id === selectedTypeId) ?? IMPORT_TYPES[0],
    [selectedTypeId],
  );

  const mappedRows = useMemo(
    () => buildMappedRows(parsedCsv.rows, mapping, selectedDefinition),
    [parsedCsv.rows, mapping, selectedDefinition],
  );

  const validationIssues = useMemo(
    () => validateRows(parsedCsv.rows, mapping, selectedDefinition),
    [parsedCsv.rows, mapping, selectedDefinition],
  );

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
    if (selectedDefinition.id !== "firearms") {
      setReport({
        created: 0,
        skipped: mappedRows.length,
        failed: 0,
        message:
          "This import type is currently preview-only. Firearms import is the first live pilot import target.",
        failures: [],
      });
      setStep("report");
      return;
    }

    setImporting(true);

    const failures: string[] = [];
    let created = 0;

    for (const [index, row] of mappedRows.entries()) {
      try {
        await importFirearm(row);
        created += 1;
      } catch (error) {
        failures.push(
          `Row ${index + 2}: ${
            error instanceof Error ? error.message : "Unknown import error"
          }`,
        );
      }
    }

    setReport({
      created,
      skipped: 0,
      failed: failures.length,
      message:
        failures.length === 0
          ? "Firearms import completed."
          : "Firearms import completed with errors.",
      failures,
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

  function handleDownloadFirearmsTemplate() {
    downloadTemplate("tracepoint-firearms-template.csv", [
      "make",
      "model",
      "serialNumber",
      "firearmType",
      "caliber",
      "assetNumber",
      "conditionStatus",
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
    <TracePointShell activePage="Settings">
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
                  preview validation issues, and begin pilot imports. Firearms
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
                <Download className="h-6 w-6 text-emerald-300" />
                <div>
                  <h2 className="text-xl font-bold text-white">Export Center</h2>
                  <p className="mt-1 text-sm text-slate-300">
                    Download current pilot data from TracePoint as CSV files.
                  </p>
                </div>
              </div>

              {exportError ? (
                <div className="mt-4 rounded-2xl border border-red-800 bg-red-950/40 p-3 text-sm font-medium text-red-200">
                  {exportError}
                </div>
              ) : null}

              <div className="mt-5 grid gap-3 md:grid-cols-3">
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
                        type.pilotStatus === "Can Import"
                          ? "border-emerald-700 bg-emerald-950/50 text-emerald-200"
                          : "border-amber-700 bg-amber-950/50 text-amber-200"
                      }`}
                    >
                      {type.pilotStatus}
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
                CSV is supported in this first pilot scaffold. Excel support can
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
                    {fileName} • {parsedCsv.rows.length} row
                    {parsedCsv.rows.length === 1 ? "" : "s"} detected.
                  </p>
                </div>

                <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-bold text-slate-300">
                  {selectedDefinition.label}
                </span>
              </div>

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
                                <span className="text-slate-600">—</span>
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
                  {selectedDefinition.pilotStatus === "Can Import"
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

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-emerald-800 bg-emerald-950/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
                    Created
                  </p>
                  <p className="mt-2 text-3xl font-bold text-emerald-200">
                    {report.created}
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
                <a
                  href="/firearms"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-950 hover:bg-slate-200"
                >
                  View Armory
                  <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            </section>
          )}
        </div>
      </div>
    </TracePointShell>
  );
}
