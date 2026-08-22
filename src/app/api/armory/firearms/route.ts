import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

type ArmoryMember = {
  user_id: string;
  full_name: string;
  email: string;
  rank_title?: string | null;
  badge_number?: string | null;
};

type SupabaseAuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: {
    full_name?: string;
    name?: string;
    display_name?: string;
  } | null;
};

type ProfileRecord = {
  id: string;
  full_name?: string | null;
  email?: string | null;
};

const VALID_FIREARM_TYPES = [
  "handgun",
  "rifle",
  "shotgun",
  "less_lethal",
  "other",
] as const;

const VALID_STATUSES = [
  "In Service",
  "Out of Service",
  "Maintenance",
  "Inspection Required",
  "Retired",
] as const;

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getDisplayName(
  profile?: ProfileRecord | null,
  user?: SupabaseAuthUser | null,
) {
  const metadata = user?.user_metadata ?? {};

  return (
    profile?.full_name ||
    metadata.full_name ||
    metadata.name ||
    metadata.display_name ||
    profile?.email ||
    user?.email ||
    "Unknown User"
  );
}

async function getDepartmentMembers(
  admin: any,
  departmentId: string,
): Promise<ArmoryMember[]> {
  const { data: memberships, error } = await admin
    .from("department_memberships")
    .select("user_id,rank_title,badge_number")
    .eq("department_id", departmentId)
    .eq("is_active", true);

  if (error) throw new Error(error.message);

  const userIds = (memberships ?? [])
    .map((membership: any) => membership.user_id)
    .filter(Boolean);

  const profilesById = new Map<string, ProfileRecord>();

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("id,full_name,email")
      .in("id", userIds);

    if (profilesError) throw new Error(profilesError.message);

    (profiles ?? []).forEach((profile: ProfileRecord) => {
      profilesById.set(profile.id, profile);
    });
  }

  const { data: usersData, error: usersError } =
    await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

  if (usersError) throw new Error(usersError.message);

  const usersById = new Map<string, SupabaseAuthUser>(
    ((usersData?.users ?? []) as SupabaseAuthUser[]).map((user) => [
      user.id,
      user,
    ]),
  );

  return (memberships ?? [])
    .map((membership: any) => {
      const user = usersById.get(membership.user_id);
      const profile = profilesById.get(membership.user_id);

      return {
        user_id: membership.user_id,
        full_name: getDisplayName(profile, user),
        email: profile?.email ?? user?.email ?? "",
        rank_title: membership.rank_title ?? null,
        badge_number: membership.badge_number ?? null,
      };
    })
    .sort((left: ArmoryMember, right: ArmoryMember) =>
      left.full_name.localeCompare(right.full_name),
    );
}

function responseError(error: unknown, fallback: string) {
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : fallback,
    },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  const includeArchived =
    request.nextUrl.searchParams.get("includeArchived") === "true";

  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const context = resolved.context;

  const featureError = requireServerFeature(
    context,
    "firearms",
    "Firearms",
  );

  if (featureError) {
    return featureError;
  }
  const canViewAll = hasAnyServerPermission(context, [
    "manage_firearms",
    "manage_inspections",
    "view_command_dashboard",
  ]);
  const canManage = hasAnyServerPermission(context, ["manage_firearms"]);
  const canInspect = hasAnyServerPermission(context, [
    "manage_firearms",
    "manage_inspections",
  ]);

  try {
    let assignmentsQuery = context.admin
      .from("firearm_assignments")
      .select(
        "id,firearm_id,assigned_to_user_id,assigned_at,magazines_issued,magazine_description,magazines_returned,magazine_discrepancy_reason",
      )
      .eq("department_id", context.departmentId)
      .is("returned_at", null);

    if (!canViewAll) {
      assignmentsQuery = assignmentsQuery.eq(
        "assigned_to_user_id",
        context.userId,
      );
    }

    const { data: assignments, error: assignmentsError } =
      await assignmentsQuery;

    if (assignmentsError) {
      throw new Error(assignmentsError.message);
    }

    const firearmIds = Array.from(
      new Set(
        (assignments ?? [])
          .map((assignment: any) => assignment.firearm_id)
          .filter(Boolean),
      ),
    );

    let firearms: any[] = [];

    if (canViewAll || firearmIds.length > 0) {
      let firearmsQuery = context.admin
        .from("firearms")
        .select(
          "id,department_id,make,model,serial_number,firearm_type,caliber,asset_number,condition_status,notes,needs_attention,attention_reasons,is_active,archived_at,archived_by_user_id,archive_reason,created_at,updated_at",
        )
        .eq("department_id", context.departmentId)
        .order("make", { ascending: true })
        .order("model", { ascending: true });

      if (!includeArchived) {
        firearmsQuery = firearmsQuery.eq("is_active", true);
      }

      if (!canViewAll) {
        firearmsQuery = firearmsQuery.eq("is_active", true);
      }

      if (!canViewAll) {
        firearmsQuery = firearmsQuery.in("id", firearmIds);
      }

      const firearmsResult = await firearmsQuery;

      if (firearmsResult.error) {
        throw new Error(firearmsResult.error.message);
      }

      firearms = firearmsResult.data ?? [];
    }

    const members = await getDepartmentMembers(
      context.admin,
      context.departmentId,
    );
    const membersById = new Map(
      members.map((member) => [member.user_id, member]),
    );

    const assignmentsByFirearmId = new Map(
      (assignments ?? []).map((assignment: any) => [
        assignment.firearm_id,
        {
          ...assignment,
          assigned_to_name:
            membersById.get(assignment.assigned_to_user_id)?.full_name ??
            "Unknown User",
        },
      ]),
    );

    return NextResponse.json(
      {
        departmentId: context.departmentId,
        firearms: firearms.map((firearm: any) => ({
          ...firearm,
          condition_status: firearm.condition_status ?? "In Service",
          active_assignment:
            assignmentsByFirearmId.get(firearm.id) ?? null,
        })),
        members: canManage ? members : [],
        access: {
          canViewAll,
          canManage,
          canInspect,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return responseError(
      error,
      "The Armory records could not be loaded.",
    );
  }
}

export async function POST(request: NextRequest) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const context = resolved.context;

  const featureError = requireServerFeature(
    context,
    "firearms",
    "Firearms",
  );

  if (featureError) {
    return featureError;
  }

  if (!hasAnyServerPermission(context, ["manage_firearms"])) {
    return permissionDeniedResponse(
      "Firearm-management permission is required to add inventory.",
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    make?: string;
    model?: string;
    serialNumber?: string;
    firearmType?: string;
    caliber?: string;
    assetNumber?: string;
    conditionStatus?: string;
    notes?: string;
    assignedToUserId?: string;
  };

  const make = cleanText(body.make);
  const model = cleanText(body.model);
  const serialNumber = cleanText(body.serialNumber);
  const firearmType = cleanText(body.firearmType) ?? "handgun";
  const conditionStatus = cleanText(body.conditionStatus) ?? "In Service";
  const assignedToUserId = cleanText(body.assignedToUserId);

  if (!make || !model || !serialNumber) {
    return NextResponse.json(
      { error: "Make, model, and serial number are required." },
      { status: 400 },
    );
  }

  if (!VALID_FIREARM_TYPES.includes(firearmType as any)) {
    return NextResponse.json(
      { error: "Invalid firearm type." },
      { status: 400 },
    );
  }

  if (!VALID_STATUSES.includes(conditionStatus as any)) {
    return NextResponse.json(
      { error: "Invalid firearm status." },
      { status: 400 },
    );
  }

  try {
    if (assignedToUserId) {
      const { data: membership, error: membershipError } =
        await context.admin
          .from("department_memberships")
          .select("user_id")
          .eq("department_id", context.departmentId)
          .eq("user_id", assignedToUserId)
          .eq("is_active", true)
          .maybeSingle();

      if (membershipError) {
        throw new Error(membershipError.message);
      }

      if (!membership) {
        return NextResponse.json(
          {
            error:
              "The assigned officer is not an active department member.",
          },
          { status: 400 },
        );
      }

      if (conditionStatus !== "In Service") {
        return NextResponse.json(
          {
            error:
              "Only an in-service firearm may be assigned during import.",
          },
          { status: 409 },
        );
      }
    }

    const { data: existing, error: existingError } =
      await context.admin
        .from("firearms")
        .select("id")
        .eq("department_id", context.departmentId)
        .ilike("serial_number", serialNumber)
        .limit(1)
        .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existing) {
      return NextResponse.json(
        {
          error:
            "A firearm with this serial number already exists.",
        },
        { status: 409 },
      );
    }

    const { data: inserted, error: insertError } =
      await context.admin
        .from("firearms")
        .insert({
          department_id: context.departmentId,
          make,
          model,
          serial_number: serialNumber,
          firearm_type: firearmType,
          caliber: cleanText(body.caliber) ?? "TBD / Unknown",
          asset_number: cleanText(body.assetNumber),
          condition_status: conditionStatus,
          notes: cleanText(body.notes),
          is_active: true,
          created_by: context.userId,
        })
        .select("id")
        .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    if (assignedToUserId) {
      const { error: assignmentError } = await context.admin
        .from("firearm_assignments")
        .insert({
          department_id: context.departmentId,
          firearm_id: inserted.id,
          assigned_to_user_id: assignedToUserId,
          assigned_by_user_id: context.userId,
          assigned_at: new Date().toISOString(),
          condition_at_issue: conditionStatus,
          magazines_issued: 0,
        });

      if (assignmentError) {
        await context.admin
          .from("firearms")
          .delete()
          .eq("id", inserted.id)
          .eq("department_id", context.departmentId);

        throw new Error(
          `The firearm assignment could not be created: ${assignmentError.message}`,
        );
      }
    }

    return NextResponse.json(
      {
        ok: true,
        firearmId: inserted.id,
        assignmentCreated: Boolean(assignedToUserId),
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    return NextResponse.json(
      {
        error:
          message.toLowerCase().includes("duplicate") ||
          message.toLowerCase().includes("unique")
            ? "A firearm with this serial number already exists."
            : message || "The firearm could not be added.",
      },
      {
        status:
          message.toLowerCase().includes("duplicate") ||
          message.toLowerCase().includes("unique")
            ? 409
            : 500,
      },
    );
  }
}




