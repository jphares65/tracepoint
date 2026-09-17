import assert from "node:assert/strict";
import test from "node:test";

import { readBearerToken } from "./request-bearer";

const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature";

test("accepts one well-formed Bearer JWT", () => {
  assert.equal(readBearerToken(`Bearer ${token}`), token);
});

test("rejects malformed or ambiguous authorization values", () => {
  for (const value of [
    null,
    "",
    `bearer ${token}`,
    `Bearer  ${token}`,
    `Bearer ${token} extra`,
    "Bearer not-a-jwt",
  ]) {
    assert.equal(readBearerToken(value), undefined);
  }
});
