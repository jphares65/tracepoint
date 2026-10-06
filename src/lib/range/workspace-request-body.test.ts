import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRangeWorkspaceRequestBody,
  RANGE_WORKSPACE_MAX_BODY_BYTES,
} from "./workspace-request-body.ts";

function request(body: string, contentType = "application/json") {
  return new Request("https://tracepointhq.com/api/pilot/range-workspace", {
    method: "PUT",
    headers: { "content-type": contentType },
    body,
  });
}

test("accepts a Range Workspace body materially above the managed-rule threshold", async () => {
  const body = JSON.stringify({ workspace: { padding: "x".repeat(48 * 1024) } });
  const result = await parseRangeWorkspaceRequestBody(request(body));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal((result.value as { workspace: { padding: string } }).workspace.padding.length, 48 * 1024);
});

test("rejects non-JSON, malformed JSON, and oversized Range Workspace requests", async () => {
  const cases = [
    [request("{}", "text/plain"), 415],
    [request("not-json"), 400],
    [request(JSON.stringify({ workspace: { padding: "x".repeat(RANGE_WORKSPACE_MAX_BODY_BYTES) } })), 413],
  ] as const;

  for (const [candidate, status] of cases) {
    const result = await parseRangeWorkspaceRequestBody(candidate);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, status);
  }
});
