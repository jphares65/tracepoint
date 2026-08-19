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

    const { data: rules, error: rulesError } = await admin
      .from("department_rules")
      .select(
        "spring_cycle_start,spring_cycle_end,fall_cycle_start,fall_cycle_end,qualification_valid_days,qualification_due_soon_days,inspection_interval_days,battery_check_interval_days,off_duty_renewal_days",
      )
      .eq("department_id", departmentId)
      .maybeSingle();

    if (rulesError) {
      throw new Error(rulesError.message);
    }

    return NextResponse.json({
      rules: {
        spring_cycle_start: rules?.spring_cycle_start ?? "04-01",
        spring_cycle_end: rules?.spring_cycle_end ?? "06-30",
        fall_cycle_start: rules?.fall_cycle_start ?? "09-01",
        fall_cycle_end: rules?.fall_cycle_end ?? "11-30",
        qualification_valid_days:
          Number(rules?.qualification_valid_days) || 365,
        qualification_due_soon_days:
          rules?.qualification_due_soon_days === null ||
          rules?.qualification_due_soon_days === undefined
            ? 30
            : Number(rules.qualification_due_soon_days),
        inspection_interval_days:
          Number(rules?.inspection_interval_days) || 180,
        battery_check_interval_days:
          Number(rules?.battery_check_interval_days) || 180,
        off_duty_renewal_days:
          Number(rules?.off_duty_renewal_days) || 365,
      },
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

