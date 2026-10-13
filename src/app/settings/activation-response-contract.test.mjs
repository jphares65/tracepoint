import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
const handlerStart = source.indexOf("async function handleSendActivation(");
const handlerEnd = source.indexOf("\n  async function ", handlerStart + 1);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
const handler = source.slice(handlerStart, handlerEnd);

test("activation success requires an explicit application-level acceptance", () => {
  assert.match(handler, /result\.ok\s*===\s*true/);
});

test("HTTP 200 diagnostics, missing acceptance, and malformed JSON are failures", () => {
  assert.match(handler, /const activationAccepted = result\.ok\s*===\s*true/);
  assert.match(handler, /if\s*\(!response\.ok\s*\|\|\s*!activationAccepted\)/);
  assert.match(handler, /response\.json\(\)\.catch\(\(\)\s*=>\s*\(\{\}\)\)/);

  const isActivationSuccess = (httpOk, result) =>
    httpOk && result?.ok === true;

  assert.equal(isActivationSuccess(true, { message: "Provider diagnostic" }), false);
  assert.equal(isActivationSuccess(true, {}), false);
  assert.equal(isActivationSuccess(true, null), false);
  assert.equal(isActivationSuccess(false, { ok: true }), false);
  assert.equal(isActivationSuccess(true, { ok: true }), true);
});
