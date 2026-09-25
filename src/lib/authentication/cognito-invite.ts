import "server-only";
import { randomUUID } from "node:crypto";
import { getPostgresPool } from "@/lib/database/postgres-pool";
import { withPostgresAuthorization } from "@/lib/database/postgres-authorization-core";
import { getCognitoAdminDirectory } from "./cognito-admin";
import { parseCognitoRuntimeConfiguration } from "./cognito-runtime-configuration-core";
import { assertIdentityMutationAllowed } from "@/lib/email/notification-mode";

export type CognitoInviteInput={actorUserId:string;departmentId:string;email:string;fullName:string;badgeNumber:string;rankTitle:string;unitName:string;employeeNumber:string;roleCodes:string[];groupIds:string[];siteUrl:string;active?:boolean};

export async function inviteCognitoUser(input:CognitoInviteInput){
 assertIdentityMutationAllowed();
 const pool=getPostgresPool(),userId=randomUUID(),operationId=randomUUID(),providerUsername=randomUUID();
 await withPostgresAuthorization(pool,{subjectId:input.actorUserId,departmentId:input.departmentId},async client=>{
  await client.query("select tracepoint_auth.prepare_cognito_invite($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text[],$12::uuid[],$13)",[userId,operationId,providerUsername,input.departmentId,input.email,input.fullName,input.badgeNumber,input.rankTitle,input.unitName,input.employeeNumber,input.roleCodes,input.groupIds,input.active!==false]);
 });
 const directory=getCognitoAdminDirectory();
 let created;
 try{created=await directory.createPending({username:providerUsername,email:input.email,fullName:input.fullName});}
 catch(error){await pool.query("update public.authentication_lifecycle_operations set state='compensation_required',attempts=attempts+1,safe_error_code='provider_create_failed',updated_at=now() where id=$1 and state='prepared'",[operationId]).catch(()=>undefined);throw error;}
 const config=parseCognitoRuntimeConfiguration(process.env),issuer=`https://cognito-idp.${config.verification.region}.amazonaws.com/${config.verification.userPoolId}`;
 if(created.username!==created.subject||created.email!==input.email.trim().toLowerCase()||!created.enabled||created.status!=="FORCE_CHANGE_PASSWORD"){
  await pool.query("select tracepoint_auth.finish_cognito_invite($1,false,$2)",[operationId,"provider_identity_mismatch"]).catch(()=>undefined);
  throw new Error("Cognito identity reconciliation failed.");
 }
 const client=await pool.connect();
 try{
  await client.query("begin");
  await client.query("select tracepoint_auth.confirm_cognito_provider_username($1,$2,$3,$4)",[operationId,providerUsername,created.username,created.subject]);
  await client.query("select tracepoint_auth.commit_cognito_invite($1,$2,$3)",[operationId,created.subject,issuer]);
  await client.query("commit");
 }catch(error){
  await client.query("rollback").catch(()=>undefined);
  // A database response can be ambiguous. Preserve the provider identity for
  // reconciliation instead of risking deletion after a successful commit.
  await pool.query("select tracepoint_auth.finish_cognito_invite($1,false,$2)",
    [operationId,"identity_commit_unconfirmed"]).catch(()=>undefined);
  throw error;
 }
 finally{client.release();}
 try{
  if(input.active===false){
   await directory.disable(created.username);
   await pool.query("select tracepoint_auth.finish_cognito_invite($1,true,null)",[operationId]);
   return{userId,operationId,invitationSent:false,activation:null};
  }
  await directory.resendInvitation(input.email,created.subject);
  await pool.query("select tracepoint_auth.finish_cognito_invite($1,true,null)",[operationId]);
  return{userId,operationId,invitationSent:true,activation:null};
 }catch(error){await pool.query("select tracepoint_auth.finish_cognito_invite($1,false,$2)",[operationId,"email_unconfirmed"]).catch(()=>undefined);throw error;}
}
