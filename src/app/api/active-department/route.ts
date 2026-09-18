import { NextRequest, NextResponse } from "next/server";

import { createActiveDepartmentReadRepository } from "@/lib/active-department/read-repository";
import type { ActiveDepartmentClient } from "@/lib/active-department/read-repository-supabase";
import { resolveAuthenticatedPrincipal } from "@/lib/authentication/request-session";
import type { AuthenticatedPrincipal } from "@/lib/authentication/request-session-core";
import { listPostgresMemberships } from "@/lib/tracepoint/server-access-postgres";

export const dynamic = "force-dynamic";

type MembershipRow={department_id?:string|null;badge_number?:string|null;rank_title?:string|null;unit_name?:string|null;departments?:{name?:string|null;short_name?:string|null;patch_url?:string|null}|null};
const membershipPayload=(row:MembershipRow)=>({departmentId:String(row.department_id??""),departmentName:row.departments?.name??row.departments?.short_name??"TracePoint Agency",departmentShortName:row.departments?.short_name??row.departments?.name??"TracePoint",departmentPatchUrl:row.departments?.patch_url??"",badgeNumber:row.badge_number??"",rankTitle:row.rank_title??"",unitName:row.unit_name??""});

async function getAuthenticatedUser() {
  if (process.env.TRACEPOINT_DATA_PROVIDER === "postgres") return resolveAuthenticatedPrincipal();
  const { createClient: createServerClient } = await import("@/lib/supabase/server");
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

  if (process.env.TRACEPOINT_DATA_PROVIDER === "postgres") {
    try {
      const memberships = await listPostgresMemberships(user as AuthenticatedPrincipal);
      return NextResponse.json({memberships:(memberships as MembershipRow[]).map(membershipPayload)},{headers:{"Cache-Control":"no-store"}});
    } catch { return NextResponse.json({error:"Department memberships could not be loaded."},{status:500}); }
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const userId = "id" in user ? user.id : user.userId;

  let memberships;
  try { memberships = await createActiveDepartmentReadRepository(admin as unknown as ActiveDepartmentClient, userId).listMemberships(userId); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Department memberships could not be loaded." }, { status: 500 }); }

  return NextResponse.json(
    {
      memberships: (memberships as MembershipRow[]).map((row) => ({
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

  if (process.env.TRACEPOINT_DATA_PROVIDER === "postgres") {
    let memberships;
    try { memberships = await listPostgresMemberships(user as AuthenticatedPrincipal); }
    catch { return NextResponse.json({error:"Department membership could not be verified."},{status:500}); }
    if (!(memberships as MembershipRow[]).some((row)=>row.department_id===departmentId)) return NextResponse.json({error:"You do not have an active membership in that agency."},{status:403});
    const response=NextResponse.json({ok:true,departmentId},{headers:{"Cache-Control":"no-store"}});
    response.cookies.set("tracepoint_department_id",departmentId,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:60*60*24*30});
    return response;
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const userId = "id" in user ? user.id : user.userId;

  const { data: membership, error: membershipError } = await admin
    .from("department_memberships")
    .select("department_id")
    .eq("user_id", userId)
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
