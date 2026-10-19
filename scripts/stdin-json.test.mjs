import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { stripByteOrderMark } from "./stdin-json.mjs";

test("a single leading byte order mark is removed and nothing else changes", () => {
  assert.equal(stripByteOrderMark("﻿{\"a\":1}"), "{\"a\":1}");
  assert.equal(stripByteOrderMark("{\"a\":1}"), "{\"a\":1}");
  assert.equal(stripByteOrderMark("﻿﻿x"), "﻿x");
});

test("the lease validator accepts JSON piped from Windows PowerShell 5.1 (BOM-prefixed) and still rejects bad leases", () => {
  const expiry = new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString().replace(/\.\d+Z$/, "Z");
  const lease = JSON.stringify({ expiresAfterUtc: expiry, leaseOwner: "github-release", leaseReference: "github:1:1" });
  const run = (input) => spawnSync(process.execPath, [new URL("./validate-staging-database-release-lease.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], { input, encoding: "utf8" });
  const accepted = run(`﻿${lease}\r\n`);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).leaseOwner, "github-release");
  const expired = run(`﻿${JSON.stringify({ expiresAfterUtc: "2020-01-01T00:00:00Z", leaseOwner: "github-release", leaseReference: "github:1:1" })}`);
  assert.equal(expired.status, 1);
});
