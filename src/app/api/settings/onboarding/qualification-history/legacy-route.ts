import { NextRequest, NextResponse } from "next/server";

import { buildEnrichOnlyUpdates } from "@/lib/onboarding/merge";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type QualificationType =
  | "handgun"
  | "rifle"
  | "shotgun"
  | "less_lethal"
  | "other";

type QualificationHistoryImportRequest = {
  departmentId?: string;
  officerName?: string;
  badgeNumber?: string;
  qualificationDate?: string;
  qualificationType?: string;
  courseName?: string;
  dayScore?: string | number;
  dayPassingScore?: string | number;
  dayResult?: string;
  nightScore?: string | number;
  nightPassingScore?: string | number;
  nightResult?: string;
  score?: string | number;
  passingScore?: string | number;
  result?: string;
  instructor?: string;
  notes?: string;
};

type ImportedComponent = {
  lightingCondition: "day" | "night";
  label: "Day" | "Night";
  score: number;
  passingScore: number | null;
  resultText: string;
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
}

function normalizeQualificationType(value: unknown): QualificationType | null {
  const normalized = cleanText(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (normalized === "pistol" || normalized === "sidearm") return "handgun";
  if (normalized === "lesslethal") return "less_lethal";

  return ["handgun", "rifle", "shotgun", "less_lethal", "other"].includes(
    normalized,
  )
    ? (normalized as QualificationType)
    : null;
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

  return passingScore === null ? null : score >= passingScore;
}

export async function POST(request: NextRequest) {
  try {
    const body =
      (await request.json()) as QualificationHistoryImportRequest;

    const departmentId = cleanText(body.departmentId);
    const officerName = cleanText(body.officerName);
    const badgeNumber = cleanText(body.badgeNumber);
    const qualificationDate = normalizeDate(body.qualificationDate);
    const qualificationType = normalizeQualificationType(
      body.qualificationType,
    );
    const courseName = cleanText(body.courseName);
    const instructorName = cleanText(body.instructor);
    const notes = cleanText(body.notes);

    const dayScore = cleanNumber(body.dayScore ?? body.score);
    const nightScore = cleanNumber(body.nightScore);
    const components: ImportedComponent[] = [
      ...(dayScore === null
        ? []
        : [{
            lightingCondition: "day" as const,
            label: "Day" as const,
            score: dayScore,
            passingScore: cleanNumber(
              body.dayPassingScore ?? body.passingScore,
            ),
            resultText: cleanText(body.dayResult ?? body.result),
          }]),
      ...(nightScore === null
        ? []
        : [{
            lightingCondition: "night" as const,
            label: "Night" as const,
            score: nightScore,
            passingScore: cleanNumber(body.nightPassingScore),
            resultText: cleanText(body.nightResult),
          }]),
    ];

    if (
      !departmentId ||
      !officerName ||
      !qualificationDate ||
      !qualificationType ||
      !courseName ||
      components.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "Department, officer name, qualification date, qualification type, course/standard, and at least one numeric day or night score are required.",
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
        { error: "You do not have permission to import qualification history." },
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

    const resultIds: string[] = [];
    const statuses: Array<"created" | "updated" | "unchanged"> = [];
    const changedFields = new Set<string>();
    const conflicts: unknown[] = [];

    for (const component of components) {
      const { data: duplicateRows, error: duplicateError } = await admin
        .from("qualification_results")
        .select(
          "id,score,passed,historical_instructor_name,historical_passing_score,historical_result_text,notes",
        )
        .eq("department_id", departmentId)
        .eq("officer_user_id", officerUserId)
        .eq("qualification_date", qualificationDate)
        .eq("record_origin", "historical_import")
        .eq("historical_qualification_type", qualificationType)
        .eq("lighting_condition", component.lightingCondition)
        .ilike("historical_course_name", courseName)
        .limit(1);

      if (duplicateError) throw duplicateError;

      const existing = duplicateRows?.[0] ?? null;
      const passed = derivePassed(
        component.resultText,
        component.score,
        component.passingScore,
      );

      if (existing) {
        const merge = buildEnrichOnlyUpdates(
          existing as Record<string, unknown>,
          {
            score: component.score,
            passed,
            historical_instructor_name: instructorName || null,
            historical_passing_score: component.passingScore,
            historical_result_text: component.resultText || null,
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
          statuses.push("updated");
          merge.changedFields.forEach((field) =>
            changedFields.add(`${component.lightingCondition}.${field}`),
          );
        } else {
          statuses.push("unchanged");
        }

        resultIds.push(existing.id);
        conflicts.push(...merge.conflicts);
        continue;
      }

      const { data: insertedResult, error: insertError } = await admin
        .from("qualification_results")
        .insert({
          department_id: departmentId,
          officer_user_id: officerUserId,
          qualification_date: qualificationDate,
          lighting_condition: component.lightingCondition,
          score: component.score,
          passed,
          record_origin: "historical_import",
          historical_qualification_type: qualificationType,
          historical_course_name: courseName,
          historical_instructor_name: instructorName || null,
          historical_passing_score: component.passingScore,
          historical_result_text: component.resultText || null,
          notes: notes || null,
          instructor_user_id: null,
          qualification_course_id: null,
          qualification_course_version_id: null,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;
      statuses.push("created");
      resultIds.push(insertedResult.id);
    }

    const status = statuses.includes("created")
      ? "created"
      : statuses.includes("updated")
        ? "updated"
        : "unchanged";

    if (status !== "unchanged") {
      const { error: auditError } = await admin.from("audit_events").insert({
        department_id: departmentId,
        actor_user_id: actor.id,
        action: "historical_qualification_imported",
        entity_type: "qualification_result",
        entity_id: resultIds[0],
        summary: `${officerName} ${qualificationType} qualification imported for ${courseName}.`,
        new_value: {
          officer_name: officerName,
          badge_number: badgeNumber || null,
          qualification_date: qualificationDate,
          qualification_type: qualificationType,
          course_name: courseName,
          components: components.map((component) => ({
            lighting_condition: component.lightingCondition,
            score: component.score,
            passing_score: component.passingScore,
            result: component.resultText || null,
          })),
          instructor: instructorName || null,
          record_origin: "historical_import",
          platform_admin: Boolean(platformAdminResult.data),
        },
      });

      if (auditError) throw auditError;
    }

    return NextResponse.json({
      ok: true,
      status,
      resultId: resultIds[0],
      resultIds,
      officerUserId,
      changedFields: Array.from(changedFields),
      conflicts,
      components: components.map((component, index) => ({
        name: component.label,
        resultId: resultIds[index],
        status: statuses[index],
        passed: derivePassed(
          component.resultText,
          component.score,
          component.passingScore,
        ),
      })),
      message: `${officerName} historical ${qualificationType} qualification imported.`,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The historical qualification could not be imported.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
