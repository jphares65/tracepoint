import { NextResponse } from "next/server";

import {
  createQualificationHistoryRepository,
  mapQualificationHistoryRows,
} from "@/lib/qualifications/history-repository";
import { resolveServerAccess } from "@/lib/tracepoint/server-access";

export async function GET() {
  const access = await resolveServerAccess();

  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }

  const { admin, departmentId } = access.context;

  try {
    const data = await createQualificationHistoryRepository(
      admin,
      departmentId,
    ).listImportedHistory({ departmentId });

    return NextResponse.json({
      results: mapQualificationHistoryRows(data),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Qualification history could not be loaded.",
      },
      { status: 500 },
    );
  }
}
