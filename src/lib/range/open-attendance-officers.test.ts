import assert from "node:assert/strict";
import test from "node:test";

import { filterOpenAttendanceOfficers } from "./open-attendance-officers.ts";

const officers = [
  {
    id: "officer-1",
    displayName: "Alex Morgan",
    badgeNumber: "214",
    rankTitle: "Sergeant",
    unitName: "Patrol",
  },
  {
    id: "officer-2",
    displayName: "Taylor Reed",
    badgeNumber: "317",
    rankTitle: "Officer",
    unitName: "Investigations",
  },
];

test("walk-up officer search matches name, badge, rank, and unit", () => {
  assert.deepEqual(
    filterOpenAttendanceOfficers(officers, "morgan").map((officer) => officer.id),
    ["officer-1"],
  );
  assert.deepEqual(
    filterOpenAttendanceOfficers(officers, "317").map((officer) => officer.id),
    ["officer-2"],
  );
  assert.deepEqual(
    filterOpenAttendanceOfficers(officers, "sergeant").map((officer) => officer.id),
    ["officer-1"],
  );
  assert.deepEqual(
    filterOpenAttendanceOfficers(officers, "investigations").map((officer) => officer.id),
    ["officer-2"],
  );
});
