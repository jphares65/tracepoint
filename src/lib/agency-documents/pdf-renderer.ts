import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { FieldGeometry } from "./template-core";

export type RenderField = {
  pageNumber: number;
  value: string;
  geometry: FieldGeometry;
  formatting?: { fontSize?: number; bold?: boolean; align?: "left" | "center" | "right"; autoFit?: boolean };
};

function fit(font: { widthOfTextAtSize(text: string, size: number): number }, value: string, width: number, starting: number, autoFit: boolean) {
  if (!autoFit) return starting;
  for (let size = starting; size >= 8; size -= 0.5) if (font.widthOfTextAtSize(value, size) <= width) return size;
  return 8;
}

export async function renderAgencyDocument(source: Uint8Array, fields: RenderField[]) {
  const pdf = await PDFDocument.load(source);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const field of fields) {
    const page = pdf.getPages()[field.pageNumber - 1]; if (!page || !field.value) continue;
    const { width, height } = page.getSize(); const geometry = field.geometry;
    const font = field.formatting?.bold ? bold : regular; const maxWidth = geometry.width * width;
    const size = fit(font, field.value, maxWidth, Math.max(8, Math.min(36, field.formatting?.fontSize ?? 12)), field.formatting?.autoFit !== false);
    const textWidth = font.widthOfTextAtSize(field.value, size);
    const alignment = field.formatting?.align ?? "left";
    const x = geometry.x * width + (alignment === "center" ? Math.max(0, (maxWidth - textWidth) / 2) : alignment === "right" ? Math.max(0, maxWidth - textWidth) : 0);
    page.drawText(field.value, { x, y: height - ((geometry.y * height) + size), size, font, color: rgb(0, 0, 0), maxWidth });
  }
  return pdf.save();
}
