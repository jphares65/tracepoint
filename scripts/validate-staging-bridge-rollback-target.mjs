import { validateStagingBridgeRollbackTarget } from "./staging-bridge-rollback-core.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
  const result = validateStagingBridgeRollbackTarget(JSON.parse(input).taskDefinition);
  console.log(JSON.stringify(result));
} catch {
  console.error("Retained staging bridge rollback target validation failed; values suppressed.");
  process.exitCode = 1;
}
