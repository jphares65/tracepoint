import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ProductionDnsRecordSet, ProductionDnsRecordsStack, ProductionDnsZoneStack } from "../lib/production-dns-stack";

const config = JSON.parse(readFileSync(resolve(process.cwd(), "config/production-dns-target.json"), "utf8")) as {
  zoneName: "tracepointhq.com";
  expectedAccount: "193644343389";
  expectedRegion: "us-east-1";
  cutoverReady: boolean;
  preCutoverDeploymentReady: boolean;
  signedInWixExportVerified: boolean;
  cutoverBlockers: string[];
  recordSets: ProductionDnsRecordSet[];
};

function templates(records = config.recordSets): { zone: Template; records: Template } {
  const app = new cdk.App();
  const props = {
      env: { account: config.expectedAccount, region: config.expectedRegion },
      expectedAccount: config.expectedAccount,
      expectedRegion: config.expectedRegion,
      zoneName: config.zoneName,
  };
  const zone = new ProductionDnsZoneStack(app, "zone", props);
  const recordStack = new ProductionDnsRecordsStack(app, "records", {...props, hostedZone: zone.hostedZone, recordSets: records});
  return {zone: Template.fromStack(zone), records: Template.fromStack(recordStack)};
}

test("prepared production DNS zone contains only one hosted zone and reviewed record sets", () => {
  const synthesized = templates();
  synthesized.zone.resourceCountIs("AWS::Route53::HostedZone", 1);
  synthesized.zone.resourceCountIs("AWS::Route53::RecordSet", 0);
  synthesized.records.resourceCountIs("AWS::Route53::HostedZone", 0);
  synthesized.records.resourceCountIs("AWS::Route53::RecordSet", config.recordSets.length);
  for (const forbidden of ["AWS::ECS::Service", "AWS::RDS::DBInstance", "AWS::Cognito::UserPool", "AWS::Lambda::Function"]) {
    synthesized.zone.resourceCountIs(forbidden, 0);
    synthesized.records.resourceCountIs(forbidden, 0);
  }
  const json = {zone: synthesized.zone.toJSON(), records: synthesized.records.toJSON()};
  assert.equal(JSON.stringify(json).includes("AWS::Route53Domains"), false);
});

test("Microsoft 365 records and SES MAIL FROM remain separate", () => {
  const synthesized = templates().records;
  synthesized.hasResourceProperties("AWS::Route53::RecordSet", {
    Name: "tracepointhq.com",
    Type: "MX",
    ResourceRecords: ["10 tracepointhq-com.mail.protection.outlook.com"],
  });
  synthesized.hasResourceProperties("AWS::Route53::RecordSet", {
    Name: "tracepointhq.com",
    Type: "TXT",
    ResourceRecords: Match.arrayWith(['"v=spf1 include:spf.protection.outlook.com -all"']),
  });
  synthesized.hasResourceProperties("AWS::Route53::RecordSet", {
    Name: "bounce.tracepointhq.com",
    Type: "MX",
    TTL: "300",
    ResourceRecords: ["10 feedback-smtp.us-east-1.amazonses.com"],
  });
  synthesized.hasResourceProperties("AWS::Route53::RecordSet", {
    Name: "bounce.tracepointhq.com",
    Type: "TXT",
    ResourceRecords: ['"v=spf1 include:amazonses.com ~all"'],
  });
});

test("all six owner-specified SES records are exact and DNSSEC delegation is not synthesized", () => {
  const ses = config.recordSets.filter((record) => !record.name.includes("staging.tracepointhq.com") && /amazonses|DMARC1/.test(record.values.join(" ")));
  assert.equal(ses.length, 6);
  assert.deepEqual(
    ses.filter((record) => record.type === "CNAME").map((record) => record.name).sort(),
    [
      "t3pxf5n23dcf5ahxn4xzhcxfxnvushzh._domainkey.tracepointhq.com",
      "yabannzf7xcqdnbgbxoee5k2c77xktci._domainkey.tracepointhq.com",
      "yiaen5uag5n6evooqpo2rt3earh3zwcq._domainkey.tracepointhq.com",
    ],
  );
  const synthesized = templates().records;
  synthesized.resourceCountIs("AWS::Route53::KeySigningKey", 0);
  synthesized.resourceCountIs("AWS::KMS::Key", 0);
});

test("configuration fails closed for duplicate, cross-zone, or mail-destructive records", () => {
  const duplicate = [...config.recordSets, config.recordSets[0]];
  assert.throws(() => templates(duplicate), /Duplicate DNS RRset/);
  assert.throws(
    () => templates([...config.recordSets, { name: "outside.example", type: "A", ttl: 300, values: ["192.0.2.1"], purpose: "bad" }]),
    /outside production zone/,
  );
  assert.throws(
    () => templates(config.recordSets.filter((record) => !(record.name === config.zoneName && record.type === "MX"))),
    /root MX must be preserved/,
  );
  const unsafe = config.recordSets.map((record) =>
    record.name === config.zoneName && record.type === "TXT"
      ? { ...record, values: [...record.values, "v=spf1 include:amazonses.com ~all"] }
      : record,
  );
  assert.throws(() => templates(unsafe), /SES SPF belongs only/);
});

test("delegation remains blocked while the authorized pre-cutover zone is synthesizable", () => {
  assert.equal(config.cutoverReady, false);
  assert.equal(config.preCutoverDeploymentReady, true);
  assert.equal(config.signedInWixExportVerified, true);
  assert.deepEqual(config.cutoverBlockers, [
    "The registrar transfer is still pending; Wix must remain authoritative until the transfer completes.",
    "Changing the registrar nameserver delegation to the reviewed Route 53 nameservers requires separate owner authorization.",
  ]);
  templates();
});

test("governance confines writes to the reviewed zone, role, names, types, and actions", () => {
  const boundary = JSON.parse(readFileSync(resolve(process.cwd(), "policies/tracepoint-production-boundary.json"), "utf8"));
  const scp = JSON.parse(readFileSync(resolve(process.cwd(), "policies/tracepoint-production-guardrails.scp.json"), "utf8"));
  const allow = boundary.Statement.find((statement: {Sid?: string}) => statement.Sid === "AllowReviewedRoute53RecordChangesViaCloudFormation");
  assert.equal(allow.Action, "route53:ChangeResourceRecordSets");
  assert.equal(allow.Resource, "arn:aws:route53:::hostedzone/Z06725946QWMQBKB1JT8");
  assert.equal(allow.Condition.ArnEquals["aws:PrincipalArn"], "arn:aws:iam::193644343389:role/cdk-hnb659fds-cfn-exec-role-193644343389-us-east-1");
  assert.deepEqual(allow.Condition["ForAllValues:StringEquals"]["route53:ChangeResourceRecordSetsActions"], ["CREATE", "UPSERT", "DELETE"]);
  assert.deepEqual(allow.Condition["ForAllValues:StringEquals"]["route53:ChangeResourceRecordSetsRecordTypes"], ["A", "CNAME", "MX", "SRV", "TXT"]);
  assert.equal(allow.Condition["ForAllValues:StringEquals"]["route53:ChangeResourceRecordSetsNormalizedRecordNames"].length, 26);
  assert.ok(Object.values(allow.Condition.Null).every((value) => value === "false"));
  assert.equal(boundary.Statement.some((statement: {Action?: string | string[]}) => (JSON.stringify(statement.Action) ?? "").includes("route53:CreateHostedZone")), false);
  const registrarDeny = scp.Statement.find((statement: {Sid?: string}) => statement.Sid === "DenyProductionRegistrarMutations");
  assert.ok(registrarDeny.Action.includes("route53domains:UpdateDomainNameservers"));
  const outside = scp.Statement.find((statement: {Sid?: string}) => statement.Sid === "DenyDnsRecordChangesOutsideReviewedZone");
  assert.equal(outside.NotResource, "arn:aws:route53:::hostedzone/Z06725946QWMQBKB1JT8");
});

test("signed-in Wix reconciliation additions are exact and complete", () => {
  const expected: Record<string, string> = {
    "_cf183eaeec77acfda74681d687456469.tracepointhq.com": "_09b5cb9ef970b57b1d638cd814364d07.jkddzztszm.acm-validations.aws",
    "_cf391b761ec604139a02ad89ac26fc3b.staging.tracepointhq.com": "_0c3b1ad8d569000f2d926c56c9c29f47.jkddzztszm.acm-validations.aws",
    "3drryitjdubjinnkgryh3tbpzxoinewk._domainkey.staging.tracepointhq.com": "3drryitjdubjinnkgryh3tbpzxoinewk.dkim.amazonses.com",
    "e5uy6cdpk3j3wy2iezyywdqqqqhoerdu._domainkey.staging.tracepointhq.com": "e5uy6cdpk3j3wy2iezyywdqqqqhoerdu.dkim.amazonses.com",
    "vzklmpevtuvf4g3sqev3y3z7eknsmsu5._domainkey.staging.tracepointhq.com": "vzklmpevtuvf4g3sqev3y3z7eknsmsu5.dkim.amazonses.com",
    "bounce.staging.tracepointhq.com": "v=spf1 include:amazonses.com -all",
  };
  const additions = config.recordSets.filter((record) => record.name in expected);
  assert.equal(additions.length, 6);
  for (const record of additions) {
    assert.deepEqual(record.values, [expected[record.name]]);
    assert.equal(record.ttl, 3600);
  }
  templates().records.resourceCountIs("AWS::Route53::RecordSet", 29);
});
