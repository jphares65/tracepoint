import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    firearmId: string;
  }>;
};

const VALID_STATUSES = [
  "In Service",
  "Out of Service",
  "Maintenance",
  "Inspection Required",
  "Retired",
] as const;

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

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { firearmId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    notes?: string;
  };

  if (!VALID_STATUSES.includes(body.status as any)) {
    return NextResponse.json(
      { error: "Invalid firearm status." },
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

    const nextStatus = body.status;

    const { error: updateError } = await admin
      .from("firearms")
      .update({
        condition_status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", firearmId)
      .eq("department_id", departmentId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    const { error: historyError } = await admin
      .from("firearm_status_history")
      .insert({
        department_id: departmentId,
        firearm_id: firearmId,
        old_status: firearm.condition_status,
        new_status: nextStatus,
        changed_by_user_id: user.id,
        notes: body.notes ?? null,
      });

    if (historyError) {
      throw new Error(historyError.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The firearm status could not be updated.",
      },
      { status: 500 },
    );
  }
}
