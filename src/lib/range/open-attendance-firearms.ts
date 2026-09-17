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
 * Returns unassigned, in-service Armory firearms for an explicitly requested
 * shared/range-day selection. It deliberately excludes firearms issued to
 * another officer and does not change permanent Armory custody.
 */
export function getOpenAttendanceSharedRangeFirearms({
  firearms,
  requiredFirearmType,
}: {
  firearms: OpenAttendanceFirearm[];
  requiredFirearmType?: string | null;
}) {
  return sortOpenAttendanceFirearms(
    firearms.filter(
      (firearm) =>
        isEligibleRangeDayFirearm(firearm) &&
        !firearm.active_assignment,
    ),
    requiredFirearmType,
  );
}

export function getOpenAttendanceFirearmOptions({
  firearms,
  officerId,
  requiredFirearmType,
}: {
  firearms: OpenAttendanceFirearm[];
  officerId: string;
  requiredFirearmType?: string | null;
}) {
  if (!officerId) {
    return { source: "assigned" as const, firearms: [] };
  }

  const assigned = getOpenAttendanceAssignedFirearms({
    firearms,
    officerId,
    requiredFirearmType,
  });

  return assigned.length > 0
    ? { source: "assigned" as const, firearms: assigned }
    : {
        source: "shared" as const,
        firearms: getOpenAttendanceSharedRangeFirearms({
          firearms,
          requiredFirearmType,
        }),
      };
}

export function getOpenAttendanceFirearmLabel(firearm: OpenAttendanceFirearm) {
  return `${firearm.make} ${firearm.model} — ${
    firearm.asset_number || firearm.serial_number
  }`;
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
