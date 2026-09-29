import "server-only";
import { randomBytes } from "node:crypto";
import {
 AdminCreateUserCommand,AdminDeleteUserCommand,AdminDisableUserCommand,AdminEnableUserCommand,AdminGetUserCommand,
 AdminResetUserPasswordCommand,AdminSetUserPasswordCommand,AdminUpdateUserAttributesCommand,AdminUserGlobalSignOutCommand,
 CognitoIdentityProviderClient,ConfirmForgotPasswordCommand,type AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";
import { parseCognitoRuntimeConfiguration, parseCognitoTargetConfiguration } from "./cognito-runtime-configuration-core";
import { CognitoDirectoryError,isCognitoDirectoryUsername,mapCognitoDirectoryError,type CognitoAdminDirectory,type CognitoDirectoryUser,type CreatePendingCognitoUser } from "./cognito-admin-core";
import { cognitoSdkClientConfiguration, isCognitoPoolForRegion } from "./cognito-endpoints";
import { notificationMode } from "@/lib/email/notification-mode";
import { isApprovedRehearsalInvite } from "./cognito-rehearsal-invite-guard";
import { pendingUserCreateInput } from "./cognito-pending-user-core";
import { isCognitoCompliantPassword } from "./password-policy";

type CognitoSender={send(command:unknown):Promise<unknown>};
const clean=(value:unknown)=>typeof value==="string"?value.trim():"";
const attributes=(values:AttributeType[]|undefined)=>new Map((values??[]).map(item=>[item.Name??"",item.Value??""]));

export class AwsCognitoAdminDirectory implements CognitoAdminDirectory{
 constructor(private readonly client:CognitoSender,private readonly userPoolId:string,private readonly clientId:string){
  const region=userPoolId.slice(0,userPoolId.indexOf("_"));
  if(!isCognitoPoolForRegion(userPoolId,region)||!/^[A-Za-z0-9]{1,128}$/.test(clientId))throw new Error("Invalid Cognito directory target.");
 }
 private username(value:string){if(!isCognitoDirectoryUsername(value))throw new CognitoDirectoryError("not_found");return value;}
 private email(value:string){const cleaned=clean(value).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned))throw new CognitoDirectoryError("not_found");return cleaned;}
 private async send(command:unknown){try{return await this.client.send(command);}catch(error){throw mapCognitoDirectoryError(error);}}
 private map(value:{Username?:string;UserAttributes?:AttributeType[];Enabled?:boolean;UserStatus?:string}):CognitoDirectoryUser{
  const attrs=attributes(value.UserAttributes),username=clean(value.Username),subject=clean(attrs.get("sub")),email=clean(attrs.get("email")).toLowerCase();
  if(!isCognitoDirectoryUsername(username)||!subject||!email)throw new CognitoDirectoryError("unavailable");
  return{username,subject,email,emailVerified:attrs.get("email_verified")==="true",enabled:value.Enabled!==false,status:clean(value.UserStatus)};
 }
 async createPending(input:CreatePendingCognitoUser){
  const temporaryPassword=`Aa1!${randomBytes(24).toString("base64url")}`;
  const createInput=pendingUserCreateInput(input.username,input.email,input.fullName,temporaryPassword);
  const result=await this.send(new AdminCreateUserCommand({UserPoolId:this.userPoolId,...createInput})) as {User?:{Username?:string;Attributes?:AttributeType[];Enabled?:boolean;UserStatus?:string}};
  return this.map({Username:result.User?.Username,UserAttributes:result.User?.Attributes,Enabled:result.User?.Enabled,UserStatus:result.User?.UserStatus});
 }
 async get(username:string){const lookup=isCognitoDirectoryUsername(username)?username:this.email(username);const result=await this.send(new AdminGetUserCommand({UserPoolId:this.userPoolId,Username:lookup})) as {Username?:string;UserAttributes?:AttributeType[];Enabled?:boolean;UserStatus?:string};return this.map(result);}
 async resendInvitation(email:string,expectedSubject:string){
  const alias=this.email(email),expected=this.username(expectedSubject);
  const before=await this.get(alias);
  if(before.subject!==expected||before.username!==expected||before.email!==alias||!before.enabled||before.status!=="FORCE_CHANGE_PASSWORD")throw new CognitoDirectoryError("unavailable");
  const result=await this.send(new AdminCreateUserCommand({UserPoolId:this.userPoolId,Username:alias,MessageAction:"RESEND",DesiredDeliveryMediums:["EMAIL"],ForceAliasCreation:false})) as {User?:{Username?:string;Attributes?:AttributeType[];Enabled?:boolean;UserStatus?:string}};
  const after=this.map({Username:result.User?.Username,UserAttributes:result.User?.Attributes,Enabled:result.User?.Enabled,UserStatus:result.User?.UserStatus});
  if(after.subject!==expected||after.username!==expected||after.email!==alias||!after.enabled||after.status!=="FORCE_CHANGE_PASSWORD")throw new CognitoDirectoryError("unavailable");
 }
 async setPermanentPassword(username:string,password:string){if(!isCognitoCompliantPassword(password))throw new CognitoDirectoryError("invalid_password");await this.send(new AdminSetUserPasswordCommand({UserPoolId:this.userPoolId,Username:this.username(username),Password:password,Permanent:true}));}
 async markEmailVerified(username:string){await this.send(new AdminUpdateUserAttributesCommand({UserPoolId:this.userPoolId,Username:this.username(username),UserAttributes:[{Name:"email_verified",Value:"true"}]}));}
 async beginPasswordReset(username:string){await this.send(new AdminResetUserPasswordCommand({UserPoolId:this.userPoolId,Username:this.username(username)}));}
 async completePasswordReset(username:string,code:string,password:string){if(!code||code.length>2048||!isCognitoCompliantPassword(password))throw new CognitoDirectoryError("invalid_code");await this.send(new ConfirmForgotPasswordCommand({ClientId:this.clientId,Username:this.username(username),ConfirmationCode:code,Password:password}));}
 async disable(username:string){await this.send(new AdminDisableUserCommand({UserPoolId:this.userPoolId,Username:this.username(username)}));}
 async enable(username:string){await this.send(new AdminEnableUserCommand({UserPoolId:this.userPoolId,Username:this.username(username)}));}
 async globalSignOut(username:string){await this.send(new AdminUserGlobalSignOutCommand({UserPoolId:this.userPoolId,Username:this.username(username)}));}
 async deleteCompensation(username:string){await this.send(new AdminDeleteUserCommand({UserPoolId:this.userPoolId,Username:this.username(username)}));}
}

let directory:CognitoAdminDirectory|undefined;
export function getCognitoAdminDirectory(environment=process.env,rehearsalInvite?:Parameters<typeof isApprovedRehearsalInvite>[1]){
 if(notificationMode(environment)==="shadow"&&!isApprovedRehearsalInvite(environment,rehearsalInvite))throw new Error("Shadow identity mutation is disabled.");
 if(directory)return directory;const config=parseCognitoRuntimeConfiguration(environment);
 directory=new AwsCognitoAdminDirectory(new CognitoIdentityProviderClient(cognitoSdkClientConfiguration(config.verification.region)),config.verification.userPoolId,config.verification.clientId);
 return directory;
}

export function getCognitoMigrationDirectory(environment=process.env){
 if(notificationMode(environment)==="shadow")throw new Error("Shadow identity mutation is disabled.");
 const config=parseCognitoTargetConfiguration(environment);
 return new AwsCognitoAdminDirectory(new CognitoIdentityProviderClient(cognitoSdkClientConfiguration(config.verification.region)),config.verification.userPoolId,config.verification.clientId);
}
