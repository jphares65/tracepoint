import { getDocumentField } from "./field-registry";
import type { FieldGeometry } from "./template-core";

/**
 * Resolves the value for every template field from explicitly selected
 * TracePoint records. Pure and deterministic.
 *
 * Accuracy rules:
 * - Officer fields come only from the officer selected for this document —
 *   never from the person generating it.
 * - A missing TracePoint value is reported as missing. It is never replaced by
 *   a default, a placeholder, or another record's value.
 * - A person may type a value for a missing field; it is labelled as typed.
 * - Values are never truncated here; fit problems are reported by the renderer.
 */

export type TemplateFieldType = "tracepoint_data" | "manual" | "static_text" | "generated_date";

export type TemplateFieldSpec = {
  id: string;
  pageNumber: number;
  fieldType: TemplateFieldType;
  canonicalKey?: string | null;
  label?: string | null;
  staticText?: string | null;
  required?: boolean;
  geometry: FieldGeometry;
  formatting?: FieldFormatting | null;
};

export type FieldFormatting = {
  fontSize?: number;
  bold?: boolean;
  align?: "left" | "center" | "right";
  autoFit?: boolean;
  dateFormat?: DateFormat;
  /** Fill this native PDF form field instead of drawing over the page. */
  acroFieldName?: string;
  acroFieldKind?: string;
  multiline?: boolean;
  comb?: boolean;
  maxLength?: number | null;
  /** Additional placements of the same native field (shown in proofs). */
  widgets?: { page: number; geometry: FieldGeometry }[];
  normalizedLabel?: string;
  /** Word field locator (see docx-forms). */
  docxTarget?: unknown;
  source?: string;
  [key: string]: unknown;
};

export type DateFormat = "MM/DD/YYYY" | "MM/DD/YY" | "YYYY-MM-DD" | "Month D, YYYY";

export type PersonSource = { id: string; fullName: string; email?: string | null; badgeNumber?: string | null; rankTitle?: string | null };
export type FirearmSource = { id: string; make?: string | null; model?: string | null; serialNumber?: string | null; caliber?: string | null; assetNumber?: string | null; firearmType?: string | null; assignedOfficerName?: string | null };
export type QualificationSource = { id: string; date?: string | null; score?: number | string | null; passed?: boolean | null; courseName?: string | null; instructorName?: string | null };
export type AgencySource = { name?: string | null; shortName?: string | null; ori?: string | null; address?: string | null; chiefName?: string | null };
export type PreparerSource = { fullName?: string | null; badgeNumber?: string | null; rankTitle?: string | null };

export type GenerationSources = {
  person?: PersonSource | null;
  firearm?: FirearmSource | null;
  qualification?: QualificationSource | null;
  agency?: AgencySource | null;
  preparer?: PreparerSource | null;
  /** Report year chosen when generating, if any. */
  reportYear?: number | null;
  /** The generation date (ISO yyyy-mm-dd). Injected so output is reproducible in tests. */
  today: string;
};

export type ResolutionStatus = "filled" | "typed" | "static" | "blank" | "missing";

export type FieldResolution = {
  fieldId: string;
  label: string;
  value: string;
  status: ResolutionStatus;
  /** Where the value came from, in plain words. */
  detail: string;
  canonicalKey?: string;
};

export type ResolutionSummary = { fields: FieldResolution[]; missing: FieldResolution[]; typed: FieldResolution[]; ready: boolean };

export type ResolveOptions = {
  /** Values typed by the person generating the document, keyed by template field id. */
  entered?: Record<string, string | undefined>;
  /** Field ids the person explicitly chose to leave blank. */
  leaveBlank?: readonly string[];
};

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Remove control characters and collapse whitespace; keeps meaningful punctuation. */
export function cleanValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "boolean" ? (value ? "Yes" : "No") : "";
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").trim();
}

export function splitName(fullName: string) {
  const parts = cleanValue(fullName).split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: "", last: "" };
  const trailing = parts.length > 1 && SUFFIXES.has(parts.at(-1)!.replace(/\./g, "").toLowerCase()) ? parts.slice(0, -1) : parts;
  return { first: trailing[0] ?? "", last: trailing.length > 1 ? trailing.at(-1)! : "" };
}

/** Parse yyyy-mm-dd (optionally with time) strictly; returns null for anything ambiguous. */
export function parseIsoDate(value: string | null | undefined) {
  const match = cleanValue(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function formatDate(value: string | null | undefined, format: DateFormat = "MM/DD/YYYY") {
  const date = parseIsoDate(value);
  if (!date) return "";
  const mm = String(date.month).padStart(2, "0"), dd = String(date.day).padStart(2, "0");
  if (format === "YYYY-MM-DD") return `${date.year}-${mm}-${dd}`;
  if (format === "MM/DD/YY") return `${mm}/${dd}/${String(date.year).slice(-2)}`;
  if (format === "Month D, YYYY") return `${MONTHS[date.month - 1]} ${date.day}, ${date.year}`;
  return `${mm}/${dd}/${date.year}`;
}

type Lookup = { value: string; detail: string } | { missing: string };

function lookup(key: string, sources: GenerationSources, format: DateFormat): Lookup {
  const [group] = key.split(".");
  const has = (value: unknown, detail: string, missing: string): Lookup => { const text = cleanValue(value); return text ? { value: text, detail } : { missing }; };
  if (group === "person") {
    const person = sources.person;
    if (!person) return { missing: "Select the officer this document is for." };
    const who = `Selected officer (${cleanValue(person.fullName) || "unnamed"})`;
    const name = splitName(person.fullName);
    switch (key) {
      case "person.full_name": return has(person.fullName, who, "The selected officer has no name recorded in TracePoint.");
      case "person.first_name": return has(name.first, who, "The selected officer's first name could not be determined.");
      case "person.last_name": return has(name.last, who, "The selected officer's last name could not be determined from the recorded name.");
      case "person.badge_number": return has(person.badgeNumber, who, "The selected officer has no badge number recorded in TracePoint.");
      case "person.rank": return has(person.rankTitle, who, "The selected officer has no rank recorded in TracePoint.");
      case "person.email": return has(person.email, who, "The selected officer has no email recorded in TracePoint.");
    }
  }
  if (group === "firearm") {
    const firearm = sources.firearm;
    if (!firearm) return { missing: "Select the firearm this document is for." };
    const what = `Selected firearm (${cleanValue(firearm.serialNumber) || cleanValue(firearm.model) || "record"})`;
    switch (key) {
      case "firearm.manufacturer": return has(firearm.make, what, "The selected firearm has no manufacturer recorded.");
      case "firearm.model": return has(firearm.model, what, "The selected firearm has no model recorded.");
      case "firearm.serial_number": return has(firearm.serialNumber, what, "The selected firearm has no serial number recorded.");
      case "firearm.caliber": return has(firearm.caliber, what, "The selected firearm has no caliber recorded.");
      case "firearm.asset_number": return has(firearm.assetNumber, what, "The selected firearm has no asset number recorded.");
      case "firearm.type": return has(firearm.firearmType, what, "The selected firearm has no type recorded.");
      case "firearm.assigned_officer": return has(firearm.assignedOfficerName, what, "The selected firearm is not currently assigned to an officer.");
    }
  }
  if (group === "qualification") {
    const qualification = sources.qualification;
    if (!qualification) return { missing: "Select the qualification record this document is for." };
    const what = `Selected qualification (${formatDate(qualification.date) || "record"})`;
    switch (key) {
      case "qualification.date": return has(formatDate(qualification.date, format), what, "The selected qualification has no valid date recorded.");
      case "qualification.course_name": return has(qualification.courseName, what, "The selected qualification has no course recorded.");
      case "qualification.score": return has(qualification.score, what, "The selected qualification has no score recorded.");
      case "qualification.result": return qualification.passed === null || qualification.passed === undefined ? { missing: "The selected qualification has no pass/fail result recorded." } : { value: qualification.passed ? "Pass" : "Fail", detail: what };
      case "qualification.instructor": return has(qualification.instructorName, what, "The selected qualification has no instructor recorded.");
    }
  }
  if (group === "agency") {
    const agency = sources.agency ?? {};
    const detail = "Agency settings";
    switch (key) {
      case "agency.name": return has(agency.name, detail, "The agency name is not set in TracePoint.");
      case "agency.short_name": return has(agency.shortName, detail, "The agency short name is not set in TracePoint.");
      case "agency.ori": return has(agency.ori, detail, "The agency ORI is not stored in TracePoint. Save it on the template as a fixed value or type it when generating.");
      case "agency.address": return has(agency.address, detail, "The agency address is not stored in TracePoint. Save it on the template as a fixed value or type it when generating.");
      case "agency.chief_name": return has(agency.chiefName, detail, "The agency leader's name is not stored in TracePoint. Save it on the template as a fixed value or type it when generating.");
    }
  }
  if (group === "preparer") {
    const preparer = sources.preparer ?? {};
    const detail = `You (${cleanValue(preparer.fullName) || "current user"})`;
    switch (key) {
      case "preparer.full_name": return has(preparer.fullName, detail, "Your name is not recorded in TracePoint.");
      case "preparer.rank": return has(preparer.rankTitle, detail, "Your rank is not recorded in TracePoint.");
      case "preparer.badge_number": return has(preparer.badgeNumber, detail, "Your badge number is not recorded in TracePoint.");
    }
  }
  if (key === "document.report_year") return sources.reportYear && Number.isInteger(sources.reportYear) ? { value: String(sources.reportYear), detail: "Report year chosen for this document" } : { missing: "Enter the report year for this document." };
  if (key === "document.report_date") return has(formatDate(sources.today, format), "Today's date", "Today's date is unavailable.");
  return { missing: "This TracePoint field is not supported." };
}

export function fieldDisplayLabel(field: Pick<TemplateFieldSpec, "canonicalKey" | "label" | "staticText">) {
  return cleanValue(field.label) || (field.canonicalKey ? getDocumentField(field.canonicalKey)?.label : "") || cleanValue(field.staticText) || "Template field";
}

export function resolveFieldValues(fields: readonly TemplateFieldSpec[], sources: GenerationSources, options: ResolveOptions = {}): ResolutionSummary {
  const entered = options.entered ?? {};
  const leaveBlank = new Set(options.leaveBlank ?? []);
  const resolutions = fields.map((field): FieldResolution => {
    const label = fieldDisplayLabel(field);
    const typed = cleanValue(entered[field.id]);
    const base = { fieldId: field.id, label, canonicalKey: field.canonicalKey ?? undefined };
    const format = field.formatting?.dateFormat ?? "MM/DD/YYYY";
    if (field.fieldType === "static_text") {
      const value = cleanValue(field.staticText);
      return value ? { ...base, value, status: "static", detail: "Fixed value saved with the template" } : { ...base, value: "", status: "missing", detail: "The fixed value saved with the template is empty." };
    }
    if (field.fieldType === "generated_date") {
      const value = formatDate(sources.today, format);
      return value ? { ...base, value, status: "filled", detail: "Today's date" } : { ...base, value: "", status: "missing", detail: "Today's date is unavailable." };
    }
    if (field.fieldType === "manual") {
      if (typed) return { ...base, value: typed, status: "typed", detail: "Entered when generating" };
      if (leaveBlank.has(field.id) || !field.required) return { ...base, value: "", status: "blank", detail: field.required ? "Left blank by choice" : "Optional — left blank" };
      return { ...base, value: "", status: "missing", detail: "This information must be entered before generating." };
    }
    // tracepoint_data
    if (!field.canonicalKey || !getDocumentField(field.canonicalKey)) return { ...base, value: "", status: "missing", detail: "This field is linked to TracePoint data that no longer exists. Re-map it in the template." };
    const found = lookup(field.canonicalKey, sources, format);
    if ("value" in found) return { ...base, value: found.value, status: "filled", detail: found.detail };
    if (typed) return { ...base, value: typed, status: "typed", detail: `Entered when generating — ${found.missing}` };
    if (leaveBlank.has(field.id)) return { ...base, value: "", status: "blank", detail: `Left blank by choice — ${found.missing}` };
    return { ...base, value: "", status: "missing", detail: found.missing };
  });
  const missing = resolutions.filter((resolution) => resolution.status === "missing");
  return { fields: resolutions, missing, typed: resolutions.filter((resolution) => resolution.status === "typed"), ready: missing.length === 0 };
}

/** Which record selections a set of fields needs, so the generate screen can ask only for those. */
export function requiredSelections(fields: readonly Pick<TemplateFieldSpec, "fieldType" | "canonicalKey">[]) {
  const keys = fields.filter((field) => field.fieldType === "tracepoint_data").map((field) => field.canonicalKey ?? "");
  return {
    person: keys.some((key) => key.startsWith("person.")),
    firearm: keys.some((key) => key.startsWith("firearm.")),
    qualification: keys.some((key) => key.startsWith("qualification.")),
    reportYear: keys.includes("document.report_year"),
  };
}
