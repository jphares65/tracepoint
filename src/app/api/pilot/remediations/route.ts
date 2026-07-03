import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type RemediationPayload = {
  remediations?: unknown;
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

function normalizeRemediations(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export async function GET() {
  const { user, error: authError } = await getCurrentUser();

  if (authError || !user) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const departmentId = await getActiveDepartmentId(admin, user.id);

    if (!departmentId) {
      return NextResponse.json(
        { error: "No active department membership found." },
        { status: 404 },
      );
    }

    const { data, error } = await admin
      .from("pilot_remediation_workspaces")
      .select("remediations, updated_at")
      .eq("department_id", departmentId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      remediations: normalizeRemediations(data?.remediations),
      updatedAt: data?.updated_at ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load remediation records.",
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

  let payload: RemediationPayload;

  try {
    payload = (await request.json()) as RemediationPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid remediation payload." },
      { status: 400 },
    );
  }

  const remediations = normalizeRemediations(payload.remediations);

  try {
    const admin = createAdminClient();
    const departmentId = await getActiveDepartmentId(admin, user.id);

    if (!departmentId) {
      return NextResponse.json(
        { error: "No active department membership found." },
        { status: 404 },
      );
    }

    const { error } = await admin
      .from("pilot_remediation_workspaces")
      .upsert(
        {
          department_id: departmentId,
          remediations,
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
      action: "pilot_remediations_saved",
      entity_type: "pilot_remediation_workspaces",
      entity_id: departmentId,
      summary: `Saved ${remediations.length} pilot remediation record${
        remediations.length === 1 ? "" : "s"
      }.`,
      previous_value: null,
      new_value: {
        remediation_count: remediations.length,
      },
    });

    return NextResponse.json({
      message: "Remediation records saved.",
      remediationCount: remediations.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save remediation records.",
      },
      { status: 500 },
    );
  }
}
