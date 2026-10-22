// Settings > Edit Access saves a member's details, roles and groups as one
// command. The three database functions run on one connection inside the
// caller's transaction, so a later failure (for example a refused role change)
// rolls back the earlier membership update instead of leaving it half-saved.
export type DepartmentMemberSave = {
  p_department_id: string;
  p_user_id: string;
  p_badge_number: string | null;
  p_rank_title: string | null;
  p_unit_name: string | null;
  p_employee_number: string | null;
  p_is_active: boolean;
  p_role_codes: string[];
  // null: the caller did not have the member's groups (E-02), so they stay as they are.
  p_group_ids: string[] | null;
};

type QueryClient = { query(text: string, values?: readonly unknown[]): Promise<unknown> };

const text = (value: unknown) => (typeof value === "string" ? value : null);
const strings = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : null;

export function parseDepartmentMemberSave(args: Record<string, unknown>): DepartmentMemberSave | null {
  const roleCodes = strings(args.p_role_codes);
  // An absent group list means "unchanged"; a present one must be valid.
  const groupIds = args.p_group_ids === undefined ? null : strings(args.p_group_ids);
  if (typeof args.p_department_id !== "string" || typeof args.p_user_id !== "string" ||
      typeof args.p_is_active !== "boolean" || !roleCodes || (args.p_group_ids !== undefined && !groupIds)) return null;
  return {
    p_department_id: args.p_department_id,
    p_user_id: args.p_user_id,
    p_badge_number: text(args.p_badge_number),
    p_rank_title: text(args.p_rank_title),
    p_unit_name: text(args.p_unit_name),
    p_employee_number: text(args.p_employee_number),
    p_is_active: args.p_is_active,
    p_role_codes: roleCodes,
    p_group_ids: groupIds,
  };
}

export async function saveDepartmentMember(client: QueryClient, input: DepartmentMemberSave) {
  await client.query(
    "select public.update_department_member(p_department_id=>$1,p_user_id=>$2,p_badge_number=>$3,p_rank_title=>$4,p_unit_name=>$5,p_employee_number=>$6,p_is_active=>$7)",
    [input.p_department_id, input.p_user_id, input.p_badge_number, input.p_rank_title, input.p_unit_name, input.p_employee_number, input.p_is_active],
  );
  await client.query(
    "select public.set_department_member_roles(p_department_id=>$1,p_user_id=>$2,p_role_codes=>$3::text[])",
    [input.p_department_id, input.p_user_id, input.p_role_codes],
  );
  if (input.p_group_ids === null) return;
  await client.query(
    "select public.set_department_group_members(p_department_id=>$1,p_user_id=>$2,p_group_ids=>$3::uuid[])",
    [input.p_department_id, input.p_user_id, input.p_group_ids],
  );
}
