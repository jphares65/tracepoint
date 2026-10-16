import assert from "node:assert/strict";
import test from "node:test";

import { isSupabasePublicPath } from "./public-path-core.ts";

test("Supabase proxy exposes the public support page without exposing subpaths", () => {
  assert.equal(isSupabasePublicPath("/support"), true);
  assert.equal(isSupabasePublicPath("/SUPPORT"), true);
  assert.equal(isSupabasePublicPath("/support/private"), false);
});

test("existing public route prefixes stay unchanged", () => {
  assert.equal(isSupabasePublicPath("/landing"), true);
  assert.equal(isSupabasePublicPath("/landing/extra"), true);
  assert.equal(isSupabasePublicPath("/settings"), false);
});
