import assert from "node:assert/strict";
import test from "node:test";
import { internalSourceUrl } from "./internal-source-url.ts";

test("AWS-native notification reads use only local HTTP for fixed API paths", () => {
  const url = internalSourceUrl(
    "/api/pilot/range-workspace",
    "https://ip-10-40-0-145.ec2.internal:3000/api/notifications",
    "aws-native",
    "3000",
  );
  assert.equal(url.href, "http://127.0.0.1:3000/api/pilot/range-workspace");
});

test("bridge notification reads retain their existing origin behavior", () => {
  const url = internalSourceUrl(
    "/api/armory/firearms",
    "https://tracepointhq.com/api/notifications",
    "supabase",
    undefined,
  );
  assert.equal(url.href, "https://tracepointhq.com/api/armory/firearms");
});

test("AWS-native notification reads fail closed on invalid paths or port", () => {
  assert.throws(() => internalSourceUrl("https://example.com", "https://shadow.tracepointhq.com", "aws-native", "3000"));
  assert.throws(() => internalSourceUrl("//example.com/api/notifications", "https://shadow.tracepointhq.com", "aws-native", "3000"));
  assert.throws(() => internalSourceUrl("/api/notifications?token=secret", "https://shadow.tracepointhq.com", "aws-native", "3000"));
  assert.throws(() => internalSourceUrl("/api/notifications", "https://shadow.tracepointhq.com", "aws-native", undefined));
});
