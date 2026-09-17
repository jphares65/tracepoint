import assert from "node:assert/strict";
import test from "node:test";

import {
  getOpenAttendanceAssignedFirearms,
  getOpenAttendanceFallbackFirearms,
  getOpenAttendanceFirearmCustodyLabel,
  getOpenAttendanceFirearmDefault,
  getOpenAttendanceFirearmLabel,
  resolveOpenAttendanceFirearmSelection,
} from "./open-attendance-firearms.ts";

const firearms = [
  {
    id: "handgun-1",
    make: "Glock",
    model: "45",
    serial_number: "G45-123",
    asset_number: "HG-123",
    firearm_type: "handgun",
    condition_status: "In Service",
    is_active: true,
    active_assignment: { assigned_to_user_id: "officer-1" },
  },
  {
    id: "rifle-1",
    make: "Colt",
    model: "M4",
    serial_number: "M4-201",
    asset_number: "FA-201",
    firearm_type: "rifle",
    condition_status: "In Service",
    is_active: true,
    active_assignment: { assigned_to_user_id: "officer-1" },
  },
  {
    id: "retired",
    make: "Glock",
    model: "17",
    serial_number: "OLD-1",
    firearm_type: "handgun",
    condition_status: "Retired",
    is_active: true,
    active_assignment: { assigned_to_user_id: "officer-1" },
  },
  {
    id: "archived",
    make: "Glock",
    model: "19",
    serial_number: "OLD-2",
    firearm_type: "handgun",
    condition_status: "In Service",
    is_active: false,
    active_assignment: { assigned_to_user_id: "officer-1" },
  },
  {
    id: "other-officer",
    make: "Glock",
    model: "43",
    serial_number: "OTHER-1",
    firearm_type: "handgun",
    condition_status: "In Service",
    is_active: true,
    active_assignment: {
      assigned_to_user_id: "officer-2",
      assigned_to_name: "Officer Two",
    },
  },
  {
    id: "range-handgun",
    make: "SIG Sauer",
    model: "P320",
    serial_number: "P320-9",
    asset_number: "RG-09",
    firearm_type: "handgun",
    condition_status: "In Service",
    is_active: true,
    active_assignment: null,
  },
];

test("returns only current in-service firearms assigned to the selected officer", () => {
  assert.deepEqual(
    getOpenAttendanceAssignedFirearms({
      firearms,
      officerId: "officer-1",
    }).map((firearm) => firearm.id),
    ["rifle-1", "handgun-1"],
  );
});

test("prioritizes an assigned firearm that matches the active drill type", () => {
  assert.deepEqual(
    getOpenAttendanceAssignedFirearms({
      firearms,
      officerId: "officer-1",
      requiredFirearmType: "handgun",
    }).map((firearm) => firearm.id),
    ["handgun-1", "rifle-1"],
  );
});

test("auto-selects only a single valid firearm and uses an operational label", () => {
  const multipleFirearms = getOpenAttendanceAssignedFirearms({
    firearms,
    officerId: "officer-1",
  });
  const singleFirearm = getOpenAttendanceAssignedFirearms({
    firearms: [firearms[0]],
    officerId: "officer-1",
  });

  assert.equal(getOpenAttendanceFirearmDefault(multipleFirearms), "");
  assert.equal(getOpenAttendanceFirearmDefault(singleFirearm), "handgun-1");
  assert.equal(getOpenAttendanceFirearmLabel(firearms[0]), "Glock 45 — HG-123");
});

test("changing officers clears a firearm that is not assigned to the new officer", () => {
  assert.equal(
    resolveOpenAttendanceFirearmSelection({
      currentFirearmId: "handgun-1",
      firearms: [{ id: "rifle-1" }],
    }),
    "rifle-1",
  );
  assert.equal(
    resolveOpenAttendanceFirearmSelection({
      currentFirearmId: "handgun-1",
      firearms: [
        { id: "rifle-1" },
        { id: "rifle-2" },
      ],
    }),
    "",
  );
});

test("offers eligible range-day firearms when an arriving officer has no assigned firearm", () => {
  assert.deepEqual(
    getOpenAttendanceFallbackFirearms({
      firearms,
      officerId: "officer-3",
      requiredFirearmType: "handgun",
    }).map((firearm) => firearm.id),
    ["other-officer", "handgun-1", "range-handgun", "rifle-1"],
  );
  assert.equal(
    getOpenAttendanceFirearmCustodyLabel(firearms[4]),
    "Issued to Officer Two",
  );
  assert.equal(
    getOpenAttendanceFirearmCustodyLabel(firearms[5]), "Unassigned range firearm");
});
