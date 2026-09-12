import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_APPROVED_DYNAMIC_LEGACY_IMPORTS = Object.freeze({
  "src/proxy.ts": ["@/lib/supabase/proxy"],
  "src/app/activate/page.tsx": ["@/lib/supabase/server"],
  "src/app/auth/signout/route.ts": ["@/lib/supabase/server"],
  "src/app/auth/setup/page.tsx": ["@/lib/supabase/admin", "@/lib/supabase/server"],
  "src/app/auth/confirm/route.ts": ["@/lib/supabase/server"],
  "src/app/auth/callback/route.ts": ["@/lib/supabase/server"],
  "src/app/login/LoginForm.tsx": ["@/lib/supabase/client"],
  "src/app/api/settings/users/password-reset/route.ts": ["@/lib/supabase/admin", "@/lib/supabase/server"],
  "src/app/api/settings/users/invite/route.ts": ["@/lib/supabase/admin", "@/lib/supabase/server"],
  "src/app/api/settings/users/activation/route.ts": ["@/lib/supabase/admin", "@/lib/supabase/server"],
  "src/app/api/settings/onboarding/personnel/route.ts": ["@/lib/supabase/admin", "@/lib/supabase/server"],
  "src/app/api/active-department/route.ts": ["@/lib/supabase/admin", "@/lib/supabase/server"],
  "src/app/api/auth/session/refresh/route.ts": ["@/lib/supabase/server"],
  "src/app/api/platform/support-mode/route.ts": ["@/lib/supabase/admin", "@/lib/supabase/server"],
  "src/app/api/notifications/email-dispatch/route.ts": ["@/lib/supabase/admin"],
  "src/lib/tracepoint/activation.ts": ["@/lib/supabase/admin"],
  "src/lib/tracepoint/server-access.ts": ["@/lib/supabase/admin", "@/lib/supabase/server"],
  "src/lib/storage/object-store.ts": ["./supabase-object-store"],
  "src/lib/platform/admin-access.ts": ["@/lib/supabase/admin", "@/lib/supabase/server"],
  "src/lib/authentication/request-session.ts": ["@/lib/supabase/server"],
});
const DEFAULT_APPROVED_LEGACY_ENDPOINT_LITERALS = Object.freeze({
  "src/lib/email/provider-core.ts": ["https://api.brevo.com/v3/smtp/email"],
});

const normalize = value => value.replaceAll("\\", "/");
const legacyProvider = specifier => /(?:^@supabase\/|(?:^|\/)supabase(?:\/|-)|brevo|vercel)/i.test(specifier);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(name) : /\.(?:ts|tsx)$/.test(entry.name) ? [name] : [];
  });
}

function importsFrom(source) {
  const staticSpecifiers = [...source.matchAll(/(?:^|\n)\s*(?!import\s+type\b)(?:import|export)\s+(?:[^"'\n]*?\s+from\s+)?["']([^"']+)["']/g)].map(match => match[1]);
  const dynamicSpecifiers = [...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map(match => match[1]);
  return { staticSpecifiers, dynamicSpecifiers };
}

function legacyEndpointLiteralsFrom(source) {
  return [...source.matchAll(/https?:\/\/[^\s"'`)>]+/g)].map(match => match[0]).filter(value => /(?:\.supabase\.co|\.vercel\.app|api\.brevo\.com|smtp-relay\.brevo\.com)/i.test(value));
}

export function scanAwsNativeProviderReachability({ root = process.cwd(), approvedDynamicLegacyImports = DEFAULT_APPROVED_DYNAMIC_LEGACY_IMPORTS, approvedLegacyEndpointLiterals = DEFAULT_APPROVED_LEGACY_ENDPOINT_LITERALS } = {}) {
  const absoluteSource = path.join(root, "src");
  const absoluteFiles = sourceFiles(absoluteSource);
  const relativeFiles = absoluteFiles.map(file => normalize(path.relative(root, file)));
  const byName = new Set(relativeFiles);
  const resolveImport = (from, specifier) => {
    let candidate = specifier;
    if (candidate.startsWith("@/")) candidate = `src/${candidate.slice(2)}`;
    else if (candidate.startsWith(".")) candidate = normalize(path.join(path.dirname(from), candidate));
    else return null;
    for (const name of [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}/index.ts`, `${candidate}/index.tsx`]) {
      if (byName.has(name)) return name;
    }
    return null;
  };
  const entries = relativeFiles.filter(file => /^src\/app\/.+\/(?:page|layout|route)\.tsx?$/.test(file) && !/(?:legacy-page|legacy-layout|legacy-route)\.tsx?$/.test(file));
  for (const entry of ["src/proxy.ts", "src/instrumentation.ts", "src/instrumentation-client.ts", "src/lib/email/ses-feedback-handler.ts"]) if (byName.has(entry)) entries.push(entry);
  const visited = new Set();
  const queue = [...entries];
  const staticViolations = [];
  const dynamicViolations = [];
  const literalViolations = [];
  const reviewedDynamicEdges = new Set();
  const reviewedEndpointLiterals = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(path.join(root, file), "utf8");
    const { staticSpecifiers, dynamicSpecifiers } = importsFrom(source);
    for (const endpoint of legacyEndpointLiteralsFrom(source)) {
      const approved = approvedLegacyEndpointLiterals[file] ?? [];
      if (!approved.includes(endpoint)) literalViolations.push(`${file} -> ${endpoint}`);
      else reviewedEndpointLiterals.add(`${file} -> ${endpoint}`);
    }
    for (const specifier of staticSpecifiers) {
      if (legacyProvider(specifier)) staticViolations.push(`${file} -> ${specifier}`);
      const resolved = resolveImport(file, specifier);
      if (resolved) queue.push(resolved);
    }
    for (const specifier of dynamicSpecifiers) {
      if (legacyProvider(specifier)) {
        const approved = approvedDynamicLegacyImports[file] ?? [];
        if (!approved.includes(specifier)) dynamicViolations.push(`${file} -> ${specifier}`);
        else reviewedDynamicEdges.add(`${file} -> ${specifier}`);
      } else {
        const resolved = resolveImport(file, specifier);
        if (resolved) queue.push(resolved);
      }
    }
  }
  assert.deepEqual(staticViolations, [], `AWS-native entries statically reach legacy providers:\n${staticViolations.join("\n")}`);
  assert.deepEqual(dynamicViolations, [], `AWS-native entries contain unreviewed dynamic legacy-provider imports:\n${dynamicViolations.join("\n")}`);
  assert.deepEqual(literalViolations, [], `AWS-native entries reach unreviewed legacy-provider endpoints:\n${literalViolations.join("\n")}`);
  return { entrypoints: entries.length, reachableModules: visited.size, staticLegacyEdges: 0, reviewedDynamicBridgeEdges: reviewedDynamicEdges.size, unapprovedDynamicLegacyEdges: 0, reviewedLegacyEndpointLiterals: reviewedEndpointLiterals.size, unapprovedLegacyEndpointLiterals: 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ provider: "aws-native", ...scanAwsNativeProviderReachability() }));
}
