import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type StoredRangeDayWorkspace = {
  rangeDays?: unknown[];
  drillLibrary?: unknown[];
  rangeDayDrills?: unknown[];
  rangeRoster?: unknown[];
  results?: unknown[];
  malfunctions?: unknown[];
};

function normalizeWorkspace(value: unknown): StoredRangeDayWorkspace {
  const workspace =
    value && typeof value === "object"
      ? (value as StoredRangeDayWorkspace)
      : {};

  return {
    rangeDays: Array.isArray(workspace.rangeDays)
      ? workspace.rangeDays
      : [],
    drillLibrary: Array.isArray(workspace.drillLibrary)
      ? workspace.drillLibrary
      : [],
    rangeDayDrills: Array.isArray(workspace.rangeDayDrills)
      ? workspace.rangeDayDrills
      : [],
    rangeRoster: Array.isArray(workspace.rangeRoster)
      ? workspace.rangeRoster
      : [],
    results: Array.isArray(workspace.results)
      ? workspace.results
      : [],
    malfunctions: Array.isArray(workspace.malfunctions)
      ? workspace.malfunctions
      : [],
  };
}

async function getCurrentUser() {
  const supabase = await createServerClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { user: null, error: "You must be signed in to use pilot data sync." };
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

    const { data, error } = await admin
      .from("pilot_range_workspaces")
      .select("department_id, workspace, updated_at, updated_by_user_id")
      .eq("department_id", departmentId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      departmentId,
      workspace: data?.workspace ?? null,
      updatedAt: data?.updated_at ?? null,
      updatedByUserId: data?.updated_by_user_id ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The pilot range workspace could not be loaded.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const { user, error: authError } = await getCurrentUser();

  if (authError || !user) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    workspace?: unknown;
  };

  const workspace = normalizeWorkspace(body.workspace);

  try {
    const admin = createAdminClient() as any;
    const departmentId = await getActiveDepartmentId(admin, user.id);

    if (!departmentId) {
      return NextResponse.json(
        { error: "No active department membership was found for this user." },
        { status: 403 },
      );
    }

    const { error } = await admin.from("pilot_range_workspaces").upsert(
      {
        department_id: departmentId,
        workspace,
        updated_by_user_id: user.id,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "department_id",
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      ok: true,
      departmentId,
      counts: {
        rangeDays: workspace.rangeDays?.length ?? 0,
        drillLibrary: workspace.drillLibrary?.length ?? 0,
        rangeDayDrills: workspace.rangeDayDrills?.length ?? 0,
        rangeRoster: workspace.rangeRoster?.length ?? 0,
        results: workspace.results?.length ?? 0,
        malfunctions: workspace.malfunctions?.length ?? 0,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The pilot range workspace could not be saved.",
      },
      { status: 500 },
    );
  }
}




