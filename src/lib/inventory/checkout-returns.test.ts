import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { returnPayload, validateReturnQuantity } from "./checkout-returns";

test("partial return payload preserves the requested quantity and optional note", () => {
  assert.deepEqual(returnPayload(2, "Damaged packaging"), {
    quantity: 2,
    reason: "Damaged packaging",
    reference: null,
  });
});

test("Return All uses the full outstanding quantity", () => {
  const outstanding = 5;
  const validation = validateReturnQuantity(String(outstanding), outstanding);
  assert.deepEqual(validation, { quantity: 5 });
  assert.deepEqual(returnPayload(outstanding, ""), {
    quantity: 5,
    reason: null,
    reference: null,
  });
});

test("return validation rejects zero, invalid, and over-return quantities", () => {
  assert.deepEqual(validateReturnQuantity("0", 3), {
    error: "Enter a quantity greater than zero.",
  });
  assert.deepEqual(validateReturnQuantity("nope", 3), {
    error: "Enter a quantity greater than zero.",
  });
  assert.deepEqual(validateReturnQuantity("4", 3), {
    error: "Only 3 is outstanding.",
  });
});

test("outstanding checkout cards use progressive return controls and refresh after success", async () => {
  const component = await readFile(
    "src/app/inventory/OutstandingCheckouts.tsx",
    "utf8",
  );

  assert.match(component, /setReturningId\(checkout\.id\)/);
  assert.match(component, /Return All/);
  assert.match(component, /disabled=\{submitting\}/);
  assert.match(
    component,
    /\/api\/inventory\/checkouts\/\$\{activeCheckout\.id\}\/returns/,
  );
  assert.match(
    component,
    /await Promise\.all\(\[load\(\), onReturnSuccess\?\.\(\)\]\)/,
  );
  assert.match(component, /setReturningId\(null\)/);
  assert.match(component, /outstanding_quantity:/);
  assert.match(
    component,
    /filter\(\(checkout\) => checkout\.outstanding_quantity > 0\)/,
  );
});
