import assert from "node:assert/strict";
import test from "node:test";
import { geometryAtCanvasPoint, moveGeometry, resizeGeometry } from "./template-builder-interactions";

const canvas = { left: 100, top: 50, width: 1000, height: 1200 };

test("manual placement and geometry gestures stay inside the normalized page", () => {
  assert.deepEqual(geometryAtCanvasPoint(1090, 1240, canvas), { x: 0.72, y: 0.955, width: 0.28, height: 0.045 });
  assert.deepEqual(moveGeometry({ x: 0.8, y: 0.8, width: 0.2, height: 0.1 }, 500, 500, canvas), { x: 0.8, y: 0.9, width: 0.2, height: 0.1 });
  assert.deepEqual(resizeGeometry({ x: 0.8, y: 0.8, width: 0.1, height: 0.1 }, 500, 500, canvas), { x: 0.8, y: 0.8, width: 0.2, height: 0.2 });
});
