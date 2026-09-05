import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { isTracePointPermission } from "@/lib/tracepoint/permissions";

export async function POST(request: NextRequest) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const context = resolved.context;
  if (!context.isSupportMode && !hasServerPermission(context, "administer_department")) {
    return permissionDeniedResponse("Department administration permission is required to change the role matrix.");
  }

  const body = (await request.json().catch(() => ({}))) as {
    departmentId?: unknown;
    roleCode?: unknown;
    permissionCodes?: unknown;
  };
  const departmentId = typeof body.departmentId === "string" ? body.departmentId.trim() : "";
  const roleCode = typeof body.roleCode === "string" ? body.roleCode.trim() : "";
  const permissionCodes = Array.isArray(body.permissionCodes)
    ? Array.from(new Set(body.permissionCodes.filter(isTracePointPermission))).sort()
    : [];

  if (!departmentId || departmentId !== context.departmentId) {
    return permissionDeniedResponse("The selected department does not match the authorized department context.");
  }
  if (!roleCode || !Array.isArray(body.permissionCodes) || permissionCodes.length !== body.permissionCodes.length) {
    return NextResponse.json({ error: "A valid role and permission list are required." }, { status: 400 });
  }

  const { data, error } = await context.authDb.rpc("set_department_role_permissions", {
    p_department_id: departmentId,
    p_role_code: roleCode,
    p_permission_codes: permissionCodes,
  });

  if (error) {
    const denied = error.code === "42501";
    return NextResponse.json(
      { error: denied ? "You do not have permission to change this role matrix." : "The role permission matrix could not be saved." },
      { status: denied ? 403 : 500 },
    );
  }

  const persisted = Array.isArray(data) ? data.map(String).sort() : [];
  if (persisted.length !== permissionCodes.length || persisted.some((code, index) => code !== permissionCodes[index])) {
    return NextResponse.json({ error: "The saved permissions could not be verified. No success was reported." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, permissionCodes: persisted }, { headers: { "Cache-Control": "no-store" } });
}
