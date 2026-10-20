import { NextResponse } from "next/server";

import {
  createQualificationHistoryRepository,
  mapQualificationHistoryRows,
} from "@/lib/qualifications/history-repository";
import { resolveServerAccess } from "@/lib/tracepoint/server-access";
import {
  canViewDepartmentRecords,
  ownRows,
  RANGE_RECORD_PERMISSIONS,
} from "@/lib/tracepoint/training-record-visibility";

export async function GET() {
  const access = await resolveServerAccess();

  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }

  const { admin, departmentId, permissions, userId } = access.context;

  try {
    const data = await createQualificationHistoryRepository(
      admin,
      departmentId,
    ).listImportedHistory({ departmentId });

    const results = mapQualificationHistoryRows(data);
    return NextResponse.json({
      results: canViewDepartmentRecords(permissions, RANGE_RECORD_PERMISSIONS)
        ? results
        : ownRows(results, userId, ["officerUserId"]),
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
