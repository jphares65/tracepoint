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
  } | null;
};

function normalizeFirearmType(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
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
  const requiredType = normalizeFirearmType(requiredFirearmType);

  return firearms
    .filter(
      (firearm) =>
        firearm.is_active !== false &&
        firearm.condition_status === "In Service" &&
        firearm.active_assignment?.assigned_to_user_id === officerId,
    )
    .sort((left, right) => {
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
