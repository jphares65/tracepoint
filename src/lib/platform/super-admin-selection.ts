/**
 * The agency the Super Admin module switches apply to. A choice already made on the page is kept; otherwise
 * the agency the administrator is working in (their active or Support Mode agency) is preselected, and only
 * then the first agency in the list. Defaulting to the first agency let a switch flipped under the Support
 * Mode banner of one agency change a different agency.
 */
export function initialSuperAdminDepartment(
  current: string,
  departments: readonly { id: string }[],
  activeDepartmentId: string | null | undefined,
) {
  const listed = (id: string | null | undefined) => !!id && departments.some((department) => department.id === id);
  if (listed(current)) return current;
  if (listed(activeDepartmentId)) return activeDepartmentId as string;
  return departments[0]?.id ?? "";
}
