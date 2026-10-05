export type SupportQuery = (sql: string, values?: string[]) => Promise<{ rows: Record<string, unknown>[] }>;

async function requireAdmin(query: SupportQuery) {
  const result = await query("select public.is_platform_admin() as allowed");
  if (result.rows[0]?.allowed !== true) throw new Error("Platform administrator access is required for Support Mode.");
}

export async function listMobileSupportAgencies(query: SupportQuery) {
  await requireAdmin(query);
  const result = await query("select * from public.list_platform_agencies()");
  return result.rows.filter(row => row.is_active === true).map(row => ({
    departmentId: String(row.id), departmentName: String(row.name),
    departmentShortName: String(row.short_name || row.name),
  }));
}

export async function recordMobileSupportEntry(query: SupportQuery, departmentId: string) {
  await requireAdmin(query);
  const result = await query("select public.record_platform_support_mode($1,$2) as department_name", [departmentId, "support_mode_entered"]);
  if (!result.rows[0]?.department_name) throw new Error("Support Mode could not be validated and audited.");
}
