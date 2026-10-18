import assert from "node:assert/strict";
import test from "node:test";
import { getDocumentField, searchDocumentFields } from "./field-registry";

test("document field registry searches only friendly semantic entries", () => {
  assert.deepEqual(searchDocumentFields("badge").map((field) => field.label), ["Badge number", "Prepared by (badge number)"]);
  assert.ok(searchDocumentFields("serial").some((field) => field.key === "firearm.serial_number"));
  assert.equal(getDocumentField("person.badge_number")?.category, "People");
  assert.equal(getDocumentField("profiles.badge_number"), null);
});
