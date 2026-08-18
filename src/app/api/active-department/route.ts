import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function getAuthenticatedUser() {
  const server = await createServerClient();

  const {
    data: { user },
    error,
  } = await server.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

export async function GET() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentication is required." },
      { status: 401 },
    );
  }

  const admin = createAdminClient() as any;

  const { data: memberships, error } = await admin
    .from("department_memberships")
    .select(
      "department_id,badge_number,rank_title,unit_name,departments(name,short_name,patch_url)",
    )
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      memberships: (memberships ?? []).map((row: any) => ({
        departmentId: String(row.department_id ?? ""),
        departmentName:
          row.departments?.name ??
          row.departments?.short_name ??
          "TracePoint Agency",
        departmentShortName:
          row.departments?.short_name ??
          row.departments?.name ??
          "TracePoint",
        departmentPatchUrl: row.departments?.patch_url ?? "",
        badgeNumber: row.badge_number ?? "",
        rankTitle: row.rank_title ?? "",
        unitName: row.unit_name ?? "",
      })),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentication is required." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => ({}));

  const departmentId =
    typeof body.departmentId === "string"
      ? body.departmentId.trim()
      : "";

  if (!departmentId) {
    return NextResponse.json(
      { error: "departmentId is required." },
      { status: 400 },
    );
  }

  const admin = createAdminClient() as any;

  const { data: membership, error: membershipError } = await admin
    .from("department_memberships")
    .select("department_id")
    .eq("user_id", user.id)
    .eq("department_id", departmentId)
    .eq("is_active", true)
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json(
      { error: membershipError.message },
      { status: 500 },
    );
  }

  if (!membership) {
    return NextResponse.json(
      { error: "You do not have an active membership in that agency." },
      { status: 403 },
    );
  }

  const response = NextResponse.json(
    {
      ok: true,
      departmentId,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );

  response.cookies.set(
    "tracepoint_department_id",
    departmentId,
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    },
  );

  return response;
}

export async function DELETE() {
  const response = NextResponse.json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );

  response.cookies.set(
    "tracepoint_department_id",
    "",
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    },
  );

  return response;
}
