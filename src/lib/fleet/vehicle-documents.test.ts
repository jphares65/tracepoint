import assert from "node:assert/strict";
import test from "node:test";

import { vehicleDocumentExpirationStatus, vehicleDocumentMetadata } from "./vehicle-documents.ts";

test("vehicle document metadata falls back to the filename and retains operational fields", () => {
  assert.deepEqual(vehicleDocumentMetadata({ fileName: "registration-3101.pdf", title: "  ", documentType: "Registration", expirationDate: "2027-01-31" }), {
    title: "registration-3101.pdf", documentType: "Registration", expirationDate: "2027-01-31",
  });
});

test("vehicle document metadata rejects unsupported categories and invalid calendar dates", () => {
  assert.throws(() => vehicleDocumentMetadata({ fileName: "a.pdf", documentType: "Photo" }), /valid vehicle document type/);
  assert.throws(() => vehicleDocumentMetadata({ fileName: "a.pdf", expirationDate: "2026-02-30" }), /valid date/);
});

test("vehicle document expiration uses calendar dates and clearly identifies upcoming and expired records", () => {
  const today = new Date("2026-10-02T15:00:00-04:00");
  assert.equal(vehicleDocumentExpirationStatus("2026-10-01", today), "expired");
  assert.equal(vehicleDocumentExpirationStatus("2026-10-02", today), "upcoming");
  assert.equal(vehicleDocumentExpirationStatus("2026-11-01", today), "upcoming");
  assert.equal(vehicleDocumentExpirationStatus("2026-11-02", today), "current");
});
