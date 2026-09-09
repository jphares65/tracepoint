import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { createOperationsReadRepository } from "@/lib/operations/read-repository";
import {
  createCurrentRulesRepository,
  mapCurrentRules,
} from "@/lib/department-rules/current-rules-repository";
import { buildCommandOperationsPresentation } from "@/lib/tracepoint/command-operations";

export const dynamic = "force-dynamic";

function missingTable(error: unknown) {
  const candidate = error && typeof error === "object"
    ? error as { code?: unknown; message?: unknown }
    : {};
  const message = String(candidate.message ?? "").toLowerCase();
  return (
    candidate.code === "42P01" ||
    candidate.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

export async function GET() {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const context = resolved.context;
  if (
    !hasAnyServerPermission(context, [
      "view_command_dashboard",
      "administer_department",
    ])
  ) {
    return permissionDeniedResponse("Command Dashboard permission is required.");
  }

  const [[trainingResult, fleetResult], rulesRow] = await Promise.all([
    createOperationsReadRepository(context.admin, context.departmentId, context.userId)
      .getCommandDashboard(context.departmentId),
    createCurrentRulesRepository(context.admin, context.departmentId, context.userId)
      .getCurrentRules({ departmentId: context.departmentId }),
  ]);

  if (trainingResult.error && !missingTable(trainingResult.error)) {
    return NextResponse.json({ error: trainingResult.error.message }, { status: 500 });
  }
  if (fleetResult.error && !missingTable(fleetResult.error)) {
    return NextResponse.json({ error: fleetResult.error.message }, { status: 500 });
  }

  const configuration = mapCurrentRules(rulesRow).analytics_dashboard;
  const presentation = buildCommandOperationsPresentation(
    trainingResult,
    fleetResult,
    configuration,
  );

  return NextResponse.json(
    {
      ...presentation,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
