import { NextRequest, NextResponse } from "next/server";

import { PlatformAdminOperationError, resolvePlatformAdminAccess } from "@/lib/platform/admin-access";

type RequestBody = {
  departmentId?: string;
  userId?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;

    const departmentId = body.departmentId?.trim() ?? "";
    const userId = body.userId?.trim() ?? "";

    if (!departmentId || !userId) {
      return NextResponse.json(
        { error: "Department and user are required." },
        { status: 400 },
      );
    }

    const access = await resolvePlatformAdminAccess();
    if (!access.ok) {
      return NextResponse.json(
        { error: access.status === 401 ? "Authentication is required." : "Platform administrator access is required." },
        { status: access.status },
      );
    }
    await access.repository.assignAdministrator(departmentId, userId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PlatformAdminOperationError && error.code === "P0002") {
      return NextResponse.json({ error: "Department membership was not found." }, { status: 404 });
    }
    const message =
      error instanceof Error
        ? error.message
        : "Administrator role could not be assigned.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
