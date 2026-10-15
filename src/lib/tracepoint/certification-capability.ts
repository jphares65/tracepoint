import { NextResponse } from "next/server";
import { createReadinessRepository } from "@/lib/readiness/read-repository";
import { hasAnyServerPermission } from "@/lib/tracepoint/server-access";
import type { ServerAccessContext } from "@/lib/tracepoint/server-access";
import {
  evaluateCertificationCapabilityRows,
  type CertificationCapabilityCode,
} from "./certification-capability-core";

export type CertificationCapabilityResult = {
  configured: boolean;
  eligible: boolean;
  capabilityCode: CertificationCapabilityCode;
  certificationTypeId?: string;
  certificationName?: string;
  status?: "current" | "due_soon" | "expired" | "missing";
  reason: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function evaluateCertificationCapability({
  context,
  capabilityCode,
}: {
  context: ServerAccessContext;
  capabilityCode: CertificationCapabilityCode;
}): Promise<CertificationCapabilityResult> {
  const { data: requirement, error } = await context.admin
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
      reason: "No certification eligibility rule is configured.",
    };
  }

  const certificationTypeId = text(requirement.certification_type_id);
  const canViewDepartmentReadiness = hasAnyServerPermission(context, [
    "manage_certifications",
    "view_command_dashboard",
    "view_analytics",
  ]);
  if (!canViewDepartmentReadiness) {
    throw new Error("Certification readiness could not be evaluated.");
  }

  const readiness = await createReadinessRepository(
    context.admin,
    context.departmentId,
  ).getCertificationReadiness({ departmentId: context.departmentId });

  return evaluateCertificationCapabilityRows({
    rows: Array.isArray(readiness.rows) ? readiness.rows : [],
    userId: text(context.userId),
    certificationTypeId,
    capabilityCode,
  });
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
