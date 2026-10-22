// UX-RB2-6 (E-52): with B2 (NEW-ADM-C) a Super Admin module switch takes effect
// for the whole agency at once. Turning a module off is confirmed, naming the
// module and the agency; either change then says what happened.
export function moduleDisableConfirmation(moduleName: string, agencyName: string) {
  return `Turn off ${moduleName} for ${agencyName}? Everyone in ${agencyName} loses access to ${moduleName} until it is turned back on. Existing records are not deleted.`;
}

export function moduleSwitchNotice(moduleName: string, agencyName: string, enabled: boolean) {
  return `${moduleName} is now ${enabled ? "on" : "off"} for ${agencyName}.`;
}
