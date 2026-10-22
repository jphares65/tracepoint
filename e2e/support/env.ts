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

// Only explicitly approved staging origins are accepted. Adding one is a
// reviewed code change; an environment variable can choose among these but
// can never add a host. Production is therefore never reachable from here.
export const APPROVED_STAGING_ORIGINS = ["https://staging.tracepointhq.com"] as const;

export function baseUrl() {
  const requested = process.env.TRACEPOINT_E2E_BASE_URL || APPROVED_STAGING_ORIGINS[0];
  let origin: string;
  try {
    const url = new URL(requested);
    if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) throw new Error();
    origin = url.origin.toLowerCase();
  } catch {
    throw new Error(`TRACEPOINT_E2E_BASE_URL must be a bare origin such as ${APPROVED_STAGING_ORIGINS[0]}.`);
  }
  if (!(APPROVED_STAGING_ORIGINS as readonly string[]).includes(origin)) {
    throw new Error(`Refusing to run end-to-end tests against ${origin}: not an approved staging origin (${APPROVED_STAGING_ORIGINS.join(", ")}).`);
  }
  return origin;
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
