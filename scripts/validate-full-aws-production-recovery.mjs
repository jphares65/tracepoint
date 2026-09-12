#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FULL_AWS_PRODUCTION_STACKS, validateFullAwsProductionRecoveryAssembly } from "./full-aws-production-recovery-core.mjs";

const directory = path.resolve(process.argv[2] ?? "");
assert.ok(process.argv[2], "Usage: node scripts/validate-full-aws-production-recovery.mjs CDK_OUT_DIRECTORY");
const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
const templates = {};
for (const stack of FULL_AWS_PRODUCTION_STACKS) {
  const artifact = manifest.artifacts?.[stack];
  assert.ok(artifact?.properties?.templateFile, `${stack} template metadata is absent`);
  templates[stack] = JSON.parse(await readFile(path.join(directory, artifact.properties.templateFile), "utf8"));
}
console.log(JSON.stringify({ ...validateFullAwsProductionRecoveryAssembly({ manifest, templates }), checkedAt: new Date().toISOString() }, null, 2));
