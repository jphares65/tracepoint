import "server-only";
import { randomUUID } from "node:crypto";
import { getPostgresPool } from "@/lib/database/postgres-pool";
import { withPostgresAuthorization } from "@/lib/database/postgres-authorization-core";
import { issueActivationEmail } from "@/lib/tracepoint/activation";
import { getCognitoAdminDirectory } from "./cognito-admin";
import { parseCognitoRuntimeConfiguration } from "./cognito-runtime-configuration-core";

export type CognitoInviteInput={actorUserId:string;departmentId:string;email:string;fullName:string;badgeNumber:string;rankTitle:string;unitName:string;employeeNumber:string;roleCodes:string[];groupIds:string[];siteUrl:string};

export async function inviteCognitoUser(input:CognitoInviteInput){
 const pool=getPostgresPool(),userId=randomUUID(),operationId=randomUUID(),providerUsername=randomUUID();
 await withPostgresAuthorization(pool,{subjectId:input.actorUserId,departmentId:input.departmentId},async client=>{
  await client.query("select tracepoint_auth.prepare_cognito_invite($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text[],$12::uuid[])",[userId,operationId,providerUsername,input.departmentId,input.email,input.fullName,input.badgeNumber,input.rankTitle,input.unitName,input.employeeNumber,input.roleCodes,input.groupIds]);
 });
 const directory=getCognitoAdminDirectory();
 let created;
 try{created=await directory.createPending({username:providerUsername,email:input.email,fullName:input.fullName});}
 catch(error){await pool.query("update public.authentication_lifecycle_operations set state='compensation_required',attempts=attempts+1,safe_error_code='provider_create_failed',updated_at=now() where id=$1 and state='prepared'",[operationId]).catch(()=>undefined);throw error;}
 const config=parseCognitoRuntimeConfiguration(process.env),issuer=`https://cognito-idp.${config.verification.region}.amazonaws.com/${config.verification.userPoolId}`;
 try{await pool.query("select tracepoint_auth.commit_cognito_invite($1,$2,$3)",[operationId,created.subject,issuer]);}
 catch(error){await directory.deleteCompensation(providerUsername).catch(()=>undefined);throw error;}
 try{
  const activation=await issueActivationEmail({...input,userId,actorUserId:input.actorUserId});
  await pool.query("select tracepoint_auth.finish_cognito_invite($1,true,null)",[operationId]);
  return{userId,operationId,invitationSent:true,activation};
 }catch(error){await pool.query("select tracepoint_auth.finish_cognito_invite($1,false,$2)",[operationId,"email_unconfirmed"]).catch(()=>undefined);throw error;}
}
