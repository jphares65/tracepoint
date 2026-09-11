import { createHash } from "node:crypto";
const uuid=value=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hash=value=>createHash("sha256").update(value).digest("hex");

export function deterministicCognitoUsername(issuer, tracepointUserId) {
  if (!/^https:\/\/cognito-idp\.us-east-1\.amazonaws\.com\/us-east-1_[A-Za-z0-9]+$/.test(issuer) || !uuid(tracepointUserId)) throw new Error("Invalid bounded Cognito identity input.");
  return `tp-${tracepointUserId}-${hash(`${issuer}\0${tracepointUserId}`).slice(0, 12)}`;
}

export function planSyntheticCognitoMigration(input) {
  if (!input || input.schemaVersion!==1 || input.synthetic!==true || !uuid(input.departmentId) || !Array.isArray(input.users) || input.users.length<1 || input.users.length>100) throw new Error("Invalid bounded synthetic Cognito manifest.");
  const ids=new Set(),emails=new Set();
  const users=input.users.map(user=>{
    if(!uuid(user.tracepointUserId)||ids.has(user.tracepointUserId)||typeof user.email!=="string"||!user.email.endsWith(".test")||emails.has(user.email.toLowerCase())||!Array.isArray(user.roles)||user.roles.some(role=>typeof role!=="string"||!/^[a-z][a-z0-9_]{0,63}$/.test(role))||typeof user.membershipActive!=="boolean"||!["pending","active","inactive"].includes(user.activationState))throw new Error("Invalid or duplicate synthetic Cognito user.");
    ids.add(user.tracepointUserId);emails.add(user.email.toLowerCase());
    return{...user,email:user.email.toLowerCase(),username:deterministicCognitoUsername(input.issuer,user.tracepointUserId),delivery:"SUPPRESS",enabled:user.membershipActive&&user.activationState!=="inactive"};
  });
  return{schemaVersion:1,dryRun:true,synthetic:true,departmentId:input.departmentId,issuer:input.issuer,users,manifestHash:hash(JSON.stringify(users))};
}

export async function executeSyntheticCognitoMigration(plan,adapter,{authorized=false}={}){
  if(!authorized)throw new Error("Explicit synthetic Cognito execution authorization required.");
  const evidence=[];
  for(const user of plan.users){
    const existing=await adapter.getUser(user.username);
    if(existing&&existing.tracepointUserId!==user.tracepointUserId)throw new Error("Cognito identity conflict refused.");
    const subject=existing?.subject??await adapter.createUser({username:user.username,email:user.email,messageAction:"SUPPRESS",enabled:user.enabled});
    const authorizationRollback=await adapter.preserveAuthorization({departmentId:plan.departmentId,tracepointUserId:user.tracepointUserId,issuer:plan.issuer,subject,roles:user.roles,membershipActive:user.membershipActive,activationState:user.activationState});
    if(!user.enabled)await adapter.disableUser(user.username);
    evidence.push({username:user.username,tracepointUserId:user.tracepointUserId,subject,created:!existing,enabled:user.enabled,rolesHash:hash(JSON.stringify([...user.roles].sort())),rollback:{disableUsername:user.username,removeCreatedIdentity:!existing,deactivateIdentitySubject:subject,...authorizationRollback}});
  }
  await adapter.reconcile(plan,evidence);
  return{schemaVersion:1,departmentId:plan.departmentId,manifestHash:plan.manifestHash,reconciled:true,users:evidence};
}
