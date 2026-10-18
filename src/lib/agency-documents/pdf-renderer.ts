import { PDFCheckBox, PDFDropdown, PDFName, PDFOptionList, PDFRadioGroup, PDFRef, PDFTextField, StandardFonts, degrees, rgb, type PDFFont, type PDFForm, type PDFPage } from "pdf-lib";
import type { FieldFormatting, ResolutionStatus } from "./field-values";
import { normalizedToPdfRect, readingSize, textOrigin, type PdfRect, type Rotation } from "./page-geometry";
import { loadPdf, pageInfo, PdfInspectionError, type PdfPageInfo } from "./pdf-form-inspector";
import { isValidFieldGeometry, type FieldGeometry } from "./template-core";

/**
 * Produces the completed PDF. The same function renders previews and final
 * documents, so a preview is the document — not an approximation of it.
 *
 * - Fields linked to a native form field are filled through the form itself
 *   (exact placement, the form's own font and box), then flattened.
 * - Other fields are drawn at their stored geometry using page-geometry, which
 *   honours CropBox offsets and page rotation.
 * - Text is never silently truncated or altered. Anything that cannot be
 *   placed faithfully is returned as an issue; final generation is blocked on issues.
 */

export type RenderField = {
  fieldId?: string;
  label?: string;
  pageNumber: number;
  value: string;
  geometry: FieldGeometry;
  formatting?: (Partial<FieldFormatting> & { fontSize?: number; bold?: boolean; align?: "left" | "center" | "right"; autoFit?: boolean }) | null;
  /** Resolution status, used to colour proof outlines. */
  status?: ResolutionStatus;
};

export type RenderIssueKind = "overflow" | "too_long" | "not_an_option" | "unsupported_characters" | "form_field_missing" | "invalid_geometry" | "invalid_checkbox_value" | "page_missing";
export type RenderIssue = { fieldId?: string; label?: string; page: number; kind: RenderIssueKind; message: string };

export type RenderOptions = {
  /** "proof" draws a labelled outline around every field so placement can be checked. */
  mode?: "final" | "proof";
  /** Flatten native form fields so the output cannot be edited and looks identical in every viewer. Default true. */
  flatten?: boolean;
};

export type RenderResult = { bytes: Uint8Array; issues: RenderIssue[] };

const MIN_FONT = 6;
const MAX_FONT = 14;
const LINE_SPACING = 1.15;
const CHECKED = new Set(["x", "yes", "y", "true", "checked", "on", "1", "✓"]);
const UNCHECKED = new Set(["", "no", "n", "false", "off", "0"]);

const PROOF_COLORS: Record<string, [number, number, number]> = {
  filled: [0.11, 0.38, 0.85], static: [0.11, 0.38, 0.85], typed: [0.05, 0.55, 0.3], blank: [0.5, 0.5, 0.5], missing: [0.85, 0.15, 0.15],
};

function encodable(font: PDFFont, value: string) {
  try { font.encodeText(value); return true; } catch { return false; }
}

/** Greedy word wrap; returns null if a single word cannot fit on a line. */
export function wrapText(font: Pick<PDFFont, "widthOfTextAtSize">, value: string, size: number, maxWidth: number): string[] | null {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let line = "";
    for (const word of words) {
      if (font.widthOfTextAtSize(word, size) > maxWidth) return null;
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

export type TextLayout = { size: number; lines: string[] };

/**
 * Choose the largest font size (≤ preferred) at which the value fits the box.
 * Single-line boxes may shrink to MIN_FONT; boxes tall enough for several lines wrap.
 * Returns null when the text cannot fit without truncation.
 */
export function layoutText(font: Pick<PDFFont, "widthOfTextAtSize" | "heightAtSize">, value: string, box: { width: number; height: number }, preferred: number, options: { multiline?: boolean; autoFit?: boolean } = {}): TextLayout | null {
  const start = Math.max(MIN_FONT, Math.min(MAX_FONT, preferred));
  const floor = options.autoFit === false ? start : MIN_FONT;
  for (let size = start; size >= floor - 1e-9; size -= 0.5) {
    const lineHeight = size * LINE_SPACING;
    if (!value.includes("\n") && font.widthOfTextAtSize(value, size) <= box.width && font.heightAtSize(size) <= box.height + 0.5) return { size, lines: [value] };
    const allowWrap = options.multiline || box.height >= lineHeight * 2;
    if (allowWrap) {
      const lines = wrapText(font, value, size, box.width);
      if (lines && lines.length * lineHeight <= box.height + 0.5) return { size, lines };
    }
  }
  return null;
}

function preferredSize(formatting: RenderField["formatting"], boxHeight: number) {
  if (formatting?.fontSize) return formatting.fontSize;
  return Math.max(MIN_FONT, Math.min(11, boxHeight * 0.72));
}

function drawOverlay(page: PDFPage, info: PdfPageInfo, field: RenderField, fonts: { regular: PDFFont; bold: PDFFont }, issues: RenderIssue[]) {
  const rect = normalizedToPdfRect(field.geometry, info.box, info.rotation);
  const reading = readingSize(rect, info.rotation);
  const font = field.formatting?.bold ? fonts.bold : fonts.regular;
  const padding = Math.min(2, Math.max(0.5, reading.width * 0.02));
  const inner = { width: Math.max(1, reading.width - padding * 2), height: Math.max(1, reading.height - 1) };
  const layout = layoutText(font, field.value, inner, preferredSize(field.formatting, reading.height), { multiline: field.formatting?.multiline, autoFit: field.formatting?.autoFit });
  if (!layout) {
    issues.push({ fieldId: field.fieldId, label: field.label, page: field.pageNumber, kind: "overflow", message: `"${field.label ?? "Field"}" is too long to fit its box without cutting it off. Enlarge the box, allow a smaller font, or shorten the entry.` });
    return null;
  }
  const lineHeight = layout.size * LINE_SPACING;
  const ascent = font.heightAtSize(layout.size, { descender: false });
  const descent = layout.size * 0.21;
  const blockHeight = layout.lines.length === 1 ? ascent + descent : layout.lines.length * lineHeight;
  // Single lines are vertically centred; wrapped text starts at the top of the box.
  const topGap = layout.lines.length === 1 ? (reading.height - blockHeight) / 2 : Math.min((reading.height - blockHeight) / 2, 1.5);
  layout.lines.forEach((line, index) => {
    const lineWidth = font.widthOfTextAtSize(line, layout.size);
    const align = field.formatting?.align ?? "left";
    const dx = padding + (align === "center" ? (inner.width - lineWidth) / 2 : align === "right" ? inner.width - lineWidth : 0);
    const baselineFromTop = topGap + (layout.lines.length === 1 ? ascent : ascent + index * lineHeight);
    const origin = textOrigin(rect, info.rotation, dx, reading.height - baselineFromTop);
    page.drawText(line, { x: origin.x, y: origin.y, size: layout.size, font, color: rgb(0, 0, 0), rotate: degrees(origin.angle) });
  });
  return rect;
}

function fillNative(form: PDFForm, field: RenderField, font: PDFFont, issues: RenderIssue[]): boolean {
  const name = field.formatting?.acroFieldName!;
  let target;
  try { target = form.getField(name); } catch { target = null; }
  if (!target) {
    issues.push({ fieldId: field.fieldId, label: field.label, page: field.pageNumber, kind: "form_field_missing", message: `The form field "${name}" no longer exists in this PDF. Re-analyze the template.` });
    return false;
  }
  const value = field.value;
  if (target instanceof PDFTextField) {
    const maxLength = target.getMaxLength();
    if (maxLength !== undefined && value.length > maxLength) {
      issues.push({ fieldId: field.fieldId, label: field.label, page: field.pageNumber, kind: "too_long", message: `"${field.label ?? name}" allows ${maxLength} characters; the value has ${value.length}. It was not shortened.` });
      return false;
    }
    if (target.isCombed() || !value) { target.setText(value || undefined); return true; }
    // Fit against the smallest widget of this field so every placement shows the full value.
    const widgets = target.acroField.getWidgets();
    // Widgets rotated through /MK /R lay text along their height.
    const box = widgets.map((widget) => {
      const rect = widget.getRectangle();
      const turned = [90, 270].includes(((widget.getAppearanceCharacteristics()?.getRotation() ?? 0) % 360 + 360) % 360);
      return turned ? { width: Math.abs(rect.height), height: Math.abs(rect.width) } : { width: Math.abs(rect.width), height: Math.abs(rect.height) };
    }).reduce((a, b) => (a.width * a.height <= b.width * b.height ? a : b));
    const daSize = (() => { const match = target.acroField.getDefaultAppearance()?.match(/([\d.]+)\s+Tf/); return match ? Number(match[1]) : 0; })();
    const preferred = field.formatting?.fontSize ?? (daSize > 0 ? daSize : Math.min(11, box.height * 0.72));
    const layout = layoutText(font, value, { width: box.width - 4, height: box.height - 2 }, preferred, { multiline: target.isMultiline(), autoFit: field.formatting?.autoFit });
    if (!layout) {
      issues.push({ fieldId: field.fieldId, label: field.label, page: field.pageNumber, kind: "overflow", message: `"${field.label ?? name}" is too long to fit the form's box without cutting it off.` });
      return false;
    }
    if (layout.lines.length > 1 && !target.isMultiline()) target.enableMultiline();
    target.setText(layout.lines.length > 1 ? layout.lines.join("\n") : value);
    target.setFontSize(layout.size);
    return true;
  }
  if (target instanceof PDFCheckBox) {
    const normalized = value.trim().toLowerCase();
    if (CHECKED.has(normalized)) target.check();
    else if (UNCHECKED.has(normalized)) target.uncheck();
    else { issues.push({ fieldId: field.fieldId, label: field.label, page: field.pageNumber, kind: "invalid_checkbox_value", message: `"${field.label ?? name}" is a checkbox; "${value}" is not a yes/no value.` }); return false; }
    return true;
  }
  if (target instanceof PDFDropdown || target instanceof PDFOptionList || target instanceof PDFRadioGroup) {
    if (!value) return true;
    const options = target.getOptions();
    const match = options.find((option) => option === value) ?? options.find((option) => option.trim().toLowerCase() === value.trim().toLowerCase());
    if (!match) { issues.push({ fieldId: field.fieldId, label: field.label, page: field.pageNumber, kind: "not_an_option", message: `"${value}" is not one of the choices for "${field.label ?? name}" (${options.join(", ")}).` }); return false; }
    target.select(match);
    return true;
  }
  issues.push({ fieldId: field.fieldId, label: field.label, page: field.pageNumber, kind: "form_field_missing", message: `"${field.label ?? name}" is a form element that cannot hold a value.` });
  return false;
}

function proofRects(field: RenderField, infos: PdfPageInfo[]): Array<{ page: number; rect: PdfRect; rotation: Rotation }> {
  const placements = field.formatting?.widgets?.length ? field.formatting.widgets : [{ page: field.pageNumber, geometry: field.geometry }];
  return placements.flatMap((placement) => {
    const info = infos[placement.page - 1];
    if (!info || !isValidFieldGeometry(placement.geometry)) return [];
    return [{ page: placement.page, rect: normalizedToPdfRect(placement.geometry, info.box, info.rotation), rotation: info.rotation }];
  });
}

function drawProof(pages: PDFPage[], infos: PdfPageInfo[], field: RenderField, font: PDFFont) {
  const [r, g, b] = PROOF_COLORS[field.status ?? "filled"] ?? PROOF_COLORS.filled;
  const color = rgb(r, g, b);
  for (const placement of proofRects(field, infos)) {
    const page = pages[placement.page - 1];
    page.drawRectangle({ x: placement.rect.x, y: placement.rect.y, width: placement.rect.width, height: placement.rect.height, borderColor: color, borderWidth: 0.8, opacity: 0, borderOpacity: 0.9 });
    // Native form fields already sit under the form's own printed labels; tagging them only adds clutter.
    if (field.formatting?.acroFieldName) continue;
    const tag = (field.label ?? "Field").slice(0, 40);
    if (!encodable(font, tag)) continue;
    const size = 5.5;
    const origin = textOrigin(placement.rect, placement.rotation, 0, readingSize(placement.rect, placement.rotation).height + 1.5);
    page.drawText(tag, { x: origin.x, y: origin.y, size, font, color, rotate: degrees(origin.angle) });
  }
}

/**
 * pdf-lib's flatten can leave references to the removed widget annotations in
 * a page's /Annots array. Viewers then report the file as damaged ("Invalid
 * XRef entry"). Drop any annotation reference that no longer resolves.
 */
function removeDanglingAnnotations(pages: PDFPage[]) {
  for (const page of pages) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let index = annots.size() - 1; index >= 0; index -= 1) {
      const entry = annots.get(index);
      if (entry instanceof PDFRef && !page.doc.context.lookup(entry)) annots.remove(index);
    }
    if (annots.size() === 0) page.node.delete(PDFName.of("Annots"));
  }
}

export async function renderDocument(source: Uint8Array, fields: readonly RenderField[], options: RenderOptions = {}): Promise<RenderResult> {
  const pdf = await loadPdf(source);
  if (pdf.isEncrypted) throw new PdfInspectionError("This PDF is password-protected or restricted. Save an unrestricted copy and upload it again.");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();
  const infos = pages.map(pageInfo);
  const issues: RenderIssue[] = [];
  let form: PDFForm | null = null;
  const nativeFields = fields.filter((field) => field.formatting?.acroFieldName);
  if (nativeFields.length) {
    form = pdf.getForm();
    // XFA content would be shown instead of the AcroForm values in some viewers.
    form.deleteXFA();
  }
  for (const field of fields) {
    const label = field.label ?? "Field";
    if (field.value && !encodable(field.formatting?.bold ? bold : regular, field.value)) {
      issues.push({ fieldId: field.fieldId, label, page: field.pageNumber, kind: "unsupported_characters", message: `"${label}" contains characters the document font cannot print. It was left unchanged rather than altered.` });
      continue;
    }
    if (field.formatting?.acroFieldName && form) { fillNative(form, field, regular, issues); continue; }
    if (!field.value) continue;
    const page = pages[field.pageNumber - 1];
    if (!page) { issues.push({ fieldId: field.fieldId, label, page: field.pageNumber, kind: "page_missing", message: `"${label}" is placed on page ${field.pageNumber}, which this PDF does not have.` }); continue; }
    if (!isValidFieldGeometry(field.geometry)) { issues.push({ fieldId: field.fieldId, label, page: field.pageNumber, kind: "invalid_geometry", message: `"${label}" has an invalid position.` }); continue; }
    drawOverlay(page, infos[field.pageNumber - 1], field, { regular, bold }, issues);
  }
  if (form) {
    form.updateFieldAppearances(regular);
    if (options.flatten !== false) {
      form.flatten({ updateFieldAppearances: false });
      removeDanglingAnnotations(pages);
    }
  }
  if (options.mode === "proof") for (const field of fields) drawProof(pages, infos, field, regular);
  return { bytes: await pdf.save(), issues };
}

/** Backwards-compatible wrapper used by existing callers. Throws if any field could not be placed faithfully. */
export async function renderAgencyDocument(source: Uint8Array, fields: RenderField[]) {
  const result = await renderDocument(source, fields);
  if (result.issues.length) throw new Error(result.issues.map((issue) => issue.message).join(" "));
  return result.bytes;
}
