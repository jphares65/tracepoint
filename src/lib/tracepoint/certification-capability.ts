import { NextResponse } from "next/server";

export type CertificationCapabilityCode =
  | "perform_firearm_inspections";

export type CertificationCapabilityResult = {
  configured: boolean;
  eligible: boolean;
  capabilityCode: CertificationCapabilityCode;
  certificationTypeId?: string;
  certificationName?: string;
  status?:
    | "current"
    | "due_soon"
    | "expired"
    | "missing";
  reason: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function evaluateCertificationCapability({
  request,
  context,
  capabilityCode,
}: {
  request: Request;
  context: any;
  capabilityCode: CertificationCapabilityCode;
}): Promise<CertificationCapabilityResult> {

  const { data: requirement, error } =
    await context.admin
      .from("department_certification_capabilities")
      .select("certification_type_id,is_active")
      .eq("department_id", context.departmentId)
      .eq("capability_code", capabilityCode)
      .eq("is_active", true)
      .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!requirement) {
    return {
      configured: false,
      eligible: true,
      capabilityCode,
      reason:
        "No certification eligibility rule is configured.",
    };
  }

  const certificationTypeId = text(
    requirement.certification_type_id,
  );

  const cookie = request.headers.get("cookie");

  const response = await fetch(
    new URL(
      "/api/readiness/certifications",
      request.url,
    ),
    {
      cache: "no-store",
      headers: cookie
        ? { cookie }
        : undefined,
    },
  );

  if (!response.ok) {
    throw new Error(
      "Certification readiness could not be evaluated.",
    );
  }

  const payload =
    (await response.json()) as {
      rows?: Array<{
        userId?: string;
        certificationTypeId?: string;
        certificationName?: string;
        status?:
          | "current"
          | "due_soon"
          | "expired"
          | "missing";
      }>;
    };

  const rows = Array.isArray(payload.rows)
    ? payload.rows
    : [];

  const row = rows.find(
    (item) =>
      text(item.userId) === text(context.userId) &&
      text(item.certificationTypeId) ===
        certificationTypeId,
  );

  if (!row) {
    return {
      configured: true,
      eligible: false,
      capabilityCode,
      certificationTypeId,
      status: "missing",
      reason: "Required certification is missing.",
    };
  }

  const eligible =
    row.status === "current" ||
    row.status === "due_soon";

  return {
    configured: true,
    eligible,
    capabilityCode,
    certificationTypeId,
    certificationName: row.certificationName,
    status: row.status,
    reason: eligible
      ? row.status === "due_soon"
        ? `${row.certificationName ?? "Required certification"} is due soon but remains current.`
        : `${row.certificationName ?? "Required certification"} is current.`
      : row.status === "expired"
        ? `${row.certificationName ?? "Required certification"} is expired.`
        : `${row.certificationName ?? "Required certification"} is missing.`,
  };
}

export function certificationCapabilityDeniedResponse(
  result: CertificationCapabilityResult,
) {
  return NextResponse.json(
    {
      error:
        "Current certification eligibility is required to perform this operation.",
      capability: result.capabilityCode,
      certificationTypeId: result.certificationTypeId,
      certificationName: result.certificationName,
      certificationStatus: result.status,
      detail: result.reason,
    },
    { status: 403 },
  );
}