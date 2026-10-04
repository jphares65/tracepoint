import assert from "node:assert/strict";
import test from "node:test";

import {
  COGNITO_SIGN_OUT_ALLOWED_METHOD,
  postOnlySignOutResponse,
} from "./signout-method-core.ts";

test("browser-facing Cognito sign-out keeps GET rejected", () => {
  const response = postOnlySignOutResponse();
  assert.equal(COGNITO_SIGN_OUT_ALLOWED_METHOD, "POST");
  assert.equal(response.init.status, 405);
  assert.equal(response.init.headers.Allow, "POST");
  assert.equal(response.body.error, "Sign out requires POST.");
});
