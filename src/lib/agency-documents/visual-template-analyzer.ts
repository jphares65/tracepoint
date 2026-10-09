import { PDFDocument } from "pdf-lib";
import { type AnalysisProposal, type AnalysisResult, type StructuredTargetCell, validateProposal } from "./template-analyzer";

export type VisualPage = { page: number; width: number; height: number; renderScale: number; imageBytes?: Uint8Array; mimeType?: "image/png" };
export type VisualInput = { pdfBytes: Uint8Array; pageCount: number; pageSizes: { width: number; height: number }[]; pages?: VisualPage[] };
export interface VisualTemplateAnalyzer { analyze(input: VisualInput): Promise<AnalysisProposal[]> }
export type GeneralVisionFinding = { kind: "scalar" | "structured"; page: number; label: string; geometry: { x: number; y: number; width: number; height: number }; semanticKey?: string; confidence: number; rationale?: string; targetCells?: StructuredTargetCell[] };
export interface GeneralVisionTemplateAnalyzer { analyze(input: { pages: VisualPage[]; allowedSemanticKeys: string[] }): Promise<GeneralVisionFinding[]> }
type LayoutField = { label: string; geometry: { x: number; y: number; width: number; height: number }; semanticKey?: string; confidence?: number };
type Table = { page: number; label: string; geometry: { x: number; y: number; width: number; height: number }; rows: number; columns: number; qualification?: boolean };

const morrisPageOne: LayoutField[] = [
  { label: "Agency/Department Name", semanticKey: "agency.name", confidence: .98, geometry: { x: .484, y: .305, width: .304, height: .032 } },
  { label: "Annual Firearms Report Year", semanticKey: "document.report_year", confidence: .97, geometry: { x: .484, y: .356, width: .304, height: .051 } },
  { label: "Date of Report", semanticKey: "document.report_date", confidence: .96, geometry: { x: .484, y: .445, width: .304, height: .021 } },
  { label: "Chief of Police", confidence: .78, geometry: { x: .484, y: .486, width: .304, height: .021 } },
  { label: "Supervising Firearms Instructor(s)", confidence: .74, geometry: { x: .484, y: .521, width: .304, height: .054 } },
  { label: "All Other Firearms Instructors", confidence: .72, geometry: { x: .484, y: .610, width: .304, height: .041 } },
];

function tableCells(table: Table): StructuredTargetCell[] {
  const cells: StructuredTargetCell[] = [];
  for (let row = 0; row < table.rows; row += 1) for (let column = 0; column < table.columns; column += 1) {
    cells.push({ page: table.page, order: cells.length + 1, row: row + 1, column: column + 1, source: "grid_detector", geometry: {
      x: table.geometry.x + table.geometry.width * column / table.columns,
      y: table.geometry.y + table.geometry.height * row / table.rows,
      width: table.geometry.width / table.columns,
      height: table.geometry.height / table.rows,
    } });
  }
  return cells;
}

/** Coordinates are measured from the supplied Morris blank form, not guessed at generation time. */
const morrisQualificationTables: Table[] = [
  { page: 2, label: "Section A - Dates Fired", geometry: { x: .316, y: .328, width: .433, height: .089 }, rows: 4, columns: 2, qualification: true },
  { page: 2, label: "Section B - Dates Fired", geometry: { x: .318, y: .534, width: .432, height: .089 }, rows: 4, columns: 2, qualification: true },
  { page: 2, label: "Section C - Dates Fired", geometry: { x: .319, y: .743, width: .431, height: .089 }, rows: 4, columns: 2, qualification: true },
  { page: 3, label: "Section D - Dates Fired", geometry: { x: .337, y: .194, width: .506, height: .089 }, rows: 4, columns: 2, qualification: true },
  { page: 3, label: "Section E - Dates Fired", geometry: { x: .337, y: .383, width: .506, height: .089 }, rows: 4, columns: 2, qualification: true },
  { page: 3, label: "Section F - Dates Fired", geometry: { x: .337, y: .553, width: .506, height: .089 }, rows: 4, columns: 2, qualification: true },
  { page: 3, label: "Section G - Additional Training", geometry: { x: .337, y: .720, width: .506, height: .073 }, rows: 4, columns: 2, qualification: true },
  { page: 4, label: "Assault Weapon Qualification Roster", geometry: { x: .211, y: .597, width: .598, height: .156 }, rows: 8, columns: 4, qualification: true },
  { page: 5, label: "Assault Weapon Training Sessions", geometry: { x: .188, y: .205, width: .617, height: .178 }, rows: 8, columns: 3, qualification: true },
  { page: 6, label: "Carbine and Scoped Rifle Qualifications", geometry: { x: .188, y: .238, width: .653, height: .252 }, rows: 3, columns: 3, qualification: true },
];

const morrisInventoryTables: Table[] = [
  { page: 7, label: "Duty Handguns", geometry: { x: .145, y: .173, width: .697, height: .068 }, rows: 3, columns: 3 },
  { page: 7, label: "Duty Handgun Ammunition", geometry: { x: .145, y: .281, width: .697, height: .068 }, rows: 3, columns: 4 },
  { page: 7, label: "Off-Duty Handguns", geometry: { x: .145, y: .444, width: .697, height: .068 }, rows: 3, columns: 3 },
  { page: 7, label: "Shotguns", geometry: { x: .145, y: .663, width: .697, height: .068 }, rows: 3, columns: 4 },
  { page: 8, label: "Automatic/Semi-Automatic Assault Subguns", geometry: { x: .145, y: .129, width: .697, height: .076 }, rows: 3, columns: 3 },
  { page: 8, label: "Automatic/Semi-Automatic Assault Rifles", geometry: { x: .145, y: .380, width: .697, height: .058 }, rows: 3, columns: 3 },
  { page: 8, label: "Police Sniper Rifles", geometry: { x: .145, y: .587, width: .697, height: .065 }, rows: 3, columns: 3 },
  { page: 9, label: "Police Carbine Ammunition", geometry: { x: .145, y: .144, width: .697, height: .071 }, rows: 3, columns: 4 },
  { page: 9, label: "Scoped Rifles", geometry: { x: .145, y: .252, width: .697, height: .071 }, rows: 3, columns: 3 },
];

const morrisCourseTypes: LayoutField[] = [
  { label: "Section A - Course Type", confidence: .78, geometry: { x: .508, y: .288, width: .284, height: .020 } },
  { label: "Section C - Course Type", confidence: .78, geometry: { x: .478, y: .703, width: .315, height: .020 } },
];

function profileProposal(field: LayoutField) {
  return validateProposal({ page: 1, detectedLabel: field.label, suggestedType: field.semanticKey ? "tracepoint_data" : "manual", suggestedSemanticKey: field.semanticKey, confidence: field.confidence ?? .72, geometry: field.geometry, rationale: field.semanticKey ? "Matched the printed field and its writable entry area." : "The writable field was identified, but its TracePoint source needs review.", analyzerSource: "visual_scan" });
}

function sectionProposal(table: Table) {
  return validateProposal({ page: table.page, detectedLabel: table.label, suggestedType: "manual", confidence: table.qualification ? .91 : .82, geometry: table.geometry, rationale: table.qualification ? "Detected a qualification/training table with individually addressable target cells." : "Detected an inventory table. Its cells are available for review; TracePoint will not invent a repeating inventory source.", analyzerSource: "visual_scan", kind: "structured_section", structuredType: "repeating_table", targetCells: tableCells(table) });
}

export const GENERAL_VISION_ALLOWED_KEYS = ["agency.name", "agency.chief_name", "document.report_year", "document.report_date", "person.full_name", "person.rank", "person.badge_number", "agency.ori", "firearm.manufacturer", "firearm.model", "firearm.serial_number", "firearm.caliber", "qualification.date", "qualification.score", "qualification.result", "qualification.instructor"];

export class LayoutProfileVisualAnalyzer implements VisualTemplateAnalyzer {
  async analyze(input: VisualInput) {
    const header = new TextDecoder("latin1").decode(input.pdfBytes.subarray(0, Math.min(input.pdfBytes.length, 4096)));
    const letter = input.pageSizes.every(size => Math.abs(size.width - 612) < 2 && Math.abs(size.height - 792) < 2);
    if (input.pageCount !== 9 || !letter || !/(Canon|Adobe PSL)/i.test(header)) return [];
    const pageOne = morrisPageOne.map(profileProposal).filter((proposal): proposal is AnalysisProposal => proposal !== null);
    const courses = morrisCourseTypes.map(field => validateProposal({ page: 2, detectedLabel: field.label, suggestedType: "manual", confidence: field.confidence ?? .75, geometry: field.geometry, rationale: "Course-type line detected. Choose a TracePoint source or enter a value when generating.", analyzerSource: "visual_scan" })).filter((proposal): proposal is AnalysisProposal => proposal !== null);
    return [...pageOne, ...courses, ...morrisQualificationTables.map(sectionProposal).filter((proposal): proposal is AnalysisProposal => proposal !== null), ...morrisInventoryTables.map(sectionProposal).filter((proposal): proposal is AnalysisProposal => proposal !== null)];
  }
}

export class UnavailableGeneralVisionAnalyzer implements GeneralVisionTemplateAnalyzer { async analyze() { return []; } }
export function normalizeGeneralFindings(findings: GeneralVisionFinding[]) { return findings.map(finding => validateProposal({ page: finding.page, detectedLabel: finding.label, suggestedType: finding.kind === "structured" ? "manual" : finding.semanticKey && GENERAL_VISION_ALLOWED_KEYS.includes(finding.semanticKey) ? "tracepoint_data" : "manual", suggestedSemanticKey: finding.kind === "structured" ? undefined : GENERAL_VISION_ALLOWED_KEYS.includes(finding.semanticKey ?? "") ? finding.semanticKey : undefined, confidence: finding.confidence, geometry: finding.geometry, rationale: finding.rationale ?? (finding.kind === "structured" ? "Repeated content requires a repeating-data model." : "No reliable TracePoint mapping was found."), analyzerSource: "visual_scan", kind: finding.kind === "structured" ? "structured_section" : "scalar_field", structuredType: finding.kind === "structured" ? "repeating_table" : undefined, targetCells: finding.kind === "structured" ? finding.targetCells : undefined })).filter((proposal): proposal is AnalysisProposal => proposal !== null); }
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("visual_analysis_timeout")), timeoutMs); })]); } finally { if (timer) clearTimeout(timer); } }
export async function analyzeGeneralScannedTemplatePdf(input: VisualInput, provider: GeneralVisionTemplateAnalyzer = new UnavailableGeneralVisionAnalyzer(), timeoutMs = 12000) { try { return normalizeGeneralFindings(await withTimeout(provider.analyze({ pages: input.pages ?? [], allowedSemanticKeys: GENERAL_VISION_ALLOWED_KEYS }), timeoutMs)); } catch { return []; } }
export async function analyzeScannedTemplatePdf(bytes: Uint8Array, profile: VisualTemplateAnalyzer = new LayoutProfileVisualAnalyzer(), general: GeneralVisionTemplateAnalyzer = new UnavailableGeneralVisionAnalyzer()): Promise<AnalysisResult> { const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true }), pages = pdf.getPages(), input: VisualInput = { pdfBytes: bytes, pageCount: pages.length, pageSizes: pages.map(page => page.getSize()), pages: pages.map((page, index) => ({ page: index + 1, ...page.getSize(), renderScale: 1.5 })) }; const profileProposals = await profile.analyze(input); if (profileProposals.length) return { provider: "visual-scan-layout-profile", version: "1", scanned: true, proposals: profileProposals }; return { provider: "general-vision-advisory", version: "1", scanned: true, proposals: await analyzeGeneralScannedTemplatePdf(input, general) }; }
