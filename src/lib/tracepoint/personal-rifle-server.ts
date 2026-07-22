import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

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

export async function getPersonalRifleRequestContext() {
  const supabase = await createServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      admin: null,
      departmentId: null,
      error: "You must be signed in to use Armory.",
    };
  }

  const admin = createAdminClient() as any;
  const { data: membership, error: membershipError } = await admin
    .from("department_memberships")
    .select("department_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return {
      user,
      admin,
      departmentId: null,
      error: membershipError.message,
    };
  }

  return {
    user,
    admin,
    departmentId: membership?.department_id ?? null,
    error: membership?.department_id
      ? null
      : "No active department membership was found.",
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

export async function getPersonalRifleAccess(
  admin: any,
  departmentId: string,
  userId: string,
): Promise<PersonalRifleAccess> {
  const { data: roleRows, error: roleError } = await admin
    .from("department_membership_roles")
    .select("role_code")
    .eq("department_id", departmentId)
    .eq("user_id", userId);

  if (roleError) throw new Error(roleError.message);

  const roleCodes: string[] = Array.from(
    new Set<string>(
      (roleRows ?? [])
        .map((row: any) => String(row.role_code ?? ""))
        .filter(Boolean),
    ),
  );

  let permissions: string[] = [];
  if (roleCodes.length > 0) {
    const { data: permissionRows, error: permissionError } = await admin
      .from("department_role_permissions")
      .select("permission_code")
      .eq("department_id", departmentId)
      .in("role_code", roleCodes);

    if (permissionError) throw new Error(permissionError.message);

    permissions = Array.from(
      new Set<string>(
        (permissionRows ?? [])
          .map((row: any) => String(row.permission_code ?? ""))
          .filter(Boolean),
      ),
    );
  }

  const administratorRoles = [
    "chief",
    "administrator",
    "department_admin",
    "admin",
  ];
  const armorerRoles = ["armorer", "range_master"];

  const canConfigure =
    roleCodes.some((role) => administratorRoles.includes(role)) ||
    permissions.includes("administer_department");

  const canChiefReview = canConfigure || roleCodes.includes("chief");

  const canArmorerReview =
    canConfigure ||
    roleCodes.some((role) => armorerRoles.includes(role)) ||
    permissions.includes("manage_firearms") ||
    permissions.includes("manage_inspections");

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
