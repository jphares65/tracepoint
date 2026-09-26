import assert from "node:assert/strict";
import test from "node:test";
import { bridgeWriteFenceResponse } from "./bridge-maintenance.ts";

test("bridge maintenance rejects mutations without affecting safe reads", async () => {
  const environment = { TRACEPOINT_RUNTIME_PROVIDER_MODE: "bridge", TRACEPOINT_SOURCE_WRITE_FROZEN: "on" };
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(bridgeWriteFenceResponse(environment, method), null);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = bridgeWriteFenceResponse(environment, method);
    assert.equal(response?.status, 503);
    assert.equal(response?.headers.get("Cache-Control"), "no-store");
    assert.equal(response?.headers.get("Retry-After"), "60");
    assert.deepEqual(await response?.json(), { code: "source_write_frozen" });
  }
});

test("default and explicit off bridge modes remain unchanged", () => {
  assert.equal(bridgeWriteFenceResponse({}, "POST"), null);
  assert.equal(bridgeWriteFenceResponse({ TRACEPOINT_SOURCE_WRITE_FROZEN: "off" }, "POST"), null);
});

test("AWS-native runtime never inherits bridge maintenance, and invalid bridge setting fails closed", async () => {
  assert.equal(bridgeWriteFenceResponse({ TRACEPOINT_RUNTIME_PROVIDER_MODE: "aws-native", TRACEPOINT_SOURCE_WRITE_FROZEN: "on" }, "POST"), null);
  const response = bridgeWriteFenceResponse({ TRACEPOINT_RUNTIME_PROVIDER_MODE: "bridge", TRACEPOINT_SOURCE_WRITE_FROZEN: "true" }, "GET");
  assert.equal(response?.status, 503);
  assert.deepEqual(await response?.json(), { code: "maintenance_configuration_invalid" });
});
