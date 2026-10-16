import assert from "node:assert/strict";
import test from "node:test";

import { isSupabaseSupportPath } from "./public-path-core.ts";

test("Supabase proxy exposes the public support page without exposing subpaths", () => {
  assert.equal(isSupabaseSupportPath("/support"), true);
  assert.equal(isSupabaseSupportPath("/SUPPORT"), true);
  assert.equal(isSupabaseSupportPath("/support/private"), false);
});
