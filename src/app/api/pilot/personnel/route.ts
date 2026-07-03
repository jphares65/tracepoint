import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

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

async function getCurrentUser() {
  const supabase = await createServerClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { user: null, error: "You must be signed in." };
  }

  return { user, error: null };
}

async function getActiveDepartmentId(admin: any, userId: string) {
  const { data, error } = await admin
    .from("department_memberships")
    .select("department_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data?.department_id ?? null;
}

function buildDisplayName(profile: any, membership: any) {
  const fullName = String(
    profile?.full_name ?? profile?.email ?? membership?.user_id ?? "Unknown User",
  ).trim();

  const rankTitle = String(membership?.rank_title ?? "").trim();

  if (!rankTitle) return fullName;

  const lowerFullName = fullName.toLowerCase();
  const lowerRank = rankTitle.toLowerCase();

  if (lowerFullName.startsWith(`${lowerRank} `)) return fullName;

  return `${rankTitle} ${fullName}`;
}

function buildAssignment(membership: any, roleCodes: string[]) {
  const unitName = String(membership?.unit_name ?? "").trim();

  if (unitName) return unitName;

  if (roleCodes.includes("range_master")) return "Range Master";
  if (roleCodes.includes("instructor")) return "Firearms Instructor";
  if (roleCodes.includes("armorer")) return "Armory";
  if (roleCodes.includes("command_staff") || roleCodes.includes("chief")) {
    return "Command";
  }
  if (roleCodes.includes("administrator")) return "Administration";

  return "Department Personnel";
}

export async function GET() {
  const { user, error: authError } = await getCurrentUser();

  if (authError || !user) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  try {
    const admin = createAdminClient() as any;
    const departmentId = await getActiveDepartmentId(admin, user.id);

    if (!departmentId) {
      return NextResponse.json(
        { error: "No active department membership found." },
        { status: 404 },
      );
    }

    const { data: memberships, error: membershipError } = await admin
      .from("department_memberships")
      .select(
        "user_id, badge_number, rank_title, unit_name, employee_number, is_active, joined_at",
      )
      .eq("department_id", departmentId)
      .eq("is_active", true)
      .order("rank_title", { ascending: true })
      .order("joined_at", { ascending: true });

    if (membershipError) {
      return NextResponse.json({ error: membershipError.message }, { status: 500 });
    }

    const safeMemberships = Array.isArray(memberships) ? memberships : [];
    const userIds = safeMemberships
      .map((membership) => membership.user_id)
      .filter(Boolean);

    const profilesById = new Map<string, any>();
    const rolesByUserId = new Map<string, string[]>();

    if (userIds.length > 0) {
      const { data: profiles, error: profileError } = await admin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);

      if (profileError) {
        return NextResponse.json({ error: profileError.message }, { status: 500 });
      }

      (profiles ?? []).forEach((profile: any) => {
        profilesById.set(profile.id, profile);
      });

      const { data: roleRows, error: roleError } = await admin
        .from("department_membership_roles")
        .select("user_id, role_code")
        .eq("department_id", departmentId)
        .in("user_id", userIds);

      if (roleError) {
        return NextResponse.json({ error: roleError.message }, { status: 500 });
      }

      (roleRows ?? []).forEach((roleRow: any) => {
        const current = rolesByUserId.get(roleRow.user_id) ?? [];
        current.push(roleRow.role_code);
        rolesByUserId.set(roleRow.user_id, current);
      });
    }

    const personnel: PersonnelRecord[] = safeMemberships.map((membership: any) => {
      const profile = profilesById.get(membership.user_id);
      const roles = rolesByUserId.get(membership.user_id) ?? [];
      const displayName = buildDisplayName(profile, membership);
      const fullName = String(
        profile?.full_name ?? profile?.email ?? membership.user_id,
      ).trim();

      return {
        id: membership.user_id,
        userId: membership.user_id,
        displayName,
        fullName,
        email: profile?.email ?? null,
        badgeNumber: membership.badge_number ?? null,
        rankTitle: membership.rank_title ?? null,
        unitName: membership.unit_name ?? null,
        employeeNumber: membership.employee_number ?? null,
        assignment: buildAssignment(membership, roles),
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
