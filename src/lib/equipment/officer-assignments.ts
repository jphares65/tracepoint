export type OfficerAssignmentMember = { userId: string };

export type CurrentOfficerAsset = {
  assigned_user_id?: string | null;
  lifecycle_status: string;
};

export function groupCurrentOfficerAssignments<TAsset extends CurrentOfficerAsset>(
  members: OfficerAssignmentMember[],
  assets: TAsset[],
) {
  const activeMemberIds = new Set(members.map((member) => member.userId));
  const assignments = new Map<string, TAsset[]>();

  for (const asset of assets) {
    const userId = asset.assigned_user_id?.trim();
    if (!userId || asset.lifecycle_status === "removed" || !activeMemberIds.has(userId)) continue;
    assignments.set(userId, [...(assignments.get(userId) ?? []), asset]);
  }

  return assignments;
}

// A separated (inactive) member keeps custody until the item is returned or
// removed, so the holder is shown by name and marked, never as "Unassigned".
export type EquipmentHolder = OfficerAssignmentMember & { fullName: string; isActive?: boolean };

export function equipmentHolderName(holder: EquipmentHolder) {
  return holder.isActive === false ? `${holder.fullName} (inactive)` : holder.fullName;
}

export function equipmentCustodyLabel(
  asset: { assigned_user_id?: string | null; assigned_vehicle_id?: string | null; assigned_location?: string | null },
  holders: Map<string, EquipmentHolder>,
  vehicles: Map<string, { unit_number: string }>,
) {
  if (asset.assigned_user_id) {
    const holder = holders.get(asset.assigned_user_id);
    return holder ? equipmentHolderName(holder) : "Unrecognized holder";
  }
  if (asset.assigned_vehicle_id) {
    const vehicle = vehicles.get(asset.assigned_vehicle_id);
    return vehicle ? `Vehicle ${vehicle.unit_number}` : "Assigned vehicle";
  }
  return asset.assigned_location ?? "Unassigned";
}
