import assert from "node:assert/strict";
import { test } from "node:test";

import { parseUniqueBearerToken } from "./request-bearer-core";

test("accepts one canonical bearer credential", () => {
  assert.equal(parseUniqueBearerToken("Bearer header.payload.signature"), "header.payload.signature");
});

test("rejects malformed, duplicated, oversized, and non-bearer credentials", () => {
  for (const value of [
    null,
    "bearer token",
    "Bearer  token",
    "Bearer token extra",
    "Bearer first, Bearer second",
    `Bearer ${"x".repeat(16_385)}`,
  ]) {
    assert.equal(parseUniqueBearerToken(value), null);
  }
});
