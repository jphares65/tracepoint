import "server-only";
import { randomBytes } from "node:crypto";
import {
 AdminCreateUserCommand,AdminDeleteUserCommand,AdminDisableUserCommand,AdminEnableUserCommand,AdminGetUserCommand,
 AdminResetUserPasswordCommand,AdminSetUserPasswordCommand,AdminUpdateUserAttributesCommand,AdminUserGlobalSignOutCommand,
 CognitoIdentityProviderClient,ConfirmForgotPasswordCommand,type AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";
import { parseCognitoRuntimeConfiguration, parseCognitoTargetConfiguration } from "./cognito-runtime-configuration-core";
import { CognitoDirectoryError,mapCognitoDirectoryError,type CognitoAdminDirectory,type CognitoDirectoryUser,type CreatePendingCognitoUser } from "./cognito-admin-core";

type CognitoSender={send(command:unknown):Promise<unknown>};
const usernamePattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean=(value:unknown)=>typeof value==="string"?value.trim():"";
const attributes=(values:AttributeType[]|undefined)=>new Map((values??[]).map(item=>[item.Name??"",item.Value??""]));

export class AwsCognitoAdminDirectory implements CognitoAdminDirectory{
 constructor(private readonly client:CognitoSender,private readonly userPoolId:string,private readonly clientId:string){
  if(!/^us-east-1_[A-Za-z0-9]+$/.test(userPoolId)||!/^[A-Za-z0-9]{1,128}$/.test(clientId))throw new Error("Invalid Cognito directory target.");
 }
 private username(value:string){if(!usernamePattern.test(value))throw new CognitoDirectoryError("not_found");return value;}
 private async send(command:unknown){try{return await this.client.send(command);}catch(error){throw mapCognitoDirectoryError(error);}}
 private map(value:{Username?:string;UserAttributes?:AttributeType[];Enabled?:boolean;UserStatus?:string}):CognitoDirectoryUser{
  const attrs=attributes(value.UserAttributes),username=clean(value.Username),subject=clean(attrs.get("sub")),email=clean(attrs.get("email")).toLowerCase();
  if(!usernamePattern.test(username)||!subject||!email)throw new CognitoDirectoryError("unavailable");
  return{username,subject,email,enabled:value.Enabled!==false,status:clean(value.UserStatus)};
 }
 async createPending(input:CreatePendingCognitoUser){
  const username=this.username(input.username),email=clean(input.email).toLowerCase(),fullName=clean(input.fullName);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!fullName)throw new CognitoDirectoryError("unavailable");
  const temporaryPassword=`Aa1!${randomBytes(24).toString("base64url")}`;
  const result=await this.send(new AdminCreateUserCommand({UserPoolId:this.userPoolId,Username:username,TemporaryPassword:temporaryPassword,MessageAction:"SUPPRESS",ForceAliasCreation:false,UserAttributes:[{Name:"email",Value:email},{Name:"name",Value:fullName}]})) as {User?:{Username?:string;Attributes?:AttributeType[];Enabled?:boolean;UserStatus?:string}};
  return this.map({Username:result.User?.Username,UserAttributes:result.User?.Attributes,Enabled:result.User?.Enabled,UserStatus:result.User?.UserStatus});
 }
 async get(username:string){const result=await this.send(new AdminGetUserCommand({UserPoolId:this.userPoolId,Username:this.username(username)})) as {Username?:string;UserAttributes?:AttributeType[];Enabled?:boolean;UserStatus?:string};return this.map(result);}
 async setPermanentPassword(username:string,password:string){if(password.length<14||password.length>256)throw new CognitoDirectoryError("invalid_password");await this.send(new AdminSetUserPasswordCommand({UserPoolId:this.userPoolId,Username:this.username(username),Password:password,Permanent:true}));}
 async markEmailVerified(username:string){await this.send(new AdminUpdateUserAttributesCommand({UserPoolId:this.userPoolId,Username:this.username(username),UserAttributes:[{Name:"email_verified",Value:"true"}]}));}
 async beginPasswordReset(username:string){await this.send(new AdminResetUserPasswordCommand({UserPoolId:this.userPoolId,Username:this.username(username)}));}
 async completePasswordReset(username:string,code:string,password:string){if(!code||code.length>2048||password.length<14||password.length>256)throw new CognitoDirectoryError("invalid_code");await this.send(new ConfirmForgotPasswordCommand({ClientId:this.clientId,Username:this.username(username),ConfirmationCode:code,Password:password}));}
 async disable(username:string){await this.send(new AdminDisableUserCommand({UserPoolId:this.userPoolId,Username:this.username(username)}));}
 async enable(username:string){await this.send(new AdminEnableUserCommand({UserPoolId:this.userPoolId,Username:this.username(username)}));}
 async globalSignOut(username:string){await this.send(new AdminUserGlobalSignOutCommand({UserPoolId:this.userPoolId,Username:this.username(username)}));}
 async deleteCompensation(username:string){await this.send(new AdminDeleteUserCommand({UserPoolId:this.userPoolId,Username:this.username(username)}));}
}

let directory:CognitoAdminDirectory|undefined;
export function getCognitoAdminDirectory(environment=process.env){
 if(directory)return directory;const config=parseCognitoRuntimeConfiguration(environment);
 directory=new AwsCognitoAdminDirectory(new CognitoIdentityProviderClient({region:config.verification.region,maxAttempts:1}),config.verification.userPoolId,config.verification.clientId);
 return directory;
}

export function getCognitoMigrationDirectory(environment=process.env){
 const config=parseCognitoTargetConfiguration(environment);
 return new AwsCognitoAdminDirectory(new CognitoIdentityProviderClient({region:config.verification.region,maxAttempts:1}),config.verification.userPoolId,config.verification.clientId);
}
