import assert from "node:assert/strict";
import test from "node:test";

import { isSupabasePrivacyPath, isSupabaseSupportPath } from "./public-path-core.ts";

test("Supabase proxy exposes the public support page without exposing subpaths", () => {
  assert.equal(isSupabaseSupportPath("/support"), true);
  assert.equal(isSupabaseSupportPath("/SUPPORT"), true);
  assert.equal(isSupabaseSupportPath("/support/private"), false);
});

test("Supabase proxy exposes the public privacy policy without exposing subpaths", () => {
  assert.equal(isSupabasePrivacyPath("/privacy"), true);
  assert.equal(isSupabasePrivacyPath("/PRIVACY"), true);
  assert.equal(isSupabasePrivacyPath("/privacy/private"), false);
});
