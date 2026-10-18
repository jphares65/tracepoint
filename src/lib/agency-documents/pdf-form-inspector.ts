import { PDFCheckBox, PDFDocument, PDFDropdown, PDFName, PDFOptionList, PDFRadioGroup, PDFSignature, PDFString, PDFHexString, PDFTextField, type PDFField, type PDFPage } from "pdf-lib";
import { normalizeRotation, pdfRectToNormalized, type PdfBox, type Rotation } from "./page-geometry";
import type { FieldGeometry } from "./template-core";

export type InspectedFieldKind = "text" | "checkbox" | "radio" | "dropdown" | "list" | "signature" | "button";

export type InspectedWidget = { page: number; geometry: FieldGeometry };

export type InspectedField = {
  name: string;
  kind: InspectedFieldKind;
  tooltip: string | null;
  readOnly: boolean;
  multiline: boolean;
  comb: boolean;
  maxLength: number | null;
  options: string[];
  widgets: InspectedWidget[];
  /** Widgets that exist but could not be placed (no page, off-page, or zero-size). */
  unplacedWidgets: number;
};

export type PdfPageInfo = { page: number; box: PdfBox; rotation: Rotation; displayWidth: number; displayHeight: number };

export type PdfInspection = {
  pageCount: number;
  pages: PdfPageInfo[];
  fields: InspectedField[];
  encrypted: boolean;
  /** True when the PDF has no fillable fields (a flat or scanned form). */
  flat: boolean;
};

export class PdfInspectionError extends Error {
  constructor(message: string) { super(message); this.name = "PdfInspectionError"; }
}

function decodeText(value: unknown): string | null {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    const text = value.decodeText().trim();
    return text || null;
  }
  return null;
}

export function pageInfo(page: PDFPage, index: number): PdfPageInfo {
  const crop = page.getCropBox();
  const rotation = normalizeRotation(page.getRotation().angle) ?? 0;
  const display = rotation === 90 || rotation === 270 ? { width: crop.height, height: crop.width } : { width: crop.width, height: crop.height };
  return { page: index + 1, box: { x: crop.x, y: crop.y, width: crop.width, height: crop.height }, rotation, displayWidth: display.width, displayHeight: display.height };
}

function kindOf(field: PDFField): InspectedFieldKind {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "list";
  if (field instanceof PDFSignature) return "signature";
  return "button";
}

/** Load a PDF safely; throws PdfInspectionError with a user-readable message on failure. */
export async function loadPdf(bytes: Uint8Array) {
  if (!bytes.length) throw new PdfInspectionError("The file is empty.");
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(1024, bytes.length)));
  if (!header.includes("%PDF-")) throw new PdfInspectionError("The file is not a PDF.");
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    // pdf-lib is lenient while parsing; touch the page tree so structural damage surfaces here, not mid-generation.
    if (pdf.getPageCount() < 1) throw new Error("no pages");
    return pdf;
  } catch {
    throw new PdfInspectionError("The PDF could not be read. It may be damaged.");
  }
}

export function isEncrypted(pdf: PDFDocument) {
  return pdf.isEncrypted;
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  const pdf = await loadPdf(bytes);
  return inspectLoadedPdf(pdf);
}

export function inspectLoadedPdf(pdf: PDFDocument): PdfInspection {
  const pages = pdf.getPages();
  const infos = pages.map(pageInfo);
  // Map each widget annotation dictionary to its page index once.
  const widgetPage = new Map<unknown, number>();
  pages.forEach((page, index) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (const ref of annots.asArray()) {
      widgetPage.set(ref, index);
      const resolved = pdf.context.lookup(ref);
      if (resolved) widgetPage.set(resolved, index);
    }
  });
  const fields: InspectedField[] = [];
  let form;
  try { form = pdf.getForm(); } catch { form = null; }
  for (const field of form?.getFields() ?? []) {
    const kind = kindOf(field);
    const dict = field.acroField.dict;
    const widgets: InspectedWidget[] = [];
    let unplaced = 0;
    for (const widget of field.acroField.getWidgets()) {
      let pageIndex = widgetPage.get(widget.dict);
      if (pageIndex === undefined) {
        const pRef = widget.dict.get(PDFName.of("P"));
        const found = pRef ? pages.findIndex((page) => page.ref === pRef) : -1;
        pageIndex = found >= 0 ? found : undefined;
      }
      if (pageIndex === undefined) { unplaced += 1; continue; }
      const info = infos[pageIndex];
      const geometry = pdfRectToNormalized(widget.getRectangle(), info.box, info.rotation);
      if (!geometry || geometry.width < 0.002 || geometry.height < 0.002) { unplaced += 1; continue; }
      widgets.push({ page: pageIndex + 1, geometry });
    }
    const text = field instanceof PDFTextField ? field : null;
    let options: string[] = [];
    if (field instanceof PDFDropdown || field instanceof PDFOptionList) options = field.getOptions();
    else if (field instanceof PDFRadioGroup) options = field.getOptions();
    else if (field instanceof PDFCheckBox) options = ["checked"];
    fields.push({
      name: field.getName(),
      kind,
      tooltip: decodeText(dict.get(PDFName.of("TU"))),
      readOnly: field.isReadOnly(),
      multiline: text ? text.isMultiline() : false,
      comb: text ? text.isCombed() : false,
      maxLength: text ? text.getMaxLength() ?? null : null,
      options,
      widgets,
      unplacedWidgets: unplaced,
    });
  }
  return { pageCount: pages.length, pages: infos, fields, encrypted: pdf.isEncrypted, flat: fields.length === 0 };
}

/** The most human-readable label for a field: tooltip first (it is what the form author wrote for people), then the partial name. */
export function labelSources(field: Pick<InspectedField, "name" | "tooltip">): string[] {
  const partial = field.name.split(".").at(-1) ?? field.name;
  return [field.tooltip, partial, field.name !== partial ? field.name : null].filter((value): value is string => Boolean(value && value.trim()));
}
