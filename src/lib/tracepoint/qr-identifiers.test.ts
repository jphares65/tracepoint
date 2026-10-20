import assert from "node:assert/strict";
import test from "node:test";

import { buildTracePointQrValue, parseTracePointQrValue } from "./qr-identifiers.ts";

test("builds stable TracePoint vehicle and equipment QR identities", () => {
  assert.equal(buildTracePointQrValue("vehicle", "vehicle-123"), "tracepoint://vehicle/vehicle-123");
  assert.equal(buildTracePointQrValue("vehicle", "vehicle-123"), "tracepoint://vehicle/vehicle-123");
  assert.equal(buildTracePointQrValue("equipment", "asset 42"), "tracepoint://equipment/asset%2042");
  assert.throws(() => buildTracePointQrValue("equipment", "   "), /record ID/);
});

test("parses printed TracePoint QR identities back to their record", () => {
  assert.deepEqual(parseTracePointQrValue(buildTracePointQrValue("equipment", "asset 42")), { kind: "equipment", id: "asset 42" });
  assert.deepEqual(parseTracePointQrValue(" tracepoint://vehicle/vehicle-123 "), { kind: "vehicle", id: "vehicle-123" });
  for (const value of ["vehicle-123", "tracepoint://firearm/f-1", "https://example.test/vehicle/v-1", "tracepoint://vehicle/%E0%A4%A", "tracepoint://vehicle/%20"]) assert.equal(parseTracePointQrValue(value), null, value);
});
