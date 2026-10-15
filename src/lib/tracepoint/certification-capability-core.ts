export type CertificationCapabilityCode =
  | "perform_firearm_inspections";

export type CertificationCapabilityRow = {
  userId?: string;
  certificationTypeId?: string;
  certificationName?: string;
  status?: "current" | "due_soon" | "expired" | "missing";
};

export function evaluateCertificationCapabilityRows({
  rows,
  userId,
  certificationTypeId,
  capabilityCode,
}: {
  rows: CertificationCapabilityRow[];
  userId: string;
  certificationTypeId: string;
  capabilityCode: CertificationCapabilityCode;
}) {
  const text = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  const row = rows.find(
    (item) =>
      text(item.userId) === userId &&
      text(item.certificationTypeId) === certificationTypeId,
  );

  if (!row) {
    return {
      configured: true,
      eligible: false,
      capabilityCode,
      certificationTypeId,
      status: "missing" as const,
      reason: "Required certification is missing.",
    };
  }

  const name = row.certificationName || "Required certification";
  const eligible = row.status === "current" || row.status === "due_soon";
  return {
    configured: true,
    eligible,
    capabilityCode,
    certificationTypeId,
    certificationName: row.certificationName,
    status: row.status,
    reason: eligible
      ? row.status === "due_soon"
        ? name + " is due soon but remains current."
        : name + " is current."
      : row.status === "expired"
        ? name + " is expired."
        : name + " is missing.",
  };
}