import assert from "node:assert/strict";
import test from "node:test";
import { detectRuledGridsFromRaster } from "./ruled-grid-layout-detector";

function raster(width = 240, height = 300) { return new Uint8Array(width * height).fill(255); }
function horizontal(data: Uint8Array, width: number, y: number, left: number, right: number) { for (let x = left; x <= right; x++) data[y * width + x] = 0; }
function vertical(data: Uint8Array, width: number, x: number, top: number, bottom: number) { for (let y = top; y <= bottom; y++) data[y * width + x] = 0; }
function grid(data: Uint8Array, width: number, left: number, top: number, right: number, bottom: number, rows: number) { for (let row = 0; row <= rows; row++) horizontal(data, width, Math.round(top + ((bottom - top) / rows) * row), left, right); for (const x of [left, Math.round((left + right) / 2), right]) vertical(data, width, x, top, bottom); }

test("detects horizontal and vertical ruled lines as a rectangular grid", () => {
  const data = raster(); grid(data, 240, 60, 50, 190, 130, 4);
  const result = detectRuledGridsFromRaster({ data, width: 240, height: 300, channels: 1 }, 2);
  assert.ok(result.horizontalLines.length >= 5); assert.ok(result.verticalLines.length >= 3);
  assert.equal(result.grids.length, 1); assert.equal(result.grids[0]?.rows, 4); assert.equal(result.grids[0]?.columns, 2);
});
test("separates multiple ruled grids and emits no unstable grid for isolated strokes", () => {
  const data = raster(); grid(data, 240, 60, 30, 190, 100, 3); grid(data, 240, 60, 170, 190, 250, 4); horizontal(data, 240, 280, 10, 80);
  const result = detectRuledGridsFromRaster({ data, width: 240, height: 300, channels: 1 }, 2);
  assert.equal(result.grids.length, 2); assert.ok(result.grids[0]!.geometry.y < result.grids[1]!.geometry.y);
});
