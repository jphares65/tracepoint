/**
 * Synthetic sample forms for automated tests. Every name, number and agency
 * here is invented; no customer or agency document is used anywhere in tests.
 */
import { degrees, PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFPage } from "pdf-lib";

export type SyntheticField = { name: string; tooltip?: string; label?: string; x: number; y: number; width: number; height: number; multiline?: boolean; kind?: "text" | "checkbox" | "dropdown"; options?: string[]; maxLength?: number; comb?: boolean; readOnly?: boolean };

export type SyntheticPage = { size?: [number, number]; rotation?: 0 | 90 | 180 | 270; cropBox?: { x: number; y: number; width: number; height: number }; mediaOrigin?: [number, number]; fields: SyntheticField[] };

/** Build a fillable PDF. Field coordinates are PDF user-space points on the unrotated page. */
export async function buildAcroFormPdf(pages: SyntheticPage[]) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Synthetic test form");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const form = pdf.getForm();
  for (const spec of pages) {
    const [width, height] = spec.size ?? [612, 792];
    const page = pdf.addPage([width, height]);
    if (spec.mediaOrigin) page.setMediaBox(spec.mediaOrigin[0], spec.mediaOrigin[1], width, height);
    if (spec.cropBox) page.setCropBox(spec.cropBox.x, spec.cropBox.y, spec.cropBox.width, spec.cropBox.height);
    if (spec.rotation) page.setRotation(degrees(spec.rotation));
    for (const field of spec.fields) {
      if (field.label) page.drawText(field.label, { x: field.x, y: field.y + field.height + 3, size: 8, font, color: rgb(0.2, 0.2, 0.2) });
      const rect = { x: field.x, y: field.y, width: field.width, height: field.height, borderWidth: 0 };
      if (field.kind === "checkbox") {
        form.createCheckBox(field.name).addToPage(page, rect);
      } else if (field.kind === "dropdown") {
        const dropdown = form.createDropdown(field.name);
        dropdown.addOptions(field.options ?? []);
        dropdown.addToPage(page, rect);
      } else {
        const text = form.createTextField(field.name);
        if (field.multiline) text.enableMultiline();
        if (field.maxLength) text.setMaxLength(field.maxLength);
        if (field.comb) text.enableCombing();
        text.addToPage(page, { ...rect, font });
        if (field.readOnly) text.enableReadOnly();
      }
      if (field.tooltip) form.getField(field.name).acroField.dict.set(PDFName.of("TU"), PDFString.of(field.tooltip));
    }
  }
  return pdf.save();
}

/** A one-page annual firearms qualification form with realistic labels, including traps (supervisor, signature, case number). */
export const QUALIFICATION_FORM_FIELDS: SyntheticField[] = [
  { name: "OfficerName", tooltip: "Officer Name", label: "Officer Name", x: 50, y: 700, width: 250, height: 18 },
  { name: "BadgeNo", label: "Badge #", x: 320, y: 700, width: 100, height: 18 },
  { name: "Rank", label: "Rank", x: 440, y: 700, width: 120, height: 18 },
  { name: "AgencyName", tooltip: "Agency Name", label: "Agency", x: 50, y: 650, width: 250, height: 18 },
  { name: "Make", tooltip: "Manufacturer", label: "Make", x: 50, y: 600, width: 120, height: 18 },
  { name: "Model", label: "Model", x: 190, y: 600, width: 120, height: 18 },
  { name: "SerialNo", label: "Serial #", x: 330, y: 600, width: 120, height: 18, comb: false },
  { name: "Caliber", label: "Caliber", x: 470, y: 600, width: 90, height: 18 },
  { name: "QualDate", tooltip: "Qualification Date", label: "Date Qualified", x: 50, y: 550, width: 120, height: 18 },
  { name: "Score", label: "Score", x: 190, y: 550, width: 80, height: 18 },
  { name: "PassFail", tooltip: "Pass/Fail", label: "Pass/Fail", x: 290, y: 550, width: 80, height: 18 },
  { name: "InstructorName", label: "Instructor", x: 390, y: 550, width: 170, height: 18 },
  { name: "SupervisorName", tooltip: "Supervisor Name", label: "Supervisor", x: 50, y: 500, width: 250, height: 18 },
  { name: "OfficerSignature", tooltip: "Officer Signature", label: "Officer Signature", x: 320, y: 500, width: 240, height: 18 },
  { name: "CaseNumber", tooltip: "Case Number", label: "Case #", x: 50, y: 450, width: 150, height: 18 },
  { name: "Remarks", tooltip: "Remarks", label: "Remarks", x: 50, y: 330, width: 510, height: 90, multiline: true },
  { name: "DutyWeapon", tooltip: "Duty weapon", label: "Duty weapon", x: 50, y: 290, width: 14, height: 14, kind: "checkbox" },
];

export async function buildQualificationForm(extra: Partial<SyntheticPage> = {}) {
  return buildAcroFormPdf([{ fields: QUALIFICATION_FORM_FIELDS, ...extra }]);
}

/** A flat (non-fillable) PDF with printed labels and blank lines — like a scanned or printed form. */
export async function buildFlatForm() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  drawLine(page, font, "Officer Name:", 50, 700);
  drawLine(page, font, "Badge Number:", 50, 660);
  return pdf.save();
}

function drawLine(page: PDFPage, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, label: string, x: number, y: number) {
  page.drawText(label, { x, y, size: 10, font });
  page.drawLine({ start: { x: x + 90, y: y - 2 }, end: { x: x + 300, y: y - 2 }, thickness: 0.5 });
}

/** Synthetic TracePoint records used to fill forms in tests. */
export const SYNTHETIC_OFFICER = { id: "00000000-0000-4000-8000-000000000001", full_name: "Jordan A. Rivera", email: "jrivera@example.test", badge_number: "4471", rank_title: "Patrol Officer", is_active: true };
export const SYNTHETIC_PREPARER = { fullName: "Casey Morgan", badgeNumber: "1102", rankTitle: "Sergeant", email: "cmorgan@example.test" };
export const SYNTHETIC_AGENCY = { name: "Lakeview Township Police Department", shortName: "Lakeview PD" };
export const SYNTHETIC_FIREARM = { id: "00000000-0000-4000-8000-000000000002", make: "Example Arms", model: "EA-19", serial_number: "EXA123456", caliber: "9mm", asset_number: "LV-0042", firearm_type: "Handgun", assigned_to_user_id: SYNTHETIC_OFFICER.id };
export const SYNTHETIC_QUALIFICATION = { id: "00000000-0000-4000-8000-000000000003", qualification_date: "2026-03-14", score: 287, passed: true, course_name: "Day Handgun Course", instructor_name: "Taylor Brooks", officer_user_id: SYNTHETIC_OFFICER.id };
