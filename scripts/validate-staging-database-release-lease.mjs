import { validateStoredLease } from "./database-lease-governance-core.mjs";
import { stripByteOrderMark } from "./stdin-json.mjs";

let text = "";
for await (const part of process.stdin) text += part;
try {
  console.log(JSON.stringify(validateStoredLease(JSON.parse(stripByteOrderMark(text)))));
} catch {
  console.error("Staging database release lease is invalid.");
  process.exitCode = 1;
}
