import * as cdk from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ProductionDnsRecordSet, ProductionDnsStack } from "../lib/production-dns-stack";

interface ProductionDnsConfig {
  zoneName: "tracepointhq.com";
  expectedAccount: "193644343389";
  expectedRegion: "us-east-1";
  cutoverReady: boolean;
  cutoverBlockers: string[];
  recordSets: ProductionDnsRecordSet[];
}

const app = new cdk.App();
const operation = app.node.tryGetContext("productionOperation");
const authorizationReference = app.node.tryGetContext("authorizationReference");
const config = JSON.parse(
  readFileSync(resolve(__dirname, "../config/production-dns-target.json"), "utf8"),
) as ProductionDnsConfig;

if (
  !["preview", "authorized"].includes(operation) ||
  !/^OWNER-ROUTE53-[A-Z0-9._:/-]{8,120}$/.test(authorizationReference ?? "")
) {
  throw new Error("Exact production Route 53 operation and owner authorization reference are required");
}

if (operation === "authorized") {
  if (!config.cutoverReady || config.cutoverBlockers.length !== 0) {
    throw new Error("Production DNS cutover blockers must be resolved before an authorized deployment");
  }
  if (process.env.TRACEPOINT_PRODUCTION_ROUTE53_AUTHORIZATION !== authorizationReference) {
    throw new Error("Matching production Route 53 authorization is required");
  }
  let identity: { Account?: string; Arn?: string };
  try {
    identity = JSON.parse(
      execFileSync("aws.exe", ["sts", "get-caller-identity", "--region", config.expectedRegion, "--output", "json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch {
    throw new Error("Production identity unavailable");
  }
  if (
    identity.Account !== config.expectedAccount ||
    !new RegExp(`^arn:aws:sts::${config.expectedAccount}:assumed-role/TracePointMigrationProduction/[^/]+$`).test(
      identity.Arn ?? "",
    )
  ) {
    throw new Error("Exact production migration role required");
  }
}

new ProductionDnsStack(app, "tracepoint-production-authoritative-dns", {
  env: { account: config.expectedAccount, region: config.expectedRegion },
  expectedAccount: config.expectedAccount,
  expectedRegion: config.expectedRegion,
  zoneName: config.zoneName,
  recordSets: config.recordSets,
  terminationProtection: true,
  description: "Prepared TracePoint Route 53 authoritative zone; no registrar or traffic mutation",
});

cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
