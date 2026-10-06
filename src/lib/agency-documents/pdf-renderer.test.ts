import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { renderAgencyDocument } from "./pdf-renderer";

test("renders semantic values into a source PDF", async () => {
  const source = await PDFDocument.create(); source.addPage([612, 792]);
  const output = await renderAgencyDocument(await source.save(), [{ pageNumber: 1, value: "Badge 42", geometry: { x: .1, y: .1, width: .3, height: .05 }, formatting: { autoFit: true } }]);
  assert.equal((await PDFDocument.load(output)).getPageCount(), 1);
});
