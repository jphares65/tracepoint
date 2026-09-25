export type CognitoDirectoryUser={username:string;subject:string;email:string;emailVerified?:boolean;enabled:boolean;status:string};
export type CreatePendingCognitoUser={username:string;email:string;fullName:string};
// Email-username Cognito pools return provider-generated UUID Usernames that are
// not necessarily version 4. Keep the format boundary without assuming a UUID version.
export function isCognitoDirectoryUsername(value:string){
 return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export class CognitoDirectoryError extends Error{
 constructor(readonly code:"conflict"|"not_found"|"invalid_password"|"invalid_code"|"expired_code"|"throttled"|"unavailable"){super("The AWS identity operation could not be completed.");this.name="CognitoDirectoryError";}
}
export interface CognitoAdminDirectory{
 createPending(input:CreatePendingCognitoUser):Promise<CognitoDirectoryUser>;
 get(username:string):Promise<CognitoDirectoryUser>;
 resendInvitation(email:string,expectedSubject:string):Promise<void>;
 setPermanentPassword(username:string,password:string):Promise<void>;
 markEmailVerified(username:string):Promise<void>;
 beginPasswordReset(username:string):Promise<void>;
 completePasswordReset(username:string,code:string,password:string):Promise<void>;
 disable(username:string):Promise<void>;
 enable(username:string):Promise<void>;
 globalSignOut(username:string):Promise<void>;
 deleteCompensation(username:string):Promise<void>;
}

export function mapCognitoDirectoryError(error:unknown){
 const name=typeof error==="object"&&error&&"name" in error?String((error as {name:unknown}).name):"";
 if(name==="UsernameExistsException"||name==="AliasExistsException")return new CognitoDirectoryError("conflict");
 if(name==="UserNotFoundException")return new CognitoDirectoryError("not_found");
 if(name==="InvalidPasswordException")return new CognitoDirectoryError("invalid_password");
 if(name==="CodeMismatchException")return new CognitoDirectoryError("invalid_code");
 if(name==="ExpiredCodeException")return new CognitoDirectoryError("expired_code");
 if(name==="TooManyRequestsException"||name==="LimitExceededException"||name==="ThrottlingException")return new CognitoDirectoryError("throttled");
 return new CognitoDirectoryError("unavailable");
}
