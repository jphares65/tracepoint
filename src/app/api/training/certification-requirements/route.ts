import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { createTrainingReadRepository } from "@/lib/training/read-repository";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function integerOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);

  return Number.isInteger(parsed) ? parsed : null;
}

async function getContext() {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return {
      error: resolved.error,
      status: resolved.status,
    } as const;
  }

  const {
    admin,
    user,
    departmentId,
  } = resolved.context;

  const [{ data: manager }, { data: administrator }] =
    await Promise.all([
      admin.rpc("has_department_permission", {
        p_department_id: departmentId,
        p_permission_code: "manage_certifications",
      }),
      admin.rpc("has_department_permission", {
        p_department_id: departmentId,
        p_permission_code: "administer_department",
      }),
    ]);

  if (!manager && !administrator) {
    return {
      error:
        "You do not have permission to manage certification requirements.",
      status: 403,
    } as const;
  }

  return {
    admin,
    user,
    departmentId,
  } as const;
}

export async function GET() {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const featureError = requireServerFeature(
    resolved.context,
    "certifications",
    "Certifications",
  );

  if (featureError) {
    return featureError;
  }

  const { admin, departmentId } = resolved.context;
  try {
    const items = await createTrainingReadRepository(admin, departmentId).getRequirements(departmentId);
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Certification requirements could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const featureError = requireServerFeature(
    resolved.context,
    "certifications",
    "Certifications",
  );

  if (featureError) {
    return featureError;
  }
  const context = await getContext();

  if ("error" in context) {
    return NextResponse.json(
      { error: context.error },
      { status: context.status },
    );
  }

  const body = (await request.json().catch(() => ({}))) as any;

  const certificationTypeId = text(body.certificationTypeId);
  const isRequired = body.isRequired !== false;
  const validDays = integerOrNull(body.validDays);
  const dueSoonDays = integerOrNull(body.dueSoonDays);
  const notes = text(body.notes) || null;
  const isActive = body.isActive !== false;

  if (!certificationTypeId) {
    return NextResponse.json(
      { error: "Certification type is required." },
      { status: 400 },
    );
  }

  const { data: certificationType, error: typeError } =
    await context.admin
      .from("certification_types")
      .select("id")
      .eq("id", certificationTypeId)
      .eq("department_id", context.departmentId)
      .maybeSingle();

  if (typeError) {
    return NextResponse.json(
      { error: typeError.message },
      { status: 500 },
    );
  }

  if (!certificationType) {
    return NextResponse.json(
      {
        error:
          "The selected certification type does not belong to this department.",
      },
      { status: 400 },
    );
  }

  if (
    validDays !== null &&
    (validDays < 1 || validDays > 36500)
  ) {
    return NextResponse.json(
      { error: "Validity must be between 1 and 36500 days." },
      { status: 400 },
    );
  }

  if (
    dueSoonDays !== null &&
    (dueSoonDays < 0 || dueSoonDays > 36500)
  ) {
    return NextResponse.json(
      {
        error:
          "Due-soon warning must be between 0 and 36500 days.",
      },
      { status: 400 },
    );
  }

  if (
    validDays !== null &&
    dueSoonDays !== null &&
    dueSoonDays >= validDays
  ) {
    return NextResponse.json(
      {
        error:
          "Due-soon warning must be less than the validity period.",
      },
      { status: 400 },
    );
  }

  const { data, error } = await context.admin
    .from("department_certification_requirements")
    .upsert(
      {
        department_id: context.departmentId,
        certification_type_id: certificationTypeId,
        is_required: isRequired,
        valid_days: validDays,
        due_soon_days: dueSoonDays,
        is_active: isActive,
        notes,
        updated_by_user_id: context.user.id,
      },
      {
        onConflict: "department_id,certification_type_id",
      },
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    requirement: data,
  });
}
