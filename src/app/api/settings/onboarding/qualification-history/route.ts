import { NextRequest, NextResponse } from "next/server";

import { buildEnrichOnlyUpdates } from "@/lib/onboarding/merge";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type QualificationHistoryImportRequest = {
  departmentId?: string;
  officerName?: string;
  badgeNumber?: string;
  qualificationDate?: string;
  courseName?: string;
  score?: string | number;
  passingScore?: string | number;
  result?: string;
  instructor?: string;
  notes?: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const text = cleanText(value);

  if (!text) return null;

  const parsed = Number(text.replace(/,/g, ""));

  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: unknown) {
  const text = cleanText(value);

  if (!text) return null;

  const directIso = /^\d{4}-\d{2}-\d{2}$/;

  if (directIso.test(text)) return text;

  const parsed = new Date(text);

  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString().slice(0, 10);
}

function derivePassed(
  resultText: string,
  score: number,
  passingScore: number | null,
) {
  const normalized = resultText.trim().toLowerCase();

  if (
    ["pass", "passed", "qualified", "qual", "satisfactory", "successful"].includes(
      normalized,
    )
  ) {
    return true;
  }

  if (
    [
      "fail",
      "failed",
      "not qualified",
      "unqualified",
      "unsatisfactory",
      "unsuccessful",
    ].includes(normalized)
  ) {
    return false;
  }

  if (passingScore !== null) {
    return score >= passingScore;
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body =
      (await request.json()) as QualificationHistoryImportRequest;

    const departmentId = cleanText(body.departmentId);
    const officerName = cleanText(body.officerName);
    const badgeNumber = cleanText(body.badgeNumber);
    const qualificationDate = normalizeDate(body.qualificationDate);
    const courseName = cleanText(body.courseName);
    const score = cleanNumber(body.score);
    const passingScore = cleanNumber(body.passingScore);
    const resultText = cleanText(body.result);
    const instructorName = cleanText(body.instructor);
    const notes = cleanText(body.notes);

    if (
      !departmentId ||
      !officerName ||
      !qualificationDate ||
      !courseName ||
      score === null
    ) {
      return NextResponse.json(
        {
          error:
            "Department, officer name, qualification date, course/standard, and numeric score are required.",
        },
        { status: 400 },
      );
    }

    const server = await createServerClient();

    const {
      data: { user: actor },
      error: actorError,
    } = await server.auth.getUser();

    if (actorError || !actor) {
      return NextResponse.json(
        { error: "Authentication is required." },
        { status: 401 },
      );
    }

    const [
      qualificationPermission,
      rangePermission,
      administerPermission,
      platformAdminResult,
    ] = await Promise.all([
      server.rpc("has_department_permission", {
        p_department_id: departmentId,
        p_permission_code: "manage_qualifications",
      }),
      server.rpc("has_department_permission", {
        p_department_id: departmentId,
        p_permission_code: "manage_range_days",
      }),
      server.rpc("has_department_permission", {
        p_department_id: departmentId,
        p_permission_code: "administer_department",
      }),
      server.rpc("is_platform_admin"),
    ]);

    if (qualificationPermission.error) throw qualificationPermission.error;
    if (rangePermission.error) throw rangePermission.error;
    if (administerPermission.error) throw administerPermission.error;
    if (platformAdminResult.error) throw platformAdminResult.error;

    if (
      !qualificationPermission.data &&
      !rangePermission.data &&
      !administerPermission.data &&
      !platformAdminResult.data
    ) {
      return NextResponse.json(
        {
          error:
            "You do not have permission to import qualification history.",
        },
        { status: 403 },
      );
    }

    const admin = createAdminClient();

    let officerUserId: string | null = null;

    if (badgeNumber) {
      const { data: badgeMatches, error: badgeError } = await admin
        .from("department_memberships")
        .select("user_id")
        .eq("department_id", departmentId)
        .eq("badge_number", badgeNumber)
        .eq("is_active", true);

      if (badgeError) throw badgeError;

      if ((badgeMatches ?? []).length > 1) {
        return NextResponse.json(
          {
            error: `Badge number "${badgeNumber}" matched more than one active personnel record.`,
          },
          { status: 409 },
        );
      }

      officerUserId = badgeMatches?.[0]?.user_id ?? null;
    }

    if (!officerUserId) {
      const { data: profileMatches, error: profileError } = await admin
        .from("profiles")
        .select("id, full_name")
        .ilike("full_name", officerName);

      if (profileError) throw profileError;

      const candidateIds = (profileMatches ?? []).map((profile) => profile.id);

      if (candidateIds.length > 0) {
        const { data: membershipMatches, error: membershipError } = await admin
          .from("department_memberships")
          .select("user_id")
          .eq("department_id", departmentId)
          .eq("is_active", true)
          .in("user_id", candidateIds);

        if (membershipError) throw membershipError;

        if ((membershipMatches ?? []).length === 1) {
          officerUserId = membershipMatches![0].user_id;
        } else if ((membershipMatches ?? []).length > 1) {
          return NextResponse.json(
            {
              error: `Officer "${officerName}" matched more than one active personnel record. Include a badge number to disambiguate.`,
            },
            { status: 409 },
          );
        }
      }
    }

    if (!officerUserId) {
      return NextResponse.json(
        {
          error: `Officer "${officerName}" could not be matched to an active personnel record in the selected agency.`,
        },
        { status: 400 },
      );
    }

    const { data: duplicateRows, error: duplicateError } = await admin
      .from("qualification_results")
      .select(
        "id,score,passed,historical_instructor_name,historical_passing_score,historical_result_text,notes",
      )
      .eq("department_id", departmentId)
      .eq("officer_user_id", officerUserId)
      .eq("qualification_date", qualificationDate)
      .eq("record_origin", "historical_import")
      .ilike("historical_course_name", courseName)
      .limit(1);

    if (duplicateError) throw duplicateError;

    const existing = duplicateRows?.[0] ?? null;

    if (existing) {
      const passed = derivePassed(resultText, score, passingScore);

      const merge = buildEnrichOnlyUpdates(
        existing as Record<string, unknown>,
        {
          score,
          passed,
          historical_instructor_name: instructorName || null,
          historical_passing_score: passingScore,
          historical_result_text: resultText || null,
          notes: notes || null,
        },
        ["id"],
      );

      if (Object.keys(merge.updates).length > 0) {
        const { error: updateError } = await admin
          .from("qualification_results")
          .update(merge.updates as any)
          .eq("id", existing.id)
          .eq("department_id", departmentId);

        if (updateError) throw updateError;

        return NextResponse.json({
          ok: true,
          status: "updated",
          resultId: existing.id,
          officerUserId,
          changedFields: merge.changedFields,
          conflicts: merge.conflicts,
          passed,
        });
      }

      return NextResponse.json({
        ok: true,
        status: "unchanged",
        resultId: existing.id,
        officerUserId,
        changedFields: [],
        conflicts: merge.conflicts,
        passed,
      });
    }

    const passed = derivePassed(resultText, score, passingScore);

    const { data: insertedResult, error: insertError } = await admin
      .from("qualification_results")
      .insert({
        department_id: departmentId,
        officer_user_id: officerUserId,
        qualification_date: qualificationDate,
        score,
        passed,
        record_origin: "historical_import",
        historical_course_name: courseName,
        historical_instructor_name: instructorName || null,
        historical_passing_score: passingScore,
        historical_result_text: resultText || null,
        notes: notes || null,
        instructor_user_id: null,
        qualification_course_id: null,
        qualification_course_version_id: null,
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    const { error: auditError } = await admin.from("audit_events").insert({
      department_id: departmentId,
      actor_user_id: actor.id,
      action: "historical_qualification_imported",
      entity_type: "qualification_result",
      entity_id: insertedResult.id,
      summary: `${officerName} historical qualification imported for ${courseName}.`,
      new_value: {
        officer_name: officerName,
        badge_number: badgeNumber || null,
        qualification_date: qualificationDate,
        course_name: courseName,
        score,
        passing_score: passingScore,
        result: resultText || null,
        instructor: instructorName || null,
        record_origin: "historical_import",
        platform_admin: Boolean(platformAdminResult.data),
      },
    });

    if (auditError) throw auditError;

    return NextResponse.json({
      ok: true,
      status: "created",
      resultId: insertedResult.id,
      officerUserId,
      passed,
      message: `${officerName} historical qualification imported.`,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The historical qualification could not be imported.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}