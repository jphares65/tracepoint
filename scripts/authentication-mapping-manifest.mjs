import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { canonical, sha256 } from './migration-manifest.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function unique(values){if(new Set(values).size!==values.length)throw Error('Duplicate mapping input');return values.sort();}
export function authenticationMappingManifest(input){
 if(!Array.isArray(input.profiles)||!Array.isArray(input.memberships)||!Array.isArray(input.links))throw Error('Invalid mapping document');
 const profiles=unique(input.profiles.map(id=>{if(!uuid.test(id))throw Error('Invalid stable identifier');return id.toLowerCase()}));
 const memberships=unique(input.memberships.map(row=>{
  if(!profiles.includes(row.userId?.toLowerCase())||!uuid.test(row.departmentId)||typeof row.roleCode!=='string'||!/^[a-z_]+$/.test(row.roleCode))throw Error('Invalid membership reference');
  return canonical({userId:row.userId.toLowerCase(),departmentId:row.departmentId.toLowerCase(),roleCode:row.roleCode});
 }));
 const subjectKeys=[],userKeys=[];
 const links=input.links.map(row=>{
  if(!['supabase','cognito'].includes(row.provider)||!profiles.includes(row.userId?.toLowerCase())||!['pending','active','revoked'].includes(row.state)||typeof row.issuer!=='string'||!/^https:\/\/[a-zA-Z0-9./_-]+$/.test(row.issuer)||!uuid.test(row.subject))throw Error('Invalid provider mapping');
  subjectKeys.push(canonical([row.provider,row.issuer,row.subject.toLowerCase()]));userKeys.push(canonical([row.provider,row.issuer,row.userId.toLowerCase()]));
  return canonical({provider:row.provider,issuer:row.issuer,subject:row.subject.toLowerCase(),userId:row.userId.toLowerCase(),state:row.state});
 }).sort();unique(subjectKeys);unique(userKeys);
 return {format:1,profiles:profiles.length,memberships:memberships.length,links:links.length,
  stableUsersSha256:sha256(canonical(profiles)),membershipsSha256:sha256(canonical(memberships)),linksSha256:sha256(canonical(links))};
}
export function reconcileAuthenticationMappings(before,after){
 const a=authenticationMappingManifest(before),b=authenticationMappingManifest(after);
 if(a.stableUsersSha256!==b.stableUsersSha256||a.membershipsSha256!==b.membershipsSha256)throw Error('Stable user or department permission drift');
 for(const link of before.links){const same=after.links.find(x=>x.provider===link.provider&&x.issuer===link.issuer&&x.subject.toLowerCase()===link.subject.toLowerCase());
  if(!same||same.userId.toLowerCase()!==link.userId.toLowerCase()||same.state!==link.state)throw Error('Existing identity mapping changed');}
 return {stableUsersPreserved:true,departmentPermissionsPreserved:true,existingMappingsPreserved:true,addedMappings:b.links-a.links,before:a,after:b};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const [before,after]=process.argv.slice(2);if(!before||!after)throw Error('Two local mapping documents required');
  console.log(JSON.stringify(reconcileAuthenticationMappings(JSON.parse(readFileSync(before,'utf8').replace(/^\uFEFF/,'')),JSON.parse(readFileSync(after,'utf8').replace(/^\uFEFF/,''))),null,2));
 }catch{console.error('Authentication mapping reconciliation failed; identity values suppressed.');process.exitCode=1;}
}
