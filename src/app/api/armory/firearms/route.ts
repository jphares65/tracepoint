import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

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

function getUserDisplayName(user?: SupabaseAuthUser | null) {
  const metadata = user?.user_metadata ?? {};

  return (
    metadata.full_name ||
    metadata.name ||
    metadata.display_name ||
    user?.email ||
    "Unknown User"
  );
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function getCurrentUser() {
  const supabase = await createServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { user: null, error: "You must be signed in to use Armory." };
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

  if (error) {
    throw new Error(error.message);
  }

  return data?.department_id ?? null;
}

async function getDepartmentMembers(
  admin: any,
  departmentId: string,
): Promise<ArmoryMember[]> {
  const { data: memberships, error } = await admin
    .from("department_memberships")
    .select("user_id")
    .eq("department_id", departmentId)
    .eq("is_active", true)
    .order("user_id", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const memberIds = new Set<string>(
    (memberships ?? [])
      .map((membership: { user_id?: string | null }) => membership.user_id)
      .filter((userId: string | null | undefined): userId is string =>
        Boolean(userId),
      ),
  );

  const { data: usersData, error: usersError } =
    await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

  if (usersError) {
    throw new Error(usersError.message);
  }

  const usersById = new Map<string, SupabaseAuthUser>(
    ((usersData?.users ?? []) as SupabaseAuthUser[]).map((user) => [
      user.id,
      user,
    ]),
  );

  return Array.from(memberIds)
    .map((userId) => {
      const user = usersById.get(userId);

      return {
        user_id: userId,
        full_name: getUserDisplayName(user),
        email: user?.email ?? "",
        rank_title: null,
        badge_number: null,
      };
    })
    .sort((left, right) => left.full_name.localeCompare(right.full_name));
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
        { error: "No active department membership was found for this user." },
        { status: 403 },
      );
    }

    const [firearmsResult, assignmentsResult, members] = await Promise.all([
      admin
        .from("firearms")
        .select(
          "id, department_id, make, model, serial_number, firearm_type, caliber, asset_number, condition_status, notes, is_active, created_at, updated_at",
        )
        .eq("department_id", departmentId)
        .eq("is_active", true)
        .order("make", { ascending: true })
        .order("model", { ascending: true }),

      admin
        .from("firearm_assignments")
        .select("id, firearm_id, assigned_to_user_id, assigned_at")
        .eq("department_id", departmentId)
        .is("returned_at", null),

      getDepartmentMembers(admin, departmentId),
    ]);

    if (firearmsResult.error) {
      throw new Error(firearmsResult.error.message);
    }

    if (assignmentsResult.error) {
      throw new Error(assignmentsResult.error.message);
    }

    const membersById = new Map(
      members.map((member) => [member.user_id, member]),
    );

    const assignmentsByFirearmId = new Map(
      (assignmentsResult.data ?? []).map((assignment: any) => [
        assignment.firearm_id,
        {
          id: assignment.id,
          assigned_to_user_id: assignment.assigned_to_user_id,
          assigned_to_name:
            membersById.get(assignment.assigned_to_user_id)?.full_name ??
            "Unknown User",
          assigned_at: assignment.assigned_at,
        },
      ]),
    );

    const firearms = (firearmsResult.data ?? []).map((firearm: any) => ({
      ...firearm,
      condition_status: firearm.condition_status ?? "In Service",
      active_assignment: assignmentsByFirearmId.get(firearm.id) ?? null,
    }));

    return NextResponse.json({
      departmentId,
      firearms,
      members,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The Armory records could not be loaded.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const { user, error: authError } = await getCurrentUser();

  if (authError || !user) {
    return NextResponse.json({ error: authError }, { status: 401 });
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
  };

  const make = cleanText(body.make);
  const model = cleanText(body.model);
  const serialNumber = cleanText(body.serialNumber);
  const firearmType = cleanText(body.firearmType) ?? "handgun";
  const conditionStatus = cleanText(body.conditionStatus) ?? "In Service";

  if (!make) {
    return NextResponse.json(
      { error: "Make is required." },
      { status: 400 },
    );
  }

  if (!model) {
    return NextResponse.json(
      { error: "Model is required." },
      { status: 400 },
    );
  }

  if (!serialNumber) {
    return NextResponse.json(
      { error: "Serial number is required." },
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
    const admin = createAdminClient() as any;
    const departmentId = await getActiveDepartmentId(admin, user.id);

    if (!departmentId) {
      return NextResponse.json(
        { error: "No active department membership was found for this user." },
        { status: 403 },
      );
    }

    const { data: existingFirearm, error: existingError } = await admin
      .from("firearms")
      .select("id")
      .eq("department_id", departmentId)
      .ilike("serial_number", serialNumber)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existingFirearm) {
      return NextResponse.json(
        { error: "A firearm with this serial number already exists." },
        { status: 409 },
      );
    }

    const { data: insertedFirearm, error: insertError } = await admin
      .from("firearms")
      .insert({
        department_id: departmentId,
        make,
        model,
        serial_number: serialNumber,
        firearm_type: firearmType,
        caliber: cleanText(body.caliber),
        asset_number: cleanText(body.assetNumber),
        condition_status: conditionStatus,
        notes: cleanText(body.notes),
        is_active: true,
      })
      .select("id")
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    return NextResponse.json(
      {
        ok: true,
        firearmId: insertedFirearm?.id,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The firearm could not be added.",
      },
      { status: 500 },
    );
  }
}
