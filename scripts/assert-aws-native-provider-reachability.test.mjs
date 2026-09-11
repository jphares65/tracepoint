import assert from "node:assert/strict";import test from "node:test";import{auditedDirectUsages}from"./assert-aws-native-provider-reachability.mjs";
test("all nineteen reviewed direct usages have an explicit disposition",()=>assert.equal(new Set(auditedDirectUsages).size,19));
