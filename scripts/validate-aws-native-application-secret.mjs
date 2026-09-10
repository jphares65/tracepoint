import { validateAwsNativeApplicationSecret } from "./aws-native-application-secret-core.mjs";

const environment = process.argv[2];
let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
  validateAwsNativeApplicationSecret(JSON.parse(input), environment);
  console.log(JSON.stringify({ environment, valid: true, legacyProviderFields: 0, valuesPrinted: false }));
} catch {
  console.error("AWS-native application secret validation failed; values suppressed.");
  process.exitCode = 1;
}
