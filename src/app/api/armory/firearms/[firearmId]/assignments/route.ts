import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    firearmId: string;
  }>;
};

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

async function ensureDepartmentMember(
  admin: any,
  departmentId: string,
  userId: string,
) {
  const { data, error } = await admin
    .from("department_memberships")
    .select("user_id")
    .eq("department_id", departmentId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { firearmId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    assignedToUserId?: string;
    notes?: string;
  };

  if (!body.assignedToUserId) {
    return NextResponse.json(
      { error: "Select an officer before assigning the firearm." },
      { status: 400 },
    );
  }

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

    const assignedUserIsMember = await ensureDepartmentMember(
      admin,
      departmentId,
      body.assignedToUserId,
    );

    if (!assignedUserIsMember) {
      return NextResponse.json(
        { error: "The selected officer is not an active department member." },
        { status: 400 },
      );
    }

    const { data: firearm, error: firearmError } = await admin
      .from("firearms")
      .select("id, department_id, condition_status")
      .eq("id", firearmId)
      .eq("department_id", departmentId)
      .maybeSingle();

    if (firearmError) {
      throw new Error(firearmError.message);
    }

    if (!firearm) {
      return NextResponse.json(
        { error: "Firearm not found for this department." },
        { status: 404 },
      );
    }

    const { data: existingAssignment, error: existingError } = await admin
      .from("firearm_assignments")
      .select("id")
      .eq("department_id", departmentId)
      .eq("firearm_id", firearmId)
      .is("returned_at", null)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existingAssignment) {
      return NextResponse.json(
        { error: "This firearm already has an active assignment." },
        { status: 409 },
      );
    }

    const { error: insertError } = await admin
      .from("firearm_assignments")
      .insert({
        department_id: departmentId,
        firearm_id: firearmId,
        assigned_to_user_id: body.assignedToUserId,
        assigned_by_user_id: user.id,
        assigned_at: new Date().toISOString(),
        condition_at_issue: firearm.condition_status ?? null,
        notes: body.notes ?? null,
      });

    if (insertError) {
      throw new Error(insertError.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The firearm could not be assigned.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(_request: NextRequest, context: RouteContext) {
  const { firearmId } = await context.params;
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

    const { data: firearm, error: firearmError } = await admin
      .from("firearms")
      .select("id, department_id, condition_status")
      .eq("id", firearmId)
      .eq("department_id", departmentId)
      .maybeSingle();

    if (firearmError) {
      throw new Error(firearmError.message);
    }

    if (!firearm) {
      return NextResponse.json(
        { error: "Firearm not found for this department." },
        { status: 404 },
      );
    }

    const { data: activeAssignment, error: activeError } = await admin
      .from("firearm_assignments")
      .select("id")
      .eq("department_id", departmentId)
      .eq("firearm_id", firearmId)
      .is("returned_at", null)
      .maybeSingle();

    if (activeError) {
      throw new Error(activeError.message);
    }

    if (!activeAssignment) {
      return NextResponse.json(
        { error: "This firearm does not have an active assignment." },
        { status: 409 },
      );
    }

    const { error: updateError } = await admin
      .from("firearm_assignments")
      .update({
        returned_by_user_id: user.id,
        returned_at: new Date().toISOString(),
        condition_at_return: firearm.condition_status ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", activeAssignment.id)
      .eq("department_id", departmentId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The firearm could not be returned.",
      },
      { status: 500 },
    );
  }
}
