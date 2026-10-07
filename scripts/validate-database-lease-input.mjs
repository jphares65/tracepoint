import { validateLease } from "./database-lease-governance-core.mjs";
try { console.log(validateLease({ expiresAfterUtc: process.argv[2], leaseOwner: process.argv[3], leaseReference: process.argv[4] })); } catch { console.error("Invalid bounded staging lease."); process.exitCode=1; }
