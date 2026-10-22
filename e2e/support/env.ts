// Staging end-to-end configuration. Everything sensitive comes from the
// environment; nothing here has a default credential.
export const ROLES = ["manager", "instructor", "instructor2", "armorer", "officer", "fleetManager"] as const;
export type Role = (typeof ROLES)[number];

const ENV_ROLE: Record<Role, string> = {
  manager: "MANAGER",
  instructor: "INSTRUCTOR",
  instructor2: "INSTRUCTOR2",
  armorer: "ARMORER",
  officer: "OFFICER",
  fleetManager: "FLEET_MANAGER",
};

// The production hosts are refused outright: these tests create records.
const FORBIDDEN_HOSTS = new Set(["tracepointhq.com", "www.tracepointhq.com"]);

export function baseUrl() {
  const value = process.env.TRACEPOINT_E2E_BASE_URL || "https://staging.tracepointhq.com";
  const host = new URL(value).hostname.toLowerCase();
  if (FORBIDDEN_HOSTS.has(host)) {
    throw new Error(`Refusing to run end-to-end tests against production (${host}).`);
  }
  return value.replace(/\/$/, "");
}

export function syntheticAgency() {
  const departmentId = process.env.TRACEPOINT_E2E_DEPARTMENT_ID;
  const name = process.env.TRACEPOINT_E2E_DEPARTMENT_NAME;
  if (!departmentId || !name) {
    throw new Error("Set TRACEPOINT_E2E_DEPARTMENT_ID and TRACEPOINT_E2E_DEPARTMENT_NAME to the synthetic staging agency.");
  }
  return { departmentId, name };
}

export function credentials(role: Role) {
  const prefix = `TRACEPOINT_E2E_${ENV_ROLE[role]}`;
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  const totpSecret = process.env[`${prefix}_TOTP_SECRET`];
  return email && password && totpSecret ? { email, password, totpSecret } : null;
}

export const storageStatePath = (role: Role) => `e2e/.auth/${role}.json`;

/** A label unique to this run, so synthetic records can be found and told apart. */
export const runLabel = `E2E ${process.env.TRACEPOINT_E2E_RUN_ID || new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)}`;
