#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { createProductionReconciliationContract } from "./production-reconciliation-contract-core.mjs";

const args = process.argv.slice(2);
assert.deepEqual(args.slice(0, 1), ["--inventory"]);
assert.equal(args[2], "--output");
assert.equal(args.length, 4, "Usage: node scripts/create-production-reconciliation-contract.mjs --inventory FILE --output FILE");
const inventory = JSON.parse(await readFile(path.resolve(args[1]), "utf8"));
const contract = createProductionReconciliationContract(inventory);
const output = path.resolve(args[3]);
await mkdir(path.dirname(output), { recursive: true });
const temporary = `${output}.${process.pid}.tmp`;
const handle = await open(temporary, "wx", 0o600);
try { await handle.writeFile(`${JSON.stringify(contract, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
await rename(temporary, output);
console.log(JSON.stringify({ created: true, rows: contract.database.exposedRows, identities: contract.identity.users, objects: contract.storage.objects, sensitiveValuesEmitted: false, contentSha256: contract.contentSha256 }));
