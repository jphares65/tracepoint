import assert from "node:assert/strict";
import test from "node:test";
import { degrees, PDFDocument, rgb } from "pdf-lib";
import { normalizedToPdfRect, pdfRectToNormalized, type Rotation } from "./page-geometry";
import { inkBounds, rasterizerAvailable, renderGray } from "./__fixtures__/raster";

const close = (actual: number, expected: number, tolerance = 0.002) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
const ROTATIONS: Rotation[] = [0, 90, 180, 270];

test("normalized geometry round-trips exactly through every rotation and a cropped, offset page box", () => {
  const boxes = [{ x: 0, y: 0, width: 612, height: 792 }, { x: 36, y: 18, width: 540, height: 720 }, { x: -50, y: 100, width: 1000, height: 500 }];
  const rect = { x: 120, y: 240, width: 180, height: 22 };
  for (const box of boxes) for (const rotation of ROTATIONS) {
    const shifted = { ...rect, x: rect.x + box.x, y: rect.y + box.y };
    const geometry = pdfRectToNormalized(shifted, box, rotation)!;
    assert.ok(geometry, `geometry should exist for rotation ${rotation}`);
    const back = normalizedToPdfRect(geometry, box, rotation);
    close(back.x, shifted.x, 0.01); close(back.y, shifted.y, 0.01); close(back.width, shifted.width, 0.01); close(back.height, shifted.height, 0.01);
  }
});

test("rectangles outside the visible crop box are rejected rather than clamped onto the page", () => {
  assert.equal(pdfRectToNormalized({ x: 0, y: 0, width: 20, height: 20 }, { x: 100, y: 100, width: 300, height: 300 }, 0), null);
});

test("stored geometry matches where a PDF viewer actually displays the box, for every rotation", { skip: !rasterizerAvailable && "pdftoppm is not installed" }, async () => {
  for (const rotation of ROTATIONS) {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 200]);
    page.setRotation(degrees(rotation));
    const rect = { x: 60, y: 30, width: 100, height: 40 };
    page.drawRectangle({ ...rect, color: rgb(0, 0, 0) });
    const expected = pdfRectToNormalized(rect, { x: 0, y: 0, width: 400, height: 200 }, rotation)!;
    const ink = inkBounds(renderGray(await pdf.save(), 1, 72))!;
    close(ink.x, expected.x, 0.02); close(ink.y, expected.y, 0.02); close(ink.width, expected.width, 0.02); close(ink.height, expected.height, 0.02);
  }
});

test("geometry is measured against the crop box a viewer shows, not the full media box", { skip: !rasterizerAvailable && "pdftoppm is not installed" }, async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const crop = { x: 72, y: 72, width: 468, height: 648 };
  page.setCropBox(crop.x, crop.y, crop.width, crop.height);
  const rect = { x: 172, y: 400, width: 120, height: 30 };
  page.drawRectangle({ ...rect, color: rgb(0, 0, 0) });
  const expected = pdfRectToNormalized(rect, crop, 0)!;
  const ink = inkBounds(renderGray(await pdf.save(), 1, 72))!;
  close(ink.x, expected.x, 0.01); close(ink.y, expected.y, 0.01);
});
