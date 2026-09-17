import assert from "node:assert/strict";
import test from "node:test";

import {
  filterOpenAttendanceOfficers,
  getOpenAttendanceOfficerLabel,
} from "./open-attendance-officers.ts";

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

test("keeps same-name officers distinct by badge, unit, and ID", () => {
  const michaelTorres = [
    {
      id: "20992e6b-005e-42e1-9710-eaa294462de8",
      displayName: "Michael Torres",
      fullName: "Michael Torres",
      badgeNumber: "302",
      rankTitle: "Patrol Officer",
      unitName: "Patrol Division",
    },
    {
      id: "9d37a6ac-e685-4950-9424-8d52c6510978",
      displayName: "Michael Torres",
      fullName: "Michael Torres",
      badgeNumber: "227",
      rankTitle: "Officer",
      unitName: "Detective Bureau",
    },
  ];

  assert.deepEqual(
    filterOpenAttendanceOfficers(michaelTorres, "michael").map(
      (officer) => officer.id,
    ),
    [
      "20992e6b-005e-42e1-9710-eaa294462de8",
      "9d37a6ac-e685-4950-9424-8d52c6510978",
    ],
  );
  assert.equal(
    getOpenAttendanceOfficerLabel(michaelTorres[0]),
    "Michael Torres — #302 — Patrol Division",
  );
  assert.equal(
    getOpenAttendanceOfficerLabel(michaelTorres[1]),
    "Michael Torres — #227 — Detective Bureau",
  );
});
