import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { FieldGeometry } from "./template-core";

export type RenderField = {
  pageNumber: number;
  value: string;
  geometry: FieldGeometry;
  formatting?: { fontSize?: number; bold?: boolean; align?: "left" | "center" | "right"; autoFit?: boolean };
};

function fit(font: { widthOfTextAtSize(text: string, size: number): number }, value: string, width: number, starting: number, autoFit: boolean) {
  if (!autoFit) return { value, size: starting };
  for (let size = starting; size >= 7; size -= 0.5) if (font.widthOfTextAtSize(value, size) <= width) return { value, size };
  let truncated = value;
  while (truncated.length > 1 && font.widthOfTextAtSize(`${truncated}…`, 7) > width) truncated = truncated.slice(0, -1);
  return { value: `${truncated}…`, size: 7 };
}

export async function renderAgencyDocument(source: Uint8Array, fields: RenderField[]) {
  const pdf = await PDFDocument.load(source);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const field of fields) {
    const page = pdf.getPages()[field.pageNumber - 1]; if (!page || !field.value) continue;
    const { width, height } = page.getSize(); const geometry = field.geometry;
    const font = field.formatting?.bold ? bold : regular, padding = Math.min(3, Math.max(1, geometry.width * width * .04)); const maxWidth = Math.max(1, geometry.width * width - padding * 2);
    const fitted = fit(font, field.value, maxWidth, Math.max(7, Math.min(36, field.formatting?.fontSize ?? 11)), field.formatting?.autoFit !== false), size = fitted.size;
    const textWidth = font.widthOfTextAtSize(fitted.value, size);
    const alignment = field.formatting?.align ?? "left";
    const x = geometry.x * width + padding + (alignment === "center" ? Math.max(0, (maxWidth - textWidth) / 2) : alignment === "right" ? Math.max(0, maxWidth - textWidth) : 0);
    // pdf-lib positions text by its baseline. Offset from the bottom using the
    // font ascent estimate so values are optically centered inside ruled cells.
    const boxHeight = geometry.height * height, bottom = height - (geometry.y + geometry.height) * height, y = bottom + Math.max(size * .25, boxHeight / 2 - size * .3);
    page.drawText(fitted.value, { x, y, size, font, color: rgb(0, 0, 0), maxWidth });
  }
  return pdf.save();
}
