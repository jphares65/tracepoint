import assert from "node:assert/strict";
import test from "node:test";

import { inspectionOutcome } from "./inspection-outcome.ts";

const hold = { since: "2026-10-22T10:00:00Z", source: "inspection", reason: "Critical defect recorded by the inspection on 2026-10-22." };

test("UX-RB-3: a critical defect with no work order reports Out of Service, never ready", () => {
  // Agency setting "defect creates work order" off; F3/F6a still hold the vehicle.
  const outcome = inspectionOutcome(true, { ok: true, inspection: { defect_count: 1, critical_defect_count: 1 }, workOrder: null, readiness: { status: "Out of Service", safetyHold: hold }, audit: { status: "recorded" } });
  assert.equal(outcome.saved, true);
  assert.equal(outcome.tone, "danger");
  assert.match(outcome.message, /Out of Service\. Do not use it\./);
  assert.match(outcome.message, /no work order was created/);
  assert.doesNotMatch(outcome.message, /ready|available/i);
});

test("UX-RB-3: an open critical work order keeps a clean inspection Out of Service", () => {
  const outcome = inspectionOutcome(true, { ok: true, inspection: { defect_count: 0 }, workOrder: null, readiness: { status: "Out of Service", safetyHold: null } });
  assert.equal(outcome.tone, "danger");
  assert.doesNotMatch(outcome.message, /available/i);
});

test("UX-RB-3: defects with a work order report attention and the routing", () => {
  const outcome = inspectionOutcome(true, { ok: true, inspection: { defect_count: 2 }, workOrder: { id: "wo" }, readiness: { status: "Attention", safetyHold: null } });
  assert.equal(outcome.tone, "warning");
  assert.equal(outcome.message, "Inspection saved. This vehicle needs attention. Defects were sent to maintenance as a work order.");
});

test("UX-RB-3: only a clean inspection of an available vehicle reports available", () => {
  const outcome = inspectionOutcome(true, { ok: true, inspection: { defect_count: 0 }, readiness: { status: "Available", safetyHold: null }, audit: { status: "recorded" } });
  assert.deepEqual(outcome, { saved: true, tone: "success", message: "Inspection saved. No defects; this vehicle is available.", warning: undefined });
});

test("UX-RB-3: a pending or unrecorded audit is shown as a warning", () => {
  for (const status of ["pending", "unrecorded"]) {
    const outcome = inspectionOutcome(true, { ok: true, inspection: { defect_count: 0 }, readiness: { status: "Available" }, audit: { status, message: `audit ${status}` } });
    assert.equal(outcome.warning, `audit ${status}`);
    assert.equal(outcome.tone, "warning");
  }
});

test("UX-RB-3: a 500 that carries the inspection is saved: close the form, do not resubmit", () => {
  const outcome = inspectionOutcome(false, { ok: false, error: "The inspection and its critical defect were saved, but creating the defect work order failed. The vehicle is Out of Service. Do not submit the inspection again; tell a fleet manager.", inspection: { defect_count: 1 }, vehicleOutOfService: true });
  assert.equal(outcome.saved, true);
  assert.equal(outcome.tone, "danger");
  assert.match(outcome.message, /Do not submit the inspection again/);
});

test("UX-RB-3: a failure without an inspection is not saved and keeps the form", () => {
  assert.deepEqual(inspectionOutcome(false, { error: "Your agency role or permissions do not allow vehicle inspections." }), { saved: false, tone: "danger", message: "Your agency role or permissions do not allow vehicle inspections." });
});

test("UX-RB-3: missing readiness never claims the vehicle is ready", () => {
  const outcome = inspectionOutcome(true, { ok: true, inspection: { defect_count: 0 } });
  assert.match(outcome.message, /Check the vehicle's status before use/);
});
