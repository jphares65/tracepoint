import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const account = "193644343389";
const region = "us-east-1";
const setName = "tracepoint-production-isolated-ses-proof-20260926";
const destinationName = "proof-feedback";
const topicArn = `arn:aws:sns:${region}:${account}:tracepoint-production-isolated-ses-proof-feedback`;
const expectedTypes = ["BOUNCE", "COMPLAINT", "DELIVERY"];
const mode = process.argv[2];
if (process.env.TRACEPOINT_ISOLATED_SES_PROOF_CONFIG !== "20260926" || mode !== "ensure") {
  throw new Error("Exact isolated SES proof configuration acknowledgement required.");
}

function aws(service, operation, args = []) {
  try {
    const output = execFileSync("aws", [service, operation, ...args, "--profile", "tracepoint-production",
      "--region", region, "--output", "json"], { encoding: "utf8", maxBuffer: 2_000_000 });
    return output.trim() ? JSON.parse(output) : {};
  } catch (error) {
    throw new Error(`AWS ${service} ${operation} failed (${error.status ?? "unknown"}); inspect sanitized CloudTrail.`);
  }
}

const caller = aws("sts", "get-caller-identity");
assert.equal(caller.Account, account);
assert.equal(caller.Arn, `arn:aws:sts::${account}:assumed-role/TracePointMigrationProduction/tracepoint-production`);

const names = aws("sesv2", "list-configuration-sets").ConfigurationSets;
if (!names.includes(setName)) {
  aws("sesv2", "create-configuration-set", ["--configuration-set-name", setName,
    "--delivery-options", JSON.stringify({ TlsPolicy: "REQUIRE" }),
    "--sending-options", JSON.stringify({ SendingEnabled: true }),
    "--suppression-options", JSON.stringify({ SuppressedReasons: ["BOUNCE", "COMPLAINT"] })]);
}
const set = aws("sesv2", "get-configuration-set", ["--configuration-set-name", setName]);
assert.equal(set.ConfigurationSetName, setName);
assert.equal(set.DeliveryOptions?.TlsPolicy, "REQUIRE");
assert.equal(set.SendingOptions?.SendingEnabled, true);
assert.deepEqual([...set.SuppressionOptions.SuppressedReasons].sort(), ["BOUNCE", "COMPLAINT"]);

const destinations = aws("sesv2", "get-configuration-set-event-destinations", ["--configuration-set-name", setName]).EventDestinations;
if (!destinations.some(destination => destination.Name === destinationName)) {
  aws("sesv2", "create-configuration-set-event-destination", ["--configuration-set-name", setName,
    "--event-destination", JSON.stringify({ Name: destinationName, Enabled: true,
      MatchingEventTypes: expectedTypes, SnsDestination: { TopicArn: topicArn } })]);
}
const current = aws("sesv2", "get-configuration-set-event-destinations", ["--configuration-set-name", setName]).EventDestinations;
assert.equal(current.length, 1);
assert.equal(current[0].Name, destinationName);
assert.equal(current[0].Enabled, true);
assert.deepEqual([...current[0].MatchingEventTypes].sort(), expectedTypes);
assert.equal(current[0].SnsDestination?.TopicArn, topicArn);
console.log(JSON.stringify({ event: "ISOLATED_SES_PROOF_CONFIGURATION_READY", configurationSet: setName,
  eventDestination: destinationName, topicArn, productionConfigurationSetUnmodified: true }));
