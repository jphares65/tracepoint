import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  try {
    const admin = createAdminClient() as any;

    const { data: membership, error: membershipError } = await admin
      .from("department_memberships")
      .select("department_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      throw new Error(membershipError.message);
    }

    if (!membership?.department_id) {
      return NextResponse.json(
        { error: "No active department membership was found." },
        { status: 403 },
      );
    }

    const { data: rules, error: rulesError } = await admin
      .from("department_rules")
      .select(
        "spring_cycle_start,spring_cycle_end,fall_cycle_start,fall_cycle_end,qualification_valid_days,qualification_due_soon_days,inspection_interval_days,battery_check_interval_days,off_duty_renewal_days",
      )
      .eq("department_id", membership.department_id)
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

