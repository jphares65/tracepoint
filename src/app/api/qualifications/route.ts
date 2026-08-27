import { NextResponse } from "next/server";

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
    const { data, error } = await admin
      .from("qualification_results")
      .select(
        "id,officer_user_id,qualification_date,lighting_condition,score,passed,record_origin,historical_qualification_type,historical_instructor_name,notes",
      )
      .eq("department_id", departmentId)
      .eq("record_origin", "historical_import")
      .order("qualification_date", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      results: (data ?? []).map((row: any) => ({
        id: row.id,
        officerUserId: row.officer_user_id,
        qualificationDate: row.qualification_date,
        lightingCondition: row.lighting_condition,
        score: row.score === null ? null : Number(row.score),
        passed: row.passed,
        recordOrigin: row.record_origin,
        qualificationType: row.historical_qualification_type,
        instructorName: row.historical_instructor_name,
        notes: row.notes,
      })),
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