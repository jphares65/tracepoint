import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateCertificationCapabilityRows } from "./certification-capability-core.ts";

const base = {
  userId: "user-a",
  certificationTypeId: "type-a",
  capabilityCode: "perform_firearm_inspections" as const,
};

test("certification eligibility only accepts the active user's matching certification", () => {
  const result = evaluateCertificationCapabilityRows({
    ...base,
    rows: [
      { userId: "user-b", certificationTypeId: "type-a", status: "current" },
      { userId: "user-a", certificationTypeId: "type-b", status: "current" },
      { userId: "user-a", certificationTypeId: "type-a", status: "expired" },
    ],
  });
  assert.equal(result.eligible, false);
  assert.equal(result.status, "expired");
});

test("missing certification remains a denial", () => {
  const result = evaluateCertificationCapabilityRows({ ...base, rows: [] });
  assert.equal(result.eligible, false);
  assert.equal(result.status, "missing");
});

test("certification capability cannot use a spoofed request origin or forward request cookies", async () => {
  const helper = await readFile(new URL("./certification-capability.ts", import.meta.url), "utf8");
  const caller = await readFile(
    new URL("../../app/api/off-duty-firearms/[requestId]/inspections/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(helper, /createReadinessRepository/);
  assert.match(helper, /hasAnyServerPermission\(context/);
  assert.doesNotMatch(helper, /request\.url|headers\.get\(["']cookie["']\)|fetch\s*\(/i);
  const callStart = caller.indexOf("evaluateCertificationCapability({");
  const callEnd = caller.indexOf("});", callStart);
  assert.ok(callStart >= 0 && callEnd > callStart);
  assert.doesNotMatch(caller.slice(callStart, callEnd), /\brequest\b/);
});