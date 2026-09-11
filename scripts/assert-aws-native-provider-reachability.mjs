import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const auditedDirectUsages = Object.freeze([
  "src/app/api/platform/agencies/route.ts", "src/app/api/platform/agency-user-administrator/route.ts", "src/app/api/platform/support-mode/route.ts",
  "src/app/api/settings/onboarding/certifications/route.ts", "src/app/api/settings/onboarding/equipment/route.ts", "src/app/api/settings/onboarding/firearms/route.ts",
  "src/app/api/settings/onboarding/off-duty-firearms/route.ts", "src/app/api/settings/onboarding/personnel-directory/route.ts", "src/app/api/settings/onboarding/qualification-history/route.ts",
  "src/app/platform/[departmentId]/page.tsx", "src/app/platform/layout.tsx", "src/app/platform/page.tsx", "src/app/settings/page.tsx",
  "src/app/settings/command-dashboard-analytics/AnalyticsDashboardSettingsPanel.tsx", "src/app/settings/components/RangeQualificationRulesPanel.tsx", "src/app/components/VisualCustomization.tsx",
  "src/app/api/auth/session/refresh/route.ts", "src/app/auth/signout/route.ts", "src/app/login/LoginForm.tsx",
]);

const files = directory => readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{const name=path.join(directory,entry.name);return entry.isDirectory()?files(name):/\.(?:ts|tsx)$/.test(entry.name)?[name]:[]});
const normalize = value => value.replaceAll("\\","/");
const sourceFiles=files("src"), byName=new Set(sourceFiles.map(normalize));
const resolveImport=(from,specifier)=>{
  if(specifier.startsWith("@/"))specifier=`src/${specifier.slice(2)}`;
  else if(specifier.startsWith("."))specifier=normalize(path.join(path.dirname(from),specifier));
  else return null;
  for(const candidate of [specifier,`${specifier}.ts`,`${specifier}.tsx`,`${specifier}/index.ts`,`${specifier}/index.tsx`])if(byName.has(candidate))return candidate;
  return null;
};
const staticImports=source=>[...source.matchAll(/(?:^|\n)\s*(?!import\s+type\b)(?:import|export)\s+(?:[^"'\n]*?\s+from\s+)?["']([^"']+)["']/g)].map(match=>match[1]);
const entries=sourceFiles.map(normalize).filter(file=>/^src\/app\/.+\/(?:page|layout|route)\.tsx?$/.test(file)&&!/(?:legacy-page|legacy-layout|legacy-route)\.tsx?$/.test(file));
const visited=new Set(),queue=[...entries,"src/proxy.ts"],violations=[];
while(queue.length){const file=queue.pop();if(!file||visited.has(file))continue;visited.add(file);const source=readFileSync(file,"utf8");for(const specifier of staticImports(source)){if(specifier.startsWith("@supabase/")||specifier.startsWith("@/lib/supabase/"))violations.push(`${file} -> ${specifier}`);const resolved=resolveImport(file,specifier);if(resolved)queue.push(resolved);}}
assert.equal(auditedDirectUsages.length,19,"The reviewed direct-usage audit must remain exactly 19 entries.");
for(const file of auditedDirectUsages)assert.ok(existsSync(file),`Audited source is missing: ${file}`);
assert.deepEqual(violations,[],`AWS-native entries statically reach Supabase clients:\n${violations.join("\n")}`);
console.log(JSON.stringify({provider:"aws-native",auditedDirectUsages:19,entrypoints:entries.length,reachableModules:visited.size,unapprovedSupabaseDependencies:0}));
