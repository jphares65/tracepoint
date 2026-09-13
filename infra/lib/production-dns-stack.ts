import * as cdk from "aws-cdk-lib";
import * as route53 from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";

export type ProductionDnsRecordType = "A" | "AAAA" | "CAA" | "CNAME" | "MX" | "SRV" | "TXT";

export interface ProductionDnsRecordSet {
  name: string;
  type: ProductionDnsRecordType;
  ttl: number;
  values: string[];
  purpose: string;
}

export interface ProductionDnsCommonProps extends cdk.StackProps {
  expectedAccount: "193644343389";
  expectedRegion: "us-east-1";
  zoneName: "tracepointhq.com";
}

export interface ProductionDnsZoneStackProps extends ProductionDnsCommonProps {}
export interface ProductionDnsRecordsStackProps extends ProductionDnsCommonProps {
  hostedZone: route53.IHostedZone;
  recordSets: ProductionDnsRecordSet[];
}

function quoteTxt(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function validateBoundary(stack: cdk.Stack, props: ProductionDnsCommonProps): void {
  if (stack.account !== props.expectedAccount || stack.region !== props.expectedRegion || props.zoneName !== "tracepointhq.com") {
    throw new Error("Exact TracePoint production DNS boundary required");
  }
}

export class ProductionDnsZoneStack extends cdk.Stack {
  readonly hostedZone: route53.PublicHostedZone;

  constructor(scope: Construct, id: string, props: ProductionDnsZoneStackProps) {
    super(scope, id, props);
    validateBoundary(this, props);

    this.hostedZone = new route53.PublicHostedZone(this, "Zone", {
      zoneName: props.zoneName,
      comment: "TracePoint production authoritative DNS; activation requires separate registrar and DNSSEC authorization",
    });
    const cfnZone = this.hostedZone.node.defaultChild as route53.CfnHostedZone;
    cfnZone.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    new cdk.CfnOutput(this, "HostedZoneId", { value: this.hostedZone.hostedZoneId });
    new cdk.CfnOutput(this, "AssignedNameServers", { value: cdk.Fn.join(",", this.hostedZone.hostedZoneNameServers ?? []) });
    addCommonOutputsAndTags(this);
  }
}

export class ProductionDnsRecordsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ProductionDnsRecordsStackProps) {
    super(scope, id, props);
    validateBoundary(this, props);

    const identities = new Set<string>();
    for (const record of props.recordSets) {
      const identity = `${record.name.toLowerCase()}|${record.type}`;
      if (identities.has(identity)) throw new Error(`Duplicate DNS RRset: ${identity}`);
      identities.add(identity);
      if (!record.name.toLowerCase().endsWith(`.${props.zoneName}`) && record.name.toLowerCase() !== props.zoneName) {
        throw new Error(`Record outside production zone: ${record.name}`);
      }
      if (!Number.isInteger(record.ttl) || record.ttl < 60 || record.values.length === 0) {
        throw new Error(`Invalid DNS RRset: ${identity}`);
      }
    }

    const rootMx = props.recordSets.find((record) => record.name === props.zoneName && record.type === "MX");
    const rootTxt = props.recordSets.find((record) => record.name === props.zoneName && record.type === "TXT");
    if (!rootMx?.values.includes("10 tracepointhq-com.mail.protection.outlook.com")) {
      throw new Error("Microsoft 365 root MX must be preserved");
    }
    if (!rootTxt?.values.includes("v=spf1 include:spf.protection.outlook.com -all")) {
      throw new Error("Microsoft 365 root SPF must be preserved");
    }
    if (rootTxt.values.some((value) => value.includes("amazonses.com"))) {
      throw new Error("SES SPF belongs only on the MAIL FROM subdomain");
    }

    props.recordSets.forEach((record, index) => {
      new route53.CfnRecordSet(this, `Record${String(index + 1).padStart(2, "0")}`, {
        hostedZoneId: props.hostedZone.hostedZoneId,
        name: record.name,
        type: record.type,
        ttl: String(record.ttl),
        resourceRecords: record.values.map((value) => (record.type === "TXT" ? quoteTxt(value) : value)),
      });
    });

    new cdk.CfnOutput(this, "HostedZoneId", { value: props.hostedZone.hostedZoneId });
    addCommonOutputsAndTags(this);
  }
}

function addCommonOutputsAndTags(stack: cdk.Stack): void {
    new cdk.CfnOutput(stack, "ActivationGate", {
      value:
        "DISABLED: do not delegate until Wix export parity, DMARC resolution, parent DS removal/expiry, direct authoritative validation, and separate nameserver authorization are complete",
    });
    new cdk.CfnOutput(stack, "DnssecGate", {
      value:
        "DISABLED DURING DELEGATION MIGRATION: enable Route 53 DNSSEC and publish its new DS only after unsigned delegation is stable",
    });

    cdk.Tags.of(stack).add("Application", "TracePoint");
    cdk.Tags.of(stack).add("Environment", "production");
    cdk.Tags.of(stack).add("ManagedBy", "AWS-CDK");
    cdk.Tags.of(stack).add("CostCenter", "TracePoint-Production");
    cdk.Tags.of(stack).add("MigrationPhase", "dns-preparation");
}
