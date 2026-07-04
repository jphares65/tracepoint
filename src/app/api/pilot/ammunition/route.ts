import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type AmmunitionWorkspace = {
  dutyLots?: unknown[];
  trainingLots?: unknown[];
  transactions?: unknown[];
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

function normalizeWorkspace(value: unknown): Required<AmmunitionWorkspace> {
  const workspace =
    value && typeof value === "object" ? (value as AmmunitionWorkspace) : {};

  return {
    dutyLots: Array.isArray(workspace.dutyLots) ? workspace.dutyLots : [],
    trainingLots: Array.isArray(workspace.trainingLots)
      ? workspace.trainingLots
      : [],
    transactions: Array.isArray(workspace.transactions)
      ? workspace.transactions
      : [],
  };
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

    const { data, error } = await admin
      .from("pilot_ammunition_workspaces")
      .select("workspace, updated_at")
      .eq("department_id", departmentId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      departmentId,
      workspace: normalizeWorkspace(data?.workspace),
      updatedAt: data?.updated_at ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load ammunition workspace.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const { user, error: authError } = await getCurrentUser();

  if (authError || !user) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  let workspace: Required<AmmunitionWorkspace>;

  try {
    const payload = (await request.json()) as { workspace?: unknown };
    workspace = normalizeWorkspace(payload.workspace);
  } catch {
    return NextResponse.json(
      { error: "Invalid ammunition workspace payload." },
      { status: 400 },
    );
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

    const { error } = await admin
      .from("pilot_ammunition_workspaces")
      .upsert(
        {
          department_id: departmentId,
          workspace,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "department_id",
        },
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await admin.from("audit_events").insert({
      department_id: departmentId,
      actor_user_id: user.id,
      action: "pilot_ammunition_workspace_saved",
      entity_type: "pilot_ammunition_workspaces",
      entity_id: departmentId,
      summary: `Saved ammunition workspace with ${workspace.dutyLots.length} duty lot${
        workspace.dutyLots.length === 1 ? "" : "s"
      } and ${workspace.trainingLots.length} training lot${
        workspace.trainingLots.length === 1 ? "" : "s"
      }.`,
      previous_value: null,
      new_value: {
        duty_lot_count: workspace.dutyLots.length,
        training_lot_count: workspace.trainingLots.length,
        transaction_count: workspace.transactions.length,
      },
    });

    return NextResponse.json({
      message: "Ammunition workspace saved.",
      dutyLotCount: workspace.dutyLots.length,
      trainingLotCount: workspace.trainingLots.length,
      transactionCount: workspace.transactions.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save ammunition workspace.",
      },
      { status: 500 },
    );
  }
}
