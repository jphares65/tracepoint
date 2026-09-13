import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ProductionDnsRecordSet, ProductionDnsStack } from "../lib/production-dns-stack";

const config = JSON.parse(readFileSync(resolve(process.cwd(), "config/production-dns-target.json"), "utf8")) as {
  zoneName: "tracepointhq.com";
  expectedAccount: "193644343389";
  expectedRegion: "us-east-1";
  cutoverReady: boolean;
  cutoverBlockers: string[];
  recordSets: ProductionDnsRecordSet[];
};

function template(records = config.recordSets): Template {
  const app = new cdk.App();
  return Template.fromStack(
    new ProductionDnsStack(app, "dns", {
      env: { account: config.expectedAccount, region: config.expectedRegion },
      expectedAccount: config.expectedAccount,
      expectedRegion: config.expectedRegion,
      zoneName: config.zoneName,
      recordSets: records,
    }),
  );
}

test("prepared production DNS zone contains only one hosted zone and reviewed record sets", () => {
  const synthesized = template();
  synthesized.resourceCountIs("AWS::Route53::HostedZone", 1);
  synthesized.resourceCountIs("AWS::Route53::RecordSet", config.recordSets.length);
  for (const forbidden of ["AWS::ECS::Service", "AWS::RDS::DBInstance", "AWS::Cognito::UserPool", "AWS::Lambda::Function"]) {
    synthesized.resourceCountIs(forbidden, 0);
  }
  const json = synthesized.toJSON();
  assert.equal(JSON.stringify(json).includes("AWS::Route53Domains"), false);
});

test("Microsoft 365 records and SES MAIL FROM remain separate", () => {
  const synthesized = template();
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
  const ses = config.recordSets.filter((record) => /amazonses|DMARC1/.test(record.values.join(" ")));
  assert.equal(ses.length, 6);
  assert.deepEqual(
    ses.filter((record) => record.type === "CNAME").map((record) => record.name).sort(),
    [
      "t3pxf5n23dcf5ahxn4xzhcxfxnvushzh._domainkey.tracepointhq.com",
      "yabannzf7xcqdnbgbxoee5k2c77xktci._domainkey.tracepointhq.com",
      "yiaen5uag5n6evooqpo2rt3earh3zwcq._domainkey.tracepointhq.com",
    ],
  );
  const synthesized = template();
  synthesized.resourceCountIs("AWS::Route53::KeySigningKey", 0);
  synthesized.resourceCountIs("AWS::KMS::Key", 0);
});

test("configuration fails closed for duplicate, cross-zone, or mail-destructive records", () => {
  const duplicate = [...config.recordSets, config.recordSets[0]];
  assert.throws(() => template(duplicate), /Duplicate DNS RRset/);
  assert.throws(
    () => template([...config.recordSets, { name: "outside.example", type: "A", ttl: 300, values: ["192.0.2.1"], purpose: "bad" }]),
    /outside production zone/,
  );
  assert.throws(
    () => template(config.recordSets.filter((record) => !(record.name === config.zoneName && record.type === "MX"))),
    /root MX must be preserved/,
  );
  const unsafe = config.recordSets.map((record) =>
    record.name === config.zoneName && record.type === "TXT"
      ? { ...record, values: [...record.values, "v=spf1 include:amazonses.com ~all"] }
      : record,
  );
  assert.throws(() => template(unsafe), /SES SPF belongs only/);
});

test("live blockers prevent deployment mode while preview remains synthesizable", () => {
  assert.equal(config.cutoverReady, false);
  assert.ok(config.cutoverBlockers.length >= 4);
  template();
});
