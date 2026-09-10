import assert from "node:assert/strict";
import test from "node:test";
import { parseSesFeedbackDatabaseSecret } from "./ses-feedback-handler.ts";

test("SES feedback database secret accepts only the bounded runtime credential shape", () => {
  const valid = JSON.stringify({
    host: "tracepoint.cluster-example.us-east-1.rds.amazonaws.com",
    port: 5432,
    username: "tracepoint_runtime",
    password: "x".repeat(40),
    dbname: "tracepoint",
  });
  assert.equal(parseSesFeedbackDatabaseSecret(valid).username, "tracepoint_runtime");
  for (const invalid of [
    undefined,
    "{}",
    JSON.stringify({ host: "database.example.com", port: 5432, username: "tracepoint_runtime", password: "x".repeat(40), dbname: "tracepoint" }),
    JSON.stringify({ host: "db", port: 5432, username: "postgres", password: "x".repeat(40), dbname: "tracepoint" }),
    JSON.stringify({ host: "db", port: 5432, username: "tracepoint_runtime", password: "short", dbname: "tracepoint" }),
  ]) assert.throws(() => parseSesFeedbackDatabaseSecret(invalid), /Invalid SES feedback database secret/);
});
