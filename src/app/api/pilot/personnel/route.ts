import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { createRangeReadRepository } from "@/lib/range/read-repository";

type PersonnelRecord = {
  id: string;
  userId: string;
  displayName: string;
  fullName: string;
  email: string | null;
  badgeNumber: string | null;
  rankTitle: string | null;
  unitName: string | null;
  employeeNumber: string | null;
  assignment: string;
  roles: string[];
  isActive: boolean;
};

function buildDisplayName(profile: any, membership: any) {
  const fullName = String(
    profile?.full_name ??
      profile?.email ??
      membership?.user_id ??
      "Unknown User",
  ).trim();

  const rankTitle = String(
    membership?.rank_title ?? "",
  ).trim();

  if (!rankTitle) return fullName;

  const lowerFullName = fullName.toLowerCase();
  const lowerRank = rankTitle.toLowerCase();

  if (lowerFullName.startsWith(`${lowerRank} `)) {
    return fullName;
  }

  return `${rankTitle} ${fullName}`;
}

function buildAssignment(
  membership: any,
  roleCodes: string[],
) {
  const unitName = String(
    membership?.unit_name ?? "",
  ).trim();

  if (unitName) return unitName;

  if (roleCodes.includes("range_master")) {
    return "Range Master";
  }

  if (roleCodes.includes("instructor")) {
    return "Firearms Instructor";
  }

  if (roleCodes.includes("armorer")) {
    return "Armory";
  }

  if (
    roleCodes.includes("command_staff") ||
    roleCodes.includes("chief")
  ) {
    return "Command";
  }

  if (roleCodes.includes("administrator")) {
    return "Administration";
  }

  return "Department Personnel";
}

export async function GET() {
  const access = await resolveServerAccess();

  if (!access.ok) {
    return accessFailureResponse(access);
  }

  const context = access.context;
  const admin = context.admin as any;
  const departmentId = context.departmentId;
  const canViewDepartment = hasAnyServerPermission(context, [
    "manage_users",
    "view_command_dashboard",
    "manage_range_days",
    "score_range_days",
    "manage_qualifications",
    "manage_training",
  ]);

  try {
    const readData = await createRangeReadRepository(admin, departmentId).getPersonnel(departmentId);
    const safeMemberships = canViewDepartment
      ? readData.memberships
      : readData.memberships.filter(
          (membership) => membership.user_id === context.userId,
        );
    const profilesById = new Map<string, any>();
    const rolesByUserId = new Map<string, string[]>();
      readData.profiles.forEach((profile: any) => {
        profilesById.set(profile.id, profile);
      });
      readData.roles.forEach((roleRow: any) => {
        const current =
          rolesByUserId.get(roleRow.user_id) ?? [];

        current.push(roleRow.role_code);
        rolesByUserId.set(roleRow.user_id, current);
      });

    const personnel: PersonnelRecord[] =
      safeMemberships.map((membership: any) => {
        const profile = profilesById.get(
          membership.user_id,
        );

        const roles =
          rolesByUserId.get(membership.user_id) ?? [];

        const displayName = buildDisplayName(
          profile,
          membership,
        );

        const fullName = String(
          profile?.full_name ??
            profile?.email ??
            membership.user_id,
        ).trim();

        return {
          id: membership.user_id,
          userId: membership.user_id,
          displayName,
          fullName,
          email: profile?.email ?? null,
          badgeNumber:
            membership.badge_number ?? null,
          rankTitle:
            membership.rank_title ?? null,
          unitName:
            membership.unit_name ?? null,
          employeeNumber:
            membership.employee_number ?? null,
          assignment: buildAssignment(
            membership,
            roles,
          ),
          roles,
          isActive: Boolean(membership.is_active),
        };
      });

    return NextResponse.json({
      departmentId,
      personnel,
      count: personnel.length,
      source: "supabase_department_memberships",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load pilot personnel.",
      },
      { status: 500 },
    );
  }
}
