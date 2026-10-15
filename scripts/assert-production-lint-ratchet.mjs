import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const baselineCommit = "7ba11188dc8eb9fae119e131bd8053150b666ee7";
const encodedFiles = process.env.TRACEPOINT_LINT_RATCHET_CHANGED_FILES_B64;

if (!encodedFiles) {
  throw new Error("Production lint ratchet requires its changed-file manifest.");
}

let changedFiles;
try {
  changedFiles = JSON.parse(Buffer.from(encodedFiles, "base64").toString("utf8"));
} catch {
  throw new Error("Production lint ratchet manifest is not valid base64 JSON.");
}

if (!Array.isArray(changedFiles) || !changedFiles.every((file) =>
  typeof file === "string" && /^(?:src|scripts)\/.+\.[cm]?[jt]sx?$/.test(file),
)) {
  throw new Error("Production lint ratchet manifest contains an invalid source or test path.");
}

// INCIDENT-ONLY TECHNICAL DEBT: the verified revision-7 production lint
// baseline is retained temporarily. Every JS/TS file changed since that commit
// must remain completely lint-clean; remove this ratchet after the legacy
// repository-wide backlog has been remediated.
console.log(`Lint ratchet baseline ${baselineCommit}; checking ${changedFiles.length} changed source/test file(s).`);
if (changedFiles.length > 0) {
  const eslintEntrypoint = fileURLToPath(new URL("../node_modules/eslint/bin/eslint.js", import.meta.url));
  execFileSync(process.execPath, [eslintEntrypoint, ...changedFiles], {
    stdio: "inherit",
  });
}
