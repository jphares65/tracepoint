import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("UX-RB2-3 (D-R1): Quick Inspect, Report Issue and the inspection form follow the server's decision", async () => {
  const page = await readFile(new URL("./[vehicleId]/page.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("./[vehicleId]/QuickInspectionPanel.tsx", import.meta.url), "utf8");
  assert.match(page, /\{data\.canInspect !== false \? <button onClick=\{\(\) => setTab\("inspections"\)\}/);
  assert.match(page, /\{data\.canReportIssue !== false \? <button onClick=\{\(\) => setWorkDialog\(\{ mode: "issue" \}\)\}/);
  assert.match(page, /canInspect=\{data\.canInspect !== false\}/);
  assert.match(panel, /\{active && canInspect \? \(/);
  assert.match(panel, /do not include your role, so you can view this vehicle&apos;s inspections but not submit one/);
});
