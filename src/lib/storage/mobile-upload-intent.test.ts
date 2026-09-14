import assert from "node:assert/strict";
import { test } from "node:test";

import { openMobileUploadIntent, sealMobileUploadIntent } from "./mobile-upload-intent";
import type { AttachmentObjectPath } from "./object-store-core";

const keyring = { active: "current", keys: new Map([["current", new Uint8Array(32).fill(7)]]) };
const input = {
  attachmentId: "10000000-0000-4000-8000-000000000001",
  departmentId: "20000000-0000-4000-8000-000000000002",
  userId: "30000000-0000-4000-8000-000000000003",
  vehicleId: "40000000-0000-4000-8000-000000000004",
  inspectionId: "50000000-0000-4000-8000-000000000005",
  checklistItemId: "tires",
  fileName: "tire.jpg",
  contentType: "image/jpeg",
  size: 1234,
  path: "20000000-0000-4000-8000-000000000002/fleet-inspection/50000000-0000-4000-8000-000000000005/object-tire.jpg" as AttachmentObjectPath,
};

test("round trips a short-lived signed upload intent", () => {
  const token = sealMobileUploadIntent(input, keyring, 1000);
  assert.deepEqual(openMobileUploadIntent(token, keyring, 1001), { ...input, v: 1, expiresAt: 1120 });
});

test("rejects tampering, expiry, and wrong keyrings", () => {
  const token = sealMobileUploadIntent(input, keyring, 1000);
  assert.equal(openMobileUploadIntent(`${token}x`, keyring, 1001), null);
  assert.equal(openMobileUploadIntent(token, keyring, 1121), null);
  assert.equal(openMobileUploadIntent(token, { active: "other", keys: new Map([["other", new Uint8Array(32).fill(8)]]) }, 1001), null);
});
