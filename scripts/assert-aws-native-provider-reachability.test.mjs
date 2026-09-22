import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { scanAwsNativeProviderReachability } from "./assert-aws-native-provider-reachability.mjs";

function fixture(entrySource, dependencySource = "export const ok = true;") {
  const root = mkdtempSync(path.join(tmpdir(), "tracepoint-provider-reachability-"));
  mkdirSync(path.join(root, "src/app/home"), { recursive: true });
  mkdirSync(path.join(root, "src/lib"), { recursive: true });
  writeFileSync(path.join(root, "src/app/home/page.ts"), entrySource);
  writeFileSync(path.join(root, "src/lib/dependency.ts"), dependencySource);
  return root;
}

test("accepts reviewed dynamic rollback edges without treating them as static native dependencies", () => {
  const root = fixture('import "@/lib/dependency"; export async function bridge(){ return import("@/lib/supabase/server"); }');
  try {
    const result = scanAwsNativeProviderReachability({ root, approvedDynamicLegacyImports: { "src/app/home/page.ts": ["@/lib/supabase/server"] } });
    assert.equal(result.staticLegacyEdges, 0);
    assert.equal(result.reviewedDynamicBridgeEdges, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rejects static and unreviewed dynamic legacy-provider edges", () => {
  const staticRoot = fixture('import "@/lib/supabase/server"; export default function Page(){}');
  const dynamicRoot = fixture('export async function bridge(){ return import("@/lib/supabase/server"); }');
  try {
    assert.throws(() => scanAwsNativeProviderReachability({ root: staticRoot, approvedDynamicLegacyImports: {} }), /statically reach legacy providers/);
    assert.throws(() => scanAwsNativeProviderReachability({ root: dynamicRoot, approvedDynamicLegacyImports: {} }), /unreviewed dynamic legacy-provider imports/);
  } finally {
    rmSync(staticRoot, { recursive: true, force: true });
    rmSync(dynamicRoot, { recursive: true, force: true });
  }
});

test("traverses nonlegacy dynamic imports and rejects hidden legacy edges", () => {
  const root = fixture('export async function load(){ return import("@/lib/dependency"); }', 'import "@/lib/supabase/server"; export const ok = true;');
  try {
    assert.throws(() => scanAwsNativeProviderReachability({ root, approvedDynamicLegacyImports: {} }), /statically reach legacy providers/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rejects unreviewed hardcoded legacy endpoints", () => {
  const root = fixture('export const endpoint = "https://api.brevo.com/v3/smtp/email";');
  try {
    assert.throws(() => scanAwsNativeProviderReachability({ root, approvedDynamicLegacyImports: {}, approvedLegacyEndpointLiterals: {} }), /unreviewed legacy-provider endpoints/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
