import { NextResponse } from "next/server";

import {
  createCurrentRulesRepository,
  mapCurrentRules,
} from "@/lib/department-rules/current-rules-repository";
import { resolveServerAccess } from "@/lib/tracepoint/server-access";


export async function GET() {
  const access = await resolveServerAccess();

  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }

  const { admin, departmentId, userId } = access.context;

  try {

    const rules = await createCurrentRulesRepository(admin, departmentId, userId)
      .getCurrentRules({ departmentId });

    return NextResponse.json({
      rules: mapCurrentRules(rules),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Department rules could not be loaded.",
      },
      { status: 500 },
    );
  }
}
