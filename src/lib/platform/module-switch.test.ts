import assert from "node:assert/strict";
import test from "node:test";

import { moduleDisableConfirmation, moduleSwitchNotice } from "./module-switch.ts";

test("UX-RB2-6 (E-52): the confirmation names the module and the agency and states the effect", () => {
  assert.equal(
    moduleDisableConfirmation("Fleet Management", "Springfield PD"),
    "Turn off Fleet Management for Springfield PD? Everyone in Springfield PD loses access to Fleet Management until it is turned back on. Existing records are not deleted.",
  );
  assert.equal(moduleSwitchNotice("Fleet Management", "Springfield PD", false), "Fleet Management is now off for Springfield PD.");
  assert.equal(moduleSwitchNotice("Fleet Management", "Springfield PD", true), "Fleet Management is now on for Springfield PD.");
});
