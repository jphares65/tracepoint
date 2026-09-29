export function shouldRouteToPlatformConsole(input: {
  isPlatformAdmin: boolean;
  hasActiveDepartmentMembership: boolean;
}): boolean {
  return input.isPlatformAdmin && !input.hasActiveDepartmentMembership;
}
