import "server-only";

export type DataExportAuditDetails = {
  exportType: string;
  fileName?: string | null;
  format: "csv" | "pdf" | "json";
  recordCount?: number | null;
  source: string;
};

export async function recordDataExport(
  context: any,
  details: DataExportAuditDetails,
) {
  const { data: security, error: securityError } = await context.admin
    .from("department_security_settings")
    .select("export_logging_enabled")
    .eq("department_id", context.departmentId)
    .maybeSingle();

  if (securityError) {
    throw new Error(
      `Export policy could not be loaded: ${securityError.message}`,
    );
  }

  if (security?.export_logging_enabled === false) {
    return { logged: false as const };
  }

  const actorUserId = context.user?.id ?? context.userId;

  if (!actorUserId) {
    throw new Error("The authenticated export actor could not be resolved.");
  }

  const { error: auditError } = await context.admin
    .from("audit_events")
    .insert({
      department_id: context.departmentId,
      actor_user_id: actorUserId,
      action: "data_exported",
      entity_type: "data_export",
      entity_id: null,
      details: {
        export_type: details.exportType,
        file_name: details.fileName ?? null,
        format: details.format,
        record_count: details.recordCount ?? null,
        source: details.source,
        support_mode: context.isSupportMode === true,
      },
    });

  if (auditError) {
    throw new Error(`Export audit failed: ${auditError.message}`);
  }

  return { logged: true as const };
}
