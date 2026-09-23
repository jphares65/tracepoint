import assert from "node:assert/strict";
import test from "node:test";
import {
  AmmunitionWorkspaceBodyTooLarge,
  MAX_AMMUNITION_WORKSPACE_BODY_BYTES,
  readAmmunitionWorkspaceBody,
} from "./ammunition-request-body";

function requestWithBody(body: string): Request {
  return new Request("https://shadow.tracepointhq.com/api/pilot/ammunition", {
    method: "PUT",
    body,
    headers: { "content-type": "application/json" },
  });
}

test("legitimate 8,360-byte ammunition save parses", async () => {
  const body = JSON.stringify({ workspace: "x".repeat(8344) });
  assert.equal(Buffer.byteLength(body), 8360);
  assert.equal((await readAmmunitionWorkspaceBody(requestWithBody(body)) as { workspace: string }).workspace.length, 8344);
});

test("oversized body is rejected even without a Content-Length header", async () => {
  const body = JSON.stringify({ workspace: "x".repeat(MAX_AMMUNITION_WORKSPACE_BODY_BYTES) });
  await assert.rejects(readAmmunitionWorkspaceBody(requestWithBody(body)), AmmunitionWorkspaceBodyTooLarge);
});

test("malformed JSON remains invalid", async () => {
  await assert.rejects(readAmmunitionWorkspaceBody(requestWithBody("{")), SyntaxError);
});
