import { hasAnyServerPermission } from "@/lib/tracepoint/server-access";

type Priority = "Critical" | "High" | "Normal";
type Alert = { key: string; source: "Training"; kind: string; title: string; detail: string; href: string; priority: Priority; createdAt?: string | null; emailEnabled?: boolean };
function lower(value: unknown) { return String(value ?? "").trim().toLowerCase(); }
function eventOf(row: any) { const value = row?.agency_training_events; return Array.isArray(value) ? value[0] : value; }
function addInterval(date: Date, value: number, unit: string) {
  const result = new Date(date);
  if (unit === "days") result.setUTCDate(result.getUTCDate() + value);
  else if (unit === "months") result.setUTCMonth(result.getUTCMonth() + value);
  else if (unit === "years") result.setUTCFullYear(result.getUTCFullYear() + value);
  else if (unit === "calendar_year") { result.setUTCFullYear(result.getUTCFullYear() + 1, 11, 31); }
  return result;
}
function dueDate(requirement: any, completion?: Date) {
  if (!completion) return null;
  if (requirement.due_basis === "fixed_annual_date") {
    const month = Number(requirement.fixed_month) || 1;
    const day = Number(requirement.fixed_day) || 1;
    let due = new Date(Date.UTC(completion.getUTCFullYear(), month - 1, day));
    if (due.getTime() <= completion.getTime()) due = new Date(Date.UTC(completion.getUTCFullYear() + 1, month - 1, day));
    return due;
  }
  if (!requirement.interval_value || !requirement.interval_unit) return null;
  return addInterval(completion, Number(requirement.interval_value), String(requirement.interval_unit));
}
function applies(requirement: any, member: any, selected: Set<string>) {
  const scope = String(requirement.scope_type ?? "all_members");
  const values = new Set((requirement.scope_values ?? []).map(lower));
  if (scope === "all_members") return true;
  if (scope === "rank") return values.has(lower(member.rank_title));
  if (scope === "unit") return values.has(lower(member.unit_name));
  if (scope === "selected_members") return selected.has(String(member.user_id));
  return false;
}

export async function collectAgencyTrainingNotifications(context: any): Promise<Alert[]> {
  const [requirementsResult, membersResult, selectedResult, completionsResult] = await Promise.all([
    context.admin.from("agency_training_requirements").select("*,agency_training_courses(id,canonical_title)").eq("department_id", context.departmentId).eq("is_active", true),
    context.admin.from("department_memberships").select("user_id,rank_title,unit_name,is_active").eq("department_id", context.departmentId).eq("is_active", true),
    context.admin.from("agency_training_requirement_members").select("requirement_id,user_id").eq("department_id", context.departmentId),
    context.admin.from("agency_training_attendees").select("user_id,outcome_status,agency_training_events!inner(course_id,starts_at,status)").eq("department_id", context.departmentId).in("outcome_status", ["completed", "passed"]).eq("agency_training_events.status", "completed"),
  ]);
  for (const result of [requirementsResult, membersResult, selectedResult, completionsResult]) if (result.error) throw new Error(result.error.message);
  const members = membersResult.data ?? [];
  const userIds = members.map((member: any) => String(member.user_id));
  const profiles = userIds.length ? await context.admin.from("profiles").select("id,full_name").in("id", userIds) : { data: [], error: null };
  if (profiles.error) throw new Error(profiles.error.message);
  const names = new Map((profiles.data ?? []).map((profile: any) => [String(profile.id), profile.full_name]));
  const selectedByRequirement = new Map<string, Set<string>>();
  for (const row of selectedResult.data ?? []) {
    const set = selectedByRequirement.get(String(row.requirement_id)) ?? new Set<string>();
    set.add(String(row.user_id)); selectedByRequirement.set(String(row.requirement_id), set);
  }
  const latest = new Map<string, Date>();
  for (const row of completionsResult.data ?? []) {
    const event = eventOf(row); if (!event?.course_id || !event?.starts_at) continue;
    const key = `${row.user_id}|${event.course_id}`; const date = new Date(event.starts_at);
    if (!latest.has(key) || date > latest.get(key)!) latest.set(key, date);
  }
  const isStaff = hasAnyServerPermission(context, ["manage_training", "manage_certifications", "view_command_dashboard"]);
  const currentUserId = String(context.user?.id ?? context.userId);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const alerts: Alert[] = [];

  for (const requirement of requirementsResult.data ?? []) {
    const selected = selectedByRequirement.get(String(requirement.id)) ?? new Set<string>();
    const warningDays = Array.isArray(requirement.warning_days) ? requirement.warning_days.map(Number) : [90,60,30,14,7,0];
    const maximumWarning = Math.max(0, ...warningDays);
    for (const member of members) {
      if (!applies(requirement, member, selected)) continue;
      const memberId = String(member.user_id);
      const completion = latest.get(`${memberId}|${requirement.course_id}`);
      const due = dueDate(requirement, completion);
      const daysUntil = due ? Math.ceil((due.getTime() - today.getTime()) / 86400000) : null;
      const missing = !completion;
      const expired = daysUntil != null && daysUntil < -Number(requirement.grace_days ?? 0);
      const dueSoon = daysUntil != null && daysUntil >= -Number(requirement.grace_days ?? 0) && daysUntil <= maximumWarning;
      if (!missing && !expired && !dueSoon) continue;
      const course = requirement.agency_training_courses?.canonical_title ?? requirement.requirement_name;
      const name = names.get(memberId) ?? "Department Member";
      const kind = missing ? "agency_training_missing" : expired ? "agency_training_overdue" : "agency_training_due_soon";
      const priority: Priority = expired ? "Critical" : missing || (daysUntil ?? 999) <= 30 ? "High" : "Normal";
      const timing = missing ? "has no recorded completion" : expired ? `was due ${due!.toLocaleDateString("en-US", { timeZone: "UTC" })}` : `is due ${due!.toLocaleDateString("en-US", { timeZone: "UTC" })}`;
      if (memberId === currentUserId && requirement.notify_member_inbox) alerts.push({
        key: `agency-training:member:${requirement.id}:${memberId}`, source: "Training", kind,
        title: missing ? `${course} Required` : expired ? `${course} Overdue` : `${course} Due Soon`,
        detail: `${requirement.requirement_name} ${timing}.`, href: "/agency-training", priority,
        createdAt: due?.toISOString() ?? requirement.created_at, emailEnabled: requirement.notify_member_email !== false,
      });
      if (isStaff && memberId !== currentUserId && requirement.notify_training_staff_inbox) alerts.push({
        key: `agency-training:staff:${requirement.id}:${memberId}`, source: "Training", kind: `${kind}_staff`,
        title: `${name}: ${missing ? "Training Missing" : expired ? "Training Overdue" : "Training Due Soon"}`,
        detail: `${course} ${timing}.`, href: "/agency-training", priority,
        createdAt: due?.toISOString() ?? requirement.created_at, emailEnabled: requirement.notify_training_staff_email !== false,
      });
    }
  }
  return alerts;
}