export function explicitApprovalComplete(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const approval = value as Record<string, unknown>;
  return approval.domain === true && approval.mappings === true && approval.validation === true && approval.finalAction === true;
}
