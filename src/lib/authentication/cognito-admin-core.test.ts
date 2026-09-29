import assert from "node:assert/strict";
import test from "node:test";
import { assertCognitoPasswordResetReady,CognitoDirectoryError,isCognitoDirectoryUsername,mapCognitoDirectoryError } from "./cognito-admin-core.ts";

test("Cognito directory accepts provider-generated non-v4 UUID usernames, not aliases",()=>{
 assert.equal(isCognitoDirectoryUsername("742824e8-60d1-7081-93a3-722b79de50c6"),true);
 assert.equal(isCognitoDirectoryUsername("c38e1b61-551b-4519-ae3e-6b0f76a1ac01"),true);
 assert.equal(isCognitoDirectoryUsername("person@example.invalid"),false);
 assert.equal(isCognitoDirectoryUsername("742824e8-60d1-7081-93a3-722b79de50c6-extra"),false);
});

test("Cognito provider failures map to stable non-sensitive lifecycle codes",()=>{
 const cases=new Map([["UsernameExistsException","conflict"],["AliasExistsException","conflict"],["UserNotFoundException","not_found"],["InvalidPasswordException","invalid_password"],["CodeMismatchException","invalid_code"],["ExpiredCodeException","expired_code"],["TooManyRequestsException","throttled"],["unexpected","unavailable"]]);
 for(const [name,code] of cases){const error=mapCognitoDirectoryError({name,message:"sensitive provider detail"});assert.ok(error instanceof CognitoDirectoryError);assert.equal(error.code,code);assert.doesNotMatch(error.message,/sensitive/);}
});

test("password reset accepts only a confirmed user with verified email",()=>{
 const base={username:"742824e8-60d1-7081-93a3-722b79de50c6",subject:"742824e8-60d1-7081-93a3-722b79de50c6",email:"user@example.invalid",enabled:true};
 assert.doesNotThrow(()=>assertCognitoPasswordResetReady({...base,status:"CONFIRMED",emailVerified:true}));
 assert.throws(()=>assertCognitoPasswordResetReady({...base,status:"FORCE_CHANGE_PASSWORD",emailVerified:false}),(error:unknown)=>error instanceof CognitoDirectoryError&&error.code==="initial_password_required");
 assert.throws(()=>assertCognitoPasswordResetReady({...base,status:"CONFIRMED",emailVerified:false}),(error:unknown)=>error instanceof CognitoDirectoryError&&error.code==="recovery_unavailable");
 assert.throws(()=>assertCognitoPasswordResetReady({...base,status:"RESET_REQUIRED",emailVerified:true}),(error:unknown)=>error instanceof CognitoDirectoryError&&error.code==="recovery_unavailable");
});
