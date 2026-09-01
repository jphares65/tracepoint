import { NextResponse } from "next/server";
import { createAgencyTrainingReadRepository } from "@/lib/agency-training/read-repository";

import {
  accessFailureResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export async function GET() {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const context = resolved.context;
  try {
    const instructors = await createAgencyTrainingReadRepository(context.admin, context.departmentId).listInstructors({ departmentId: context.departmentId });

    return NextResponse.json({ instructors }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Instructors could not be loaded." }, { status: 500 });
  }
}
