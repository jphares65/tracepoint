export type AssignedOfficerIdentity = {
  assigned_to_name?: string | null;
  assigned_to_badge_number?: string | null;
  assigned_to_unit_name?: string | null;
};

export function getAssignedOfficerContext(
  assignment?: AssignedOfficerIdentity | null,
) {
  if (!assignment) return "";

  const badge = assignment.assigned_to_badge_number?.trim();
  const unit = assignment.assigned_to_unit_name?.trim();

  return [badge ? `#${badge}` : null, unit].filter(Boolean).join(" · ");
}

export function getAssignedOfficerDisplayName(
  assignment?: AssignedOfficerIdentity | null,
) {
  const name = assignment?.assigned_to_name?.trim() || "Unknown User";
  const context = getAssignedOfficerContext(assignment);

  return context ? `${name} — ${context}` : name;
}
