import { resolveServerAccess } from "@/lib/tracepoint/server-access";

export type PersonalRifleRules = {
  allow_personally_owned_rifles: boolean;
  require_personal_rifle_armorer_inspection: boolean;
  require_personal_rifle_chief_approval: boolean;
  require_personal_rifle_qualification: boolean;
  require_personal_rifle_annual_reinspection: boolean;
  require_personal_rifle_spec_acknowledgment: boolean;
  personal_rifle_approval_months: number;
  personal_rifle_policy_text: string;
};

export type PersonalRifleAccess = {
  canSubmit: boolean;
  canViewAll: boolean;
  canArmorerReview: boolean;
  canChiefReview: boolean;
  canConfigure: boolean;
};

export type SupabaseAuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: {
    full_name?: string;
    name?: string;
    display_name?: string;
  } | null;
};

export const DEFAULT_PERSONAL_RIFLE_RULES: PersonalRifleRules = {
  allow_personally_owned_rifles: false,
  require_personal_rifle_armorer_inspection: true,
  require_personal_rifle_chief_approval: true,
  require_personal_rifle_qualification: true,
  require_personal_rifle_annual_reinspection: true,
  require_personal_rifle_spec_acknowledgment: true,
  personal_rifle_approval_months: 12,
  personal_rifle_policy_text: "",
};

export function cleanPersonalRifleText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getPersonalRifleDisplayName(
  user?: SupabaseAuthUser | null,
) {
  const metadata = user?.user_metadata ?? {};
  return (
    metadata.full_name ||
    metadata.name ||
    metadata.display_name ||
    user?.email ||
    "Unknown User"
  );
}

export async function getPersonalRifleUsers(
  admin: any,
  departmentId: string,
  candidateUserIds: string[],
): Promise<{ data: { users: SupabaseAuthUser[] } | null; error: { message: string } | null }> {
  if (process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE !== "aws-native") {
    return admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  }
  const ids = [...new Set(candidateUserIds.filter(Boolean))];
  if (!ids.length) return { data: { users: [] }, error: null };
  // Others' profiles and memberships are readable only by user administrators
  // on AWS; reviewers and owners get the names they are shown from this lookup.
  const identities = await admin.rpc("armory_member_identities", { p_department_id: departmentId, p_user_ids: ids });
  if (identities.error) return { data: null, error: identities.error };
  const rows = new Map<string, { id: string; email: string | null; full_name: string | null }>(
    (identities.data ?? []).map((row: { user_id: string; full_name: string | null }) => [row.user_id, { id: row.user_id, email: null, full_name: row.full_name }]),
  );
  const memberships = await admin.from("department_memberships")
    .select("user_id").eq("department_id", departmentId).in("user_id", ids);
  if (memberships.error) return { data: null, error: memberships.error };
  const scopedIds = [...new Set((memberships.data ?? []).map((row: { user_id: string }) => row.user_id))];
  if (scopedIds.length) {
    const profiles = await admin.from("profiles").select("id,email,full_name").in("id", scopedIds);
    if (profiles.error) return { data: null, error: profiles.error };
    for (const row of profiles.data ?? []) rows.set(row.id, row);
  }
  return { data: { users: [...rows.values()].map((row) => ({
    id: row.id, email: row.email, user_metadata: { full_name: row.full_name ?? "" },
  })) }, error: null };
}

export async function getPersonalRifleRequestContext() {
  const access = await resolveServerAccess();

  if (!access.ok) {
    return {
      user: null,
      admin: null,
      departmentId: null,
      permissions: [] as string[],
      error: access.error,
    };
  }

  const {
    user,
    admin,
    departmentId,
    enabledFeatures,
    permissions,
  } = access.context;

  if (!enabledFeatures.includes("firearms")) {
    return {
      user,
      admin,
      departmentId,
      permissions,
      error: "Firearms is not enabled for this agency.",
    };
  }

  return {
    user,
    admin,
    departmentId,
    permissions,
    error: null,
  };
}

export async function getPersonalRifleRules(
  admin: any,
  departmentId: string,
): Promise<PersonalRifleRules> {
  const { data, error } = await admin
    .from("department_rules")
    .select(
      "allow_personally_owned_rifles,require_personal_rifle_armorer_inspection,require_personal_rifle_chief_approval,require_personal_rifle_qualification,require_personal_rifle_annual_reinspection,require_personal_rifle_spec_acknowledgment,personal_rifle_approval_months,personal_rifle_policy_text",
    )
    .eq("department_id", departmentId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return {
    allow_personally_owned_rifles:
      data?.allow_personally_owned_rifles ??
      DEFAULT_PERSONAL_RIFLE_RULES.allow_personally_owned_rifles,
    require_personal_rifle_armorer_inspection:
      data?.require_personal_rifle_armorer_inspection ??
      DEFAULT_PERSONAL_RIFLE_RULES.require_personal_rifle_armorer_inspection,
    require_personal_rifle_chief_approval:
      data?.require_personal_rifle_chief_approval ??
      DEFAULT_PERSONAL_RIFLE_RULES.require_personal_rifle_chief_approval,
    require_personal_rifle_qualification:
      data?.require_personal_rifle_qualification ??
      DEFAULT_PERSONAL_RIFLE_RULES.require_personal_rifle_qualification,
    require_personal_rifle_annual_reinspection:
      data?.require_personal_rifle_annual_reinspection ??
      DEFAULT_PERSONAL_RIFLE_RULES.require_personal_rifle_annual_reinspection,
    require_personal_rifle_spec_acknowledgment:
      data?.require_personal_rifle_spec_acknowledgment ??
      DEFAULT_PERSONAL_RIFLE_RULES.require_personal_rifle_spec_acknowledgment,
    personal_rifle_approval_months: Math.max(
      1,
      Number(
        data?.personal_rifle_approval_months ??
          DEFAULT_PERSONAL_RIFLE_RULES.personal_rifle_approval_months,
      ) || 12,
    ),
    personal_rifle_policy_text:
      data?.personal_rifle_policy_text ??
      DEFAULT_PERSONAL_RIFLE_RULES.personal_rifle_policy_text,
  };
}

// The caller's own effective permissions, as resolved for the session. They
// are not re-read from department_role_permissions, which only user
// administrators can read on AWS.
export function getPersonalRifleAccess(
  permissions: readonly string[],
): PersonalRifleAccess {
  const canConfigure = permissions.includes("administer_department");
  const canChiefReview =
    canConfigure || permissions.includes("approve_personal_rifles");
  const canArmorerReview =
    canConfigure || permissions.includes("manage_inspections");

  return {
    canSubmit: true,
    canViewAll: canConfigure || canArmorerReview || canChiefReview,
    canArmorerReview,
    canChiefReview,
    canConfigure,
  };
}

export function getInitialPersonalRifleStatus(
  rules: PersonalRifleRules,
) {
  if (rules.require_personal_rifle_armorer_inspection) {
    return "Pending Armorer Review";
  }
  if (rules.require_personal_rifle_chief_approval) {
    return "Pending Chief Approval";
  }
  return "Approved";
}

export function getPersonalRifleExpirationDate(
  rules: PersonalRifleRules,
  from = new Date(),
) {
  if (!rules.require_personal_rifle_annual_reinspection) return null;

  const expiration = new Date(from);
  expiration.setMonth(
    expiration.getMonth() + Math.max(1, rules.personal_rifle_approval_months),
  );
  return expiration.toISOString().slice(0, 10);
}

// On AWS the database writes the history row with the rifle change (052); the
// route only passes its note in workflow_note.
export function personalRifleHistoryWrittenByDatabase() {
  return process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native";
}

export async function recordPersonalRifleHistory(
  admin: any,
  values: {
    departmentId: string;
    rifleId: string;
    actorUserId: string;
    fromStatus: string | null;
    toStatus: string;
    action: string;
    notes?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  if (personalRifleHistoryWrittenByDatabase()) return;

  const { error } = await admin
    .from("personal_rifle_status_history")
    .insert({
      department_id: values.departmentId,
      personal_rifle_id: values.rifleId,
      actor_user_id: values.actorUserId,
      from_status: values.fromStatus,
      to_status: values.toStatus,
      action: values.action,
      notes: values.notes ?? null,
      metadata: values.metadata ?? {},
    });

  if (error) throw new Error(error.message);
}


