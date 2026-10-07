import { validateStoredLease } from "./database-lease-governance-core.mjs";

let text = "";
for await (const part of process.stdin) text += part;
try {
  console.log(JSON.stringify(validateStoredLease(JSON.parse(text))));
} catch {
  console.error("Staging database release lease is invalid.");
  process.exitCode = 1;
}
