import assert from "node:assert/strict";
import test from "node:test";
import { generateNativeSecretMaterial, parseNativeKeyring, rotateNativeKeyring, validateNativeSecretMaterial } from "./native-secret-material.mjs";

const deterministic = (() => { let value = 0; return size => Buffer.alloc(size, ++value); })();

test("native secret material is independent, versioned, and shape-valid", () => {
  const value = generateNativeSecretMaterial(new Date("2026-09-10T12:34:56Z"), deterministic);
  assert.equal(validateNativeSecretMaterial(value), true);
  assert.notEqual(value.TRACEPOINT_AUTH_STATE_KEYS, value.TRACEPOINT_AUTH_REFRESH_KEYS);
  assert.equal(parseNativeKeyring(value.TRACEPOINT_AUTH_STATE_KEYS, "state").active, "v20260910123456");
});

test("rotation retains only the prior active key for rollback overlap", () => {
  const initial = JSON.stringify({ active: "v1", keys: { old: Buffer.alloc(32, 1).toString("base64url"), v1: Buffer.alloc(32, 2).toString("base64url") } });
  const rotated = parseNativeKeyring(rotateNativeKeyring(initial, "state", new Date("2026-09-11T00:00:00Z"), size => Buffer.alloc(size, 3)), "state");
  assert.equal(rotated.active, "v20260911000000");
  assert.deepEqual(Object.keys(rotated.keys), ["v20260911000000", "v1"]);
});

test("invalid, oversized, or non-32-byte keyrings fail closed", () => {
  for (const raw of ["bad", JSON.stringify({ active: "x", keys: {} }), JSON.stringify({ active: "x", keys: { x: "short" } })]) assert.throws(() => parseNativeKeyring(raw, "state"));
});
