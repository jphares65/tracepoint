import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function dateOrNull(value: unknown) {
  const result = text(value);
  return result || null;
}

function reminderDays(value: unknown) {
  if (!Array.isArray(value)) return [180, 90, 60, 30, 14, 7, 0];
  return [...new Set(value.map(Number).filter((item) => Number.isInteger(item) && item >= 0 && item <= 730))]
    .sort((a, b) => b - a);
}

async function getContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in.", status: 401 } as const;

  const admin = createAdminClient() as any;
  const { data: membership, error } = await admin
    .from("department_memberships")
    .select("department_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) return { error: error.message, status: 500 } as const;
  if (!membership?.department_id) return { error: "No active department membership was found.", status: 403 } as const;

  const departmentId = String(membership.department_id);
  const [{ data: allowed }, { data: administrator }, { data: roles }] =
    await Promise.all([
      admin.rpc("has_department_permission", {
        p_department_id: departmentId,
        p_permission_code: "manage_qualifications",
      }),
      admin.rpc("has_department_permission", {
        p_department_id: departmentId,
        p_permission_code: "administer_department",
      }),
      admin
        .from("department_membership_roles")
        .select("role_code")
        .eq("department_id", departmentId)
        .eq("user_id", user.id),
    ]);

  const roleCodes = (roles ?? []).map((row: any) =>
    String(row.role_code).toLowerCase(),
  );

  const canManageByRole = roleCodes.some((role: string) =>
    [
      "chief",
      "administrator",
      "department_admin",
      "admin",
      "range_master",
      "instructor",
      "training_officer",
    ].includes(role),
  );

  return {
    admin,
    user,
    departmentId,
    canManage: Boolean(allowed || administrator || canManageByRole),
  } as const;
}

export async function GET() {
  const context = await getContext();
  if ("error" in context) return NextResponse.json({ error: context.error }, { status: context.status });

  const [{ data: certifications, error }, { data: members, error: memberError }] = await Promise.all([
    context.admin
      .from("training_certifications")
      .select("*")
      .eq("department_id", context.departmentId)
      .eq("is_active", true)
      .order("expiration_date", { ascending: true, nullsFirst: false }),
    context.admin.rpc("get_department_members", { p_department_id: context.departmentId }),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (memberError) return NextResponse.json({ error: memberError.message }, { status: 500 });

  return NextResponse.json({ certifications: certifications ?? [], members: members ?? [], canManage: context.canManage });
}

export async function POST(request: NextRequest) {
  const context = await getContext();
  if ("error" in context) return NextResponse.json({ error: context.error }, { status: context.status });
  if (!context.canManage) return NextResponse.json({ error: "You do not have permission to manage certifications." }, { status: 403 });

  const body = await request.json().catch(() => ({})) as any;
  const title = text(body.certificationTitle);
  const userId = text(body.userId);
  if (!title || !userId) return NextResponse.json({ error: "Officer and certification title are required." }, { status: 400 });

  const { data, error } = await context.admin.from("training_certifications").insert({
    department_id: context.departmentId,
    user_id: userId,
    certification_title: title,
    issuing_organization: text(body.issuingOrganization) || null,
    credential_number: text(body.credentialNumber) || null,
    issue_date: dateOrNull(body.issueDate),
    expiration_date: dateOrNull(body.expirationDate),
    reminder_days: reminderDays(body.reminderDays),
    document_url: text(body.documentUrl) || null,
    notes: text(body.notes) || null,
    created_by_user_id: context.user.id,
    updated_by_user_id: context.user.id,
  }).select("*").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ certification: data }, { status: 201 });
}

