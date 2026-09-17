import assert from "node:assert/strict";
import test from "node:test";

import { buildTracePointQrValue } from "./qr-identifiers.ts";

test("builds stable TracePoint vehicle and equipment QR identities", () => {
  assert.equal(buildTracePointQrValue("vehicle", "vehicle-123"), "tracepoint://vehicle/vehicle-123");
  assert.equal(buildTracePointQrValue("equipment", "asset 42"), "tracepoint://equipment/asset%2042");
  assert.throws(() => buildTracePointQrValue("equipment", "   "), /record ID/);
});

