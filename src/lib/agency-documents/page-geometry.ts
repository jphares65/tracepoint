import type { FieldGeometry } from "./template-core";

/**
 * Single source of truth for converting between PDF user space and the
 * normalized, top-left-origin geometry stored on template fields.
 *
 * Stored geometry is always relative to the page *as a person sees it*: the
 * visible CropBox, after the page's /Rotate is applied. Every analyzer and the
 * renderer go through these two functions, so a field detected on a rotated
 * or cropped page is drawn back exactly where it was found.
 *
 * Mapping verified empirically against poppler rendering (see
 * page-geometry.test.ts): with /Rotate 90 a point at PDF (px, py) is shown at
 * display (py, px) measured from the top-left.
 */

export type PdfBox = { x: number; y: number; width: number; height: number };
export type PdfRect = { x: number; y: number; width: number; height: number };
export type Rotation = 0 | 90 | 180 | 270;

export function normalizeRotation(angle: number): Rotation | null {
  if (!Number.isFinite(angle) || angle % 90 !== 0) return null;
  return (((angle % 360) + 360) % 360) as Rotation;
}

/** Display (visible) width/height of a page in PDF points. */
export function displaySize(box: PdfBox, rotation: Rotation) {
  return rotation === 90 || rotation === 270 ? { width: box.height, height: box.width } : { width: box.width, height: box.height };
}

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

/** PDF user-space rectangle (y up, unrotated) → normalized display geometry. Returns null if it falls outside the visible box. */
export function pdfRectToNormalized(rect: PdfRect, box: PdfBox, rotation: Rotation): FieldGeometry | null {
  const left = Math.min(rect.x, rect.x + rect.width) - box.x;
  const bottom = Math.min(rect.y, rect.y + rect.height) - box.y;
  const width = Math.abs(rect.width), height = Math.abs(rect.height);
  if (box.width <= 0 || box.height <= 0 || width <= 0 || height <= 0) return null;
  const W = box.width, H = box.height;
  let geometry: FieldGeometry;
  if (rotation === 0) geometry = { x: left / W, y: (H - bottom - height) / H, width: width / W, height: height / H };
  else if (rotation === 90) geometry = { x: bottom / H, y: left / W, width: height / H, height: width / W };
  else if (rotation === 180) geometry = { x: (W - left - width) / W, y: bottom / H, width: width / W, height: height / H };
  else geometry = { x: (H - bottom - height) / H, y: (W - left - width) / W, width: height / H, height: width / W };
  const rounded = { x: round(geometry.x), y: round(geometry.y), width: round(geometry.width), height: round(geometry.height) };
  // Tolerate sub-point rounding at the page edge, reject anything materially off-page.
  const epsilon = 0.0005;
  if (rounded.x < -epsilon || rounded.y < -epsilon || rounded.x + rounded.width > 1 + epsilon || rounded.y + rounded.height > 1 + epsilon) return null;
  const x = Math.max(0, rounded.x), y = Math.max(0, rounded.y);
  return { x, y, width: Math.min(rounded.width, 1 - x), height: Math.min(rounded.height, 1 - y) };
}

/** Normalized display geometry → PDF user-space rectangle (y up, unrotated). Exact inverse of pdfRectToNormalized. */
export function normalizedToPdfRect(geometry: FieldGeometry, box: PdfBox, rotation: Rotation): PdfRect {
  const W = box.width, H = box.height;
  let left: number, bottom: number, width: number, height: number;
  if (rotation === 0) { width = geometry.width * W; height = geometry.height * H; left = geometry.x * W; bottom = H - geometry.y * H - height; }
  else if (rotation === 90) { width = geometry.height * W; height = geometry.width * H; left = geometry.y * W; bottom = geometry.x * H; }
  else if (rotation === 180) { width = geometry.width * W; height = geometry.height * H; left = W - geometry.x * W - width; bottom = geometry.y * H; }
  else { width = geometry.height * W; height = geometry.width * H; left = W - geometry.y * W - width; bottom = H - geometry.x * H - height; }
  return { x: box.x + left, y: box.y + bottom, width, height };
}

/**
 * Where to start a line of text so it reads upright on the displayed page.
 * `dx` runs along the reading direction from the box's display-left edge,
 * `dy` is the baseline distance above the box's display-bottom edge.
 * Returns the PDF user-space origin and the rotation to apply to the text.
 */
export function textOrigin(rect: PdfRect, rotation: Rotation, dx: number, dy: number) {
  if (rotation === 0) return { x: rect.x + dx, y: rect.y + dy, angle: 0 };
  if (rotation === 90) return { x: rect.x + rect.width - dy, y: rect.y + dx, angle: 90 };
  if (rotation === 180) return { x: rect.x + rect.width - dx, y: rect.y + rect.height - dy, angle: 180 };
  return { x: rect.x + dy, y: rect.y + rect.height - dx, angle: 270 };
}

/** Width and height of the box in the reading direction (what the viewer perceives). */
export function readingSize(rect: PdfRect, rotation: Rotation) {
  return rotation === 90 || rotation === 270 ? { width: rect.height, height: rect.width } : { width: rect.width, height: rect.height };
}
