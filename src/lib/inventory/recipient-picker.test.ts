import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  checkoutRecipientPayload,
  filterRecipientOptions,
} from "./recipient-picker";

const officers = [
  { id: "officer-id", label: "Officer Alex Morgan", detail: "123 · Patrol" },
  { id: "officer-two", label: "Officer Jordan Lee", detail: "456 · Traffic" },
];
const vehicles = [
  { id: "vehicle-id", label: "Car 12", detail: "Ford · Explorer · PD 12" },
];

test("officer search selects a human-readable result while retaining its ID", () => {
  assert.deepEqual(filterRecipientOptions(officers, "morgan"), [officers[0]]);
  assert.equal(
    checkoutRecipientPayload("officer", officers[0].id).recipientUserId,
    "officer-id",
  );
});

test("vehicle search selects by identifying label while retaining its ID", () => {
  assert.deepEqual(filterRecipientOptions(vehicles, "explorer"), [vehicles[0]]);
  assert.equal(
    checkoutRecipientPayload("vehicle", vehicles[0].id).recipientVehicleId,
    "vehicle-id",
  );
});

test("recipient payload clears incompatible fields when recipient type changes", () => {
  assert.deepEqual(checkoutRecipientPayload("unit", "Patrol A"), {
    recipientUserId: "",
    recipientUnit: "Patrol A",
    recipientVehicleId: "",
  });
  assert.deepEqual(checkoutRecipientPayload("vehicle", "vehicle-id"), {
    recipientUserId: "",
    recipientUnit: "",
    recipientVehicleId: "vehicle-id",
  });
});

test("recipient picker presents loading, failure, and empty states without UUID entry", async () => {
  const component = await readFile(
    "src/app/inventory/InventoryCheckoutForm.tsx",
    "utf8",
  );
  assert.match(component, /\/api\/pilot\/personnel/);
  assert.match(component, /\/api\/fleet\/vehicles/);
  assert.match(component, /Loading \{label\.toLowerCase\(\)\}s/);
  assert.match(component, /No \{label\.toLowerCase\(\)\}s found/);
  assert.match(
    component,
    /placeholder=\{`Search \$\{label\.toLowerCase\(\)\}s`\}/,
  );
  assert.doesNotMatch(component, /Recipient ID/);
});
