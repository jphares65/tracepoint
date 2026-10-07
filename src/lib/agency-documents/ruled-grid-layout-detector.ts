import sharp from "sharp";
import type { FieldGeometry } from "./template-core";

export type GridLine = { axis: "horizontal" | "vertical"; start: number; end: number; position: number };
export type RuledGrid = { id: string; page: number; geometry: FieldGeometry; horizontalLines: number; verticalLines: number; rows: number; columns: number; confidence: number };
type Raster = { data: Uint8Array; width: number; height: number; channels: number };

function runs(values: boolean[], minimum: number) {
  const found: { start: number; end: number }[] = [];
  let start = -1;
  for (let index = 0; index <= values.length; index++) {
    if (values[index] && start < 0) start = index;
    if ((!values[index] || index === values.length) && start >= 0) { if (index - start >= minimum) found.push({ start, end: index - 1 }); start = -1; }
  }
  return found;
}
function mergeLines(lines: GridLine[], tolerance = 3) {
  const result: GridLine[] = [];
  for (const line of lines.sort((a, b) => a.position - b.position || a.start - b.start)) {
    const previous = result[result.length - 1];
    if (previous && Math.abs(previous.position - line.position) <= tolerance && Math.abs(previous.start - line.start) <= tolerance * 2 && Math.abs(previous.end - line.end) <= tolerance * 2) {
      previous.position = (previous.position + line.position) / 2; previous.start = Math.min(previous.start, line.start); previous.end = Math.max(previous.end, line.end);
    } else result.push({ ...line });
  }
  return result;
}
function gridFromLines(page: number, width: number, height: number, horizontal: GridLine[], vertical: GridLine[]): RuledGrid[] {
  const candidates: RuledGrid[] = [];
  for (let leftIndex = 0; leftIndex < vertical.length; leftIndex++) for (let rightIndex = leftIndex + 1; rightIndex < vertical.length; rightIndex++) {
    const left = vertical[leftIndex]!, right = vertical[rightIndex]!;
    if (right.position - left.position < width * .16) continue;
    const top = Math.max(left.start, right.start), bottom = Math.min(left.end, right.end);
    if (bottom - top < height * .03) continue;
    const tolerance = (right.position - left.position) * .25;
    const rows = horizontal.filter(line => line.position >= top - 5 && line.position <= bottom + 5 && line.start <= left.position + tolerance && line.end >= right.position - tolerance);
    if (rows.length < 3) continue;
    const crossing = vertical.filter(line => line.position >= left.position - 4 && line.position <= right.position + 4 && line.start <= top + 5 && line.end >= bottom - 5);
    candidates.push({ id: "", page, geometry: { x: left.position / width, y: top / height, width: (right.position - left.position) / width, height: (bottom - top) / height }, horizontalLines: rows.length, verticalLines: crossing.length, rows: rows.length - 1, columns: crossing.length - 1, confidence: Math.min(.98, .45 + rows.length * .06 + crossing.length * .08) });
  }
  const merged: RuledGrid[] = [];
  for (const candidate of candidates.sort((a, b) => a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x)) {
    const neighbor = merged.find(grid => Math.abs(grid.geometry.y - candidate.geometry.y) < .02 && Math.abs(grid.geometry.height - candidate.geometry.height) < .03 && candidate.geometry.x <= grid.geometry.x + grid.geometry.width + .04 && grid.geometry.x <= candidate.geometry.x + candidate.geometry.width + .04);
    if (!neighbor) { merged.push({ ...candidate }); continue; }
    const left = Math.min(neighbor.geometry.x, candidate.geometry.x), right = Math.max(neighbor.geometry.x + neighbor.geometry.width, candidate.geometry.x + candidate.geometry.width);
    neighbor.geometry = { x: left, y: Math.min(neighbor.geometry.y, candidate.geometry.y), width: right - left, height: Math.max(neighbor.geometry.y + neighbor.geometry.height, candidate.geometry.y + candidate.geometry.height) - Math.min(neighbor.geometry.y, candidate.geometry.y) };
    neighbor.horizontalLines = Math.max(neighbor.horizontalLines, candidate.horizontalLines); neighbor.verticalLines = Math.max(neighbor.verticalLines, candidate.verticalLines); neighbor.rows = Math.max(neighbor.rows, candidate.rows); neighbor.columns = Math.max(neighbor.columns, candidate.columns); neighbor.confidence = Math.max(neighbor.confidence, candidate.confidence);
  }
  const grids: RuledGrid[] = [];
  for (const candidate of merged.sort((a, b) => b.geometry.width * b.geometry.height - a.geometry.width * a.geometry.height)) {
    const duplicate = grids.some(grid => Math.abs(grid.geometry.y - candidate.geometry.y) < .02 && Math.abs(grid.geometry.height - candidate.geometry.height) < .05 && candidate.geometry.x >= grid.geometry.x - .02 && candidate.geometry.x + candidate.geometry.width <= grid.geometry.x + grid.geometry.width + .02);
    if (!duplicate) grids.push({ ...candidate, id: `grid-${page}-${grids.length + 1}` });
  }
  return grids.sort((a, b) => a.geometry.y - b.geometry.y);
}

export function detectRuledGridsFromRaster(raster: Raster, page: number) {
  const { data, width, height, channels } = raster, dark = (x: number, y: number) => data[(y * width + x) * channels]! < 180;
  const horizontal: GridLine[] = [], vertical: GridLine[] = [];
  for (let y = 0; y < height; y++) for (const run of runs(Array.from({ length: width }, (_, x) => dark(x, y)), Math.max(24, Math.round(width * .16)))) horizontal.push({ axis: "horizontal", start: run.start, end: run.end, position: y });
  for (let x = 0; x < width; x++) for (const run of runs(Array.from({ length: height }, (_, y) => dark(x, y)), Math.max(18, Math.round(height * .025)))) vertical.push({ axis: "vertical", start: run.start, end: run.end, position: x });
  const mergedHorizontal = mergeLines(horizontal), mergedVertical = mergeLines(vertical);
  return { horizontalLines: mergedHorizontal, verticalLines: mergedVertical, grids: gridFromLines(page, width, height, mergedHorizontal, mergedVertical) };
}

export async function detectRuledGrids(imageBytes: Uint8Array, page: number) {
  const image = sharp(imageBytes).removeAlpha().grayscale(), { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  return detectRuledGridsFromRaster({ data, width: info.width, height: info.height, channels: info.channels }, page);
}
