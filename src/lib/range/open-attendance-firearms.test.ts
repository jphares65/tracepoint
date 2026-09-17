import assert from "node:assert/strict";
import test from "node:test";

import {
  getOpenAttendanceAssignedFirearms,
  getOpenAttendanceFirearmOptions,
  getOpenAttendanceSharedRangeFirearms,
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

test("uses the selected personnel ID against active_assignment.assigned_to_user_id", () => {
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

test("automatically falls back to unassigned shared/range firearms when no assignment exists", () => {
  assert.deepEqual(
    getOpenAttendanceSharedRangeFirearms({
      firearms,
      requiredFirearmType: "handgun",
    }).map((firearm) => firearm.id),
    ["range-handgun"],
  );
  assert.deepEqual(
    getOpenAttendanceFirearmOptions({
      firearms,
      officerId: "officer-3",
      requiredFirearmType: "handgun",
    }),
    {
      source: "shared",
      firearms: [firearms[5]],
    },
  );
});

test("does not expose a firearm until an officer has been selected", () => {
  assert.deepEqual(
    getOpenAttendanceFirearmOptions({ firearms, officerId: "" }),
    { source: "assigned", firearms: [] },
  );
});

test("keeps same-name officers isolated by active assignment user ID", () => {
  const michaelTorresFirearms = [
    {
      id: "abd6ca1d-79f2-4ebd-93be-3ecaee858412",
      make: "Glock",
      model: "17 Gen5",
      serial_number: "TPD-1005",
      asset_number: "FA-005",
      firearm_type: "handgun",
      condition_status: "In Service",
      is_active: true,
      active_assignment: {
        assigned_to_user_id: "20992e6b-005e-42e1-9710-eaa294462de8",
      },
    },
    {
      id: "shared-range-glock-45",
      make: "Glock",
      model: "45",
      serial_number: "TPD-G45-SP1",
      asset_number: "HG-SP1",
      firearm_type: "handgun",
      condition_status: "In Service",
      is_active: true,
      active_assignment: null,
    },
  ];

  const patrolTorres = getOpenAttendanceFirearmOptions({
    firearms: michaelTorresFirearms,
    officerId: "20992e6b-005e-42e1-9710-eaa294462de8",
  });
  const detectiveTorres = getOpenAttendanceFirearmOptions({
    firearms: michaelTorresFirearms,
    officerId: "9d37a6ac-e685-4950-9424-8d52c6510978",
  });

  assert.deepEqual(patrolTorres, {
    source: "assigned",
    firearms: [michaelTorresFirearms[0]],
  });
  assert.deepEqual(detectiveTorres, {
    source: "shared",
    firearms: [michaelTorresFirearms[1]],
  });
  assert.equal(
    detectiveTorres.firearms.some((firearm) => firearm.asset_number === "FA-005"),
    false,
  );
});
