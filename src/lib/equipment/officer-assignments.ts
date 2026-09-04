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
