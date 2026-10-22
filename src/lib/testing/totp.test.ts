import assert from "node:assert/strict";
import test from "node:test";

import { base32Decode, totp } from "./totp.ts";

// RFC 6238 Appendix B (SHA-1, 8 digits, seed "12345678901234567890").
const seed = Buffer.from("12345678901234567890", "ascii");
const vectors: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

test("TOTP matches the RFC 6238 SHA-1 test vectors", () => {
  for (const [seconds, expected] of vectors) assert.equal(totp(seed, { time: seconds * 1000, digits: 8 }), expected, String(seconds));
});

test("base32 secrets decode the way authenticator apps read them", () => {
  assert.deepEqual(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"), seed);
  assert.equal(totp("GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ", { time: 59_000 }), "287082");
  assert.throws(() => base32Decode("not base32!"), /not valid base32/);
});
