export type OpenAttendanceFirearm = {
  id: string;
  make: string;
  model: string;
  serial_number: string;
  asset_number?: string | null;
  firearm_type?: string | null;
  condition_status?: string | null;
  is_active?: boolean;
  active_assignment?: {
    assigned_to_user_id: string;
    assigned_to_name?: string | null;
  } | null;
};

function normalizeFirearmType(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
}

function sortOpenAttendanceFirearms(
  firearms: OpenAttendanceFirearm[],
  requiredFirearmType?: string | null,
) {
  const requiredType = normalizeFirearmType(requiredFirearmType);

  return firearms.sort((left, right) => {
    const leftMatches =
      requiredType && normalizeFirearmType(left.firearm_type) === requiredType;
    const rightMatches =
      requiredType && normalizeFirearmType(right.firearm_type) === requiredType;

    if (leftMatches !== rightMatches) return leftMatches ? -1 : 1;

    return `${left.make} ${left.model}`.localeCompare(
      `${right.make} ${right.model}`,
    );
  });
}

function isEligibleRangeDayFirearm(firearm: OpenAttendanceFirearm) {
  return firearm.is_active !== false && firearm.condition_status === "In Service";
}

export function getOpenAttendanceAssignedFirearms({
  firearms,
  officerId,
  requiredFirearmType,
}: {
  firearms: OpenAttendanceFirearm[];
  officerId: string;
  requiredFirearmType?: string | null;
}) {
  return sortOpenAttendanceFirearms(
    firearms.filter(
      (firearm) =>
        isEligibleRangeDayFirearm(firearm) &&
        firearm.active_assignment?.assigned_to_user_id === officerId,
    ),
    requiredFirearmType,
  );
}

/**
 * Returns in-service Armory firearms that can be recorded for this range day
 * when the arriving officer has no active duty firearm. This does not change
 * Armory custody; the chosen ID is stored only on the range-day roster entry.
 */
export function getOpenAttendanceFallbackFirearms({
  firearms,
  officerId,
  requiredFirearmType,
}: {
  firearms: OpenAttendanceFirearm[];
  officerId: string;
  requiredFirearmType?: string | null;
}) {
  return sortOpenAttendanceFirearms(
    firearms.filter(
      (firearm) =>
        isEligibleRangeDayFirearm(firearm) &&
        firearm.active_assignment?.assigned_to_user_id !== officerId,
    ),
    requiredFirearmType,
  );
}

export function getOpenAttendanceFirearmLabel(firearm: OpenAttendanceFirearm) {
  return `${firearm.make} ${firearm.model} — ${
    firearm.asset_number || firearm.serial_number
  }`;
}

export function getOpenAttendanceFirearmCustodyLabel(
  firearm: OpenAttendanceFirearm,
) {
  return firearm.active_assignment?.assigned_to_name
    ? `Issued to ${firearm.active_assignment.assigned_to_name}`
    : firearm.active_assignment?.assigned_to_user_id
      ? "Issued to another officer"
      : "Unassigned range firearm";
}

export function getOpenAttendanceFirearmDefault(
  firearms: Pick<OpenAttendanceFirearm, "id">[],
) {
  return firearms.length === 1 ? firearms[0].id : "";
}

export function resolveOpenAttendanceFirearmSelection({
  currentFirearmId,
  firearms,
}: {
  currentFirearmId: string;
  firearms: Pick<OpenAttendanceFirearm, "id">[];
}) {
  return firearms.some((firearm) => firearm.id === currentFirearmId)
    ? currentFirearmId
    : getOpenAttendanceFirearmDefault(firearms);
}
