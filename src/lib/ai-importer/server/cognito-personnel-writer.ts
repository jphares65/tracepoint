import "server-only";

import { inviteCognitoUser } from "@/lib/authentication/cognito-invite";
import { setCognitoMembershipActive } from "@/lib/authentication/cognito-membership-lifecycle";
import { issueActivationEmail } from "@/lib/tracepoint/activation";
import type { PersonnelImportWriter } from "./execution";

async function assertResult(
  result: { data?: unknown; error?: { code?: string } | null },
  duplicateMessage: string,
  fallback: string,
) {
  if (!result.error) return;
  if (result.error.code === "23505") throw new Error(duplicateMessage);
  throw new Error(fallback);
}

export function createCognitoPersonnelWriter(siteUrl: string): PersonnelImportWriter {
  return async ({ admin, departmentId, actorId, row }) => {
    const value = row.values;
    const fullName = String(
      value.fullName || [value.firstName, value.middleName, value.lastName].filter(Boolean).join(" "),
    );

    if (row.action === "CREATE") {
      const existing = await admin.rpc("attach_existing_cognito_personnel_import", {
        p_department_id: departmentId,
        p_email: String(value.email),
        p_full_name: fullName,
        p_badge_number: String(value.badgeNumber ?? ""),
        p_employee_number: String(value.employeeNumber ?? ""),
        p_rank_title: String(value.rankTitle ?? ""),
        p_unit_name: String(value.unitName ?? ""),
      });
      await assertResult(existing, "A duplicate personnel identity was detected after approval. Run validation again.", "Personnel identity lookup failed.");
      const existingIdentity = existing.data as { user_id?: unknown; identity_state?: unknown } | null;
      if (existingIdentity?.user_id) {
        if (value.active !== false) {
          await setCognitoMembershipActive({
            actorUserId: actorId,
            departmentId,
            targetUserId: String(existingIdentity.user_id),
            active: true,
          });
          if (existingIdentity.identity_state === "pending") {
            await issueActivationEmail({
              departmentId,
              userId: String(existingIdentity.user_id),
              email: String(value.email),
              fullName,
              siteUrl,
              actorUserId: actorId,
            });
          }
        }
        return;
      }
      await inviteCognitoUser({
        actorUserId: actorId,
        departmentId,
        email: String(value.email),
        fullName,
        badgeNumber: String(value.badgeNumber ?? ""),
        rankTitle: String(value.rankTitle ?? ""),
        unitName: String(value.unitName ?? ""),
        employeeNumber: String(value.employeeNumber ?? ""),
        roleCodes: ["officer"],
        groupIds: [],
        siteUrl,
        active: value.active !== false,
      });
      return;
    }

    if (!row.matchId) throw new Error("Personnel identity match is required for an update.");
    if (row.changes.some((change) => change.field === "email")) {
      throw new Error("Personnel email changes require the dedicated Cognito identity workflow.");
    }
    const updated = await admin.rpc("update_cognito_personnel_import", {
        p_department_id: departmentId,
        p_user_id: row.matchId,
        p_email: String(value.email),
        p_full_name: fullName,
        p_phone: String(value.phone ?? ""),
        p_badge_number: String(value.badgeNumber ?? ""),
        p_employee_number: String(value.employeeNumber ?? ""),
        p_rank_title: String(value.rankTitle ?? ""),
        p_unit_name: String(value.unitName ?? ""),
      });
    await assertResult(
      updated,
      "A duplicate personnel email was detected after approval. Run validation again.",
      "Personnel update failed.",
    );
    if (typeof value.active === "boolean" && row.changes.some((change) => change.field === "active")) {
      await setCognitoMembershipActive({
        actorUserId: actorId,
        departmentId,
        targetUserId: row.matchId,
        active: value.active,
      });
      if (value.active && updated.data === "pending") {
        await issueActivationEmail({
          departmentId,
          userId: row.matchId,
          email: String(value.email),
          fullName,
          siteUrl,
          actorUserId: actorId,
        });
      }
    }
  };
}
