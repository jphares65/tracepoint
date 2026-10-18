/**
 * Test-only rasterizer: renders a PDF page through poppler's pdftoppm so tests
 * can check where ink actually lands on the page as a viewer would see it.
 * Renders the CropBox (-cropbox), which is what Acrobat and browser viewers show.
 * Tests that use it skip themselves when pdftoppm is not installed.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const rasterizerAvailable = (() => {
  try { return spawnSync("pdftoppm", ["-v"], { encoding: "utf8" }).status === 0 || spawnSync("pdftoppm", ["-v"]).stderr?.toString().includes("pdftoppm"); } catch { return false; }
})();

export type GrayPage = { width: number; height: number; pixels: Uint8Array };

export function renderGray(pdf: Uint8Array, page = 1, dpi = 72): GrayPage {
  const dir = mkdtempSync(join(tmpdir(), "tp-raster-"));
  try {
    const source = join(dir, "in.pdf");
    writeFileSync(source, pdf);
    const result = spawnSync("pdftoppm", ["-gray", "-cropbox", "-r", String(dpi), "-f", String(page), "-l", String(page), source, join(dir, "out")]);
    if (result.status !== 0) throw new Error(`pdftoppm failed: ${result.stderr}`);
    const file = readdirSync(dir).find((name) => name.endsWith(".pgm"));
    if (!file) throw new Error("pdftoppm produced no output");
    const data = readFileSync(join(dir, file));
    // Binary PGM: "P5\n<w> <h>\n<max>\n<bytes>"
    let offset = 0; const fields: string[] = [];
    while (fields.length < 4) {
      while (/\s/.test(String.fromCharCode(data[offset]))) offset += 1;
      let token = "";
      while (!/\s/.test(String.fromCharCode(data[offset]))) { token += String.fromCharCode(data[offset]); offset += 1; }
      fields.push(token);
    }
    offset += 1;
    const width = Number(fields[1]), height = Number(fields[2]);
    return { width, height, pixels: new Uint8Array(data.subarray(offset, offset + width * height)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Fraction of dark pixels inside a normalized (top-left origin) region. */
export function inkRatio(page: GrayPage, region: { x: number; y: number; width: number; height: number }, threshold = 128) {
  const x0 = Math.max(0, Math.floor(region.x * page.width)), x1 = Math.min(page.width, Math.ceil((region.x + region.width) * page.width));
  const y0 = Math.max(0, Math.floor(region.y * page.height)), y1 = Math.min(page.height, Math.ceil((region.y + region.height) * page.height));
  let dark = 0, total = 0;
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) { total += 1; if (page.pixels[y * page.width + x] < threshold) dark += 1; }
  return total ? dark / total : 0;
}

/** Bounding box (normalized) of all dark pixels on the page, or null when blank. */
export function inkBounds(page: GrayPage, threshold = 128) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < page.height; y += 1) for (let x = 0; x < page.width; x += 1) {
    if (page.pixels[y * page.width + x] < threshold) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }
  if (maxX < 0) return null;
  return { x: minX / page.width, y: minY / page.height, width: (maxX - minX + 1) / page.width, height: (maxY - minY + 1) / page.height };
}
