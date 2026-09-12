import * as cdk from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { execFileSync } from "node:child_process";
import { SesFoundationStack } from "../lib/ses-foundation-stack";

const app = new cdk.App();
const account = app.node.tryGetContext("account");
const region = app.node.tryGetContext("region");
const operation = app.node.tryGetContext("productionOperation");
const authorizationReference = app.node.tryGetContext("authorizationReference");

if (
  account !== "193644343389" ||
  region !== "us-east-1" ||
  !["preview", "authorized"].includes(operation) ||
  !/^OWNER-SES-[A-Z0-9._:/-]{8,120}$/.test(authorizationReference ?? "")
) {
  throw new Error("Exact production SES target and owner authorization reference are required");
}

if (operation === "authorized") {
  if (process.env.TRACEPOINT_PRODUCTION_SES_AUTHORIZATION !== authorizationReference) {
    throw new Error("Matching production SES authorization is required");
  }
  let identity: { Account?: string; Arn?: string };
  try {
    identity = JSON.parse(
      execFileSync("aws.exe", ["sts", "get-caller-identity", "--region", region, "--output", "json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch {
    throw new Error("Production identity unavailable");
  }
  if (
    identity.Account !== account ||
    !new RegExp(`^arn:aws:sts::${account}:assumed-role/TracePointMigrationProduction/[^/]+$`).test(identity.Arn ?? "")
  ) {
    throw new Error("Exact production migration role required");
  }
}

new SesFoundationStack(app, "tracepoint-production-full-aws-ses", {
  env: { account, region },
  environmentName: "production",
  mailFromSubdomain: "bounce",
  terminationProtection: true,
  description: "TracePoint production SES identity and encrypted feedback foundation",
  tags: {
    Application: "TracePoint",
    Environment: "production",
    Owner: "TracePoint",
    ManagedBy: "AWS-CDK",
    CostCenter: "TracePoint-Production",
    DataClassification: "PublicSafety-Sensitive",
    ArchitectureTarget: "full-aws",
    MigrationPhase: "ses-authorized-foundation",
  },
});

cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
