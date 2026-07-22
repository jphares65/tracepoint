import { NextRequest, NextResponse } from "next/server";

import {
  DEFAULT_PERSONAL_RIFLE_RULES,
  cleanPersonalRifleText,
  getPersonalRifleAccess,
  getPersonalRifleRequestContext,
  getPersonalRifleRules,
} from "@/lib/tracepoint/personal-rifle-server";

export async function GET() {
  const context = await getPersonalRifleRequestContext();

  if (context.error || !context.user || !context.admin || !context.departmentId) {
    return NextResponse.json(
      { error: context.error ?? "Personal rifle access could not be resolved." },
      { status: context.user ? 403 : 401 },
    );
  }

  try {
    const [rules, access] = await Promise.all([
      getPersonalRifleRules(context.admin, context.departmentId),
      getPersonalRifleAccess(
        context.admin,
        context.departmentId,
        context.user.id,
      ),
    ]);

    return NextResponse.json({ rules, access });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Personal rifle rules could not be loaded.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const context = await getPersonalRifleRequestContext();

  if (context.error || !context.user || !context.admin || !context.departmentId) {
    return NextResponse.json(
      { error: context.error ?? "Personal rifle access could not be resolved." },
      { status: context.user ? 403 : 401 },
    );
  }

  try {
    const access = await getPersonalRifleAccess(
      context.admin,
      context.departmentId,
      context.user.id,
    );

    if (!access.canConfigure) {
      return NextResponse.json(
        { error: "Department administration permission is required." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const approvalMonths = Math.min(
      60,
      Math.max(
        1,
        Number(
          body.personal_rifle_approval_months ??
            DEFAULT_PERSONAL_RIFLE_RULES.personal_rifle_approval_months,
        ) || 12,
      ),
    );

    const values = {
      department_id: context.departmentId,
      allow_personally_owned_rifles:
        body.allow_personally_owned_rifles === true,
      require_personal_rifle_armorer_inspection:
        body.require_personal_rifle_armorer_inspection !== false,
      require_personal_rifle_chief_approval:
        body.require_personal_rifle_chief_approval !== false,
      require_personal_rifle_qualification:
        body.require_personal_rifle_qualification !== false,
      require_personal_rifle_annual_reinspection:
        body.require_personal_rifle_annual_reinspection !== false,
      require_personal_rifle_spec_acknowledgment:
        body.require_personal_rifle_spec_acknowledgment !== false,
      personal_rifle_approval_months: approvalMonths,
      personal_rifle_policy_text:
        cleanPersonalRifleText(body.personal_rifle_policy_text) ?? "",
      updated_at: new Date().toISOString(),
    };

    const { error } = await context.admin
      .from("department_rules")
      .upsert(values, { onConflict: "department_id" });

    if (error) throw new Error(error.message);

    return NextResponse.json({
      ok: true,
      rules: await getPersonalRifleRules(
        context.admin,
        context.departmentId,
      ),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Personal rifle rules could not be saved.",
      },
      { status: 500 },
    );
  }
}
