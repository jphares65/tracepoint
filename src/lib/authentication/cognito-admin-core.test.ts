import assert from "node:assert/strict";
import test from "node:test";
import { CognitoDirectoryError,mapCognitoDirectoryError } from "./cognito-admin-core.ts";

test("Cognito provider failures map to stable non-sensitive lifecycle codes",()=>{
 const cases=new Map([["UsernameExistsException","conflict"],["AliasExistsException","conflict"],["UserNotFoundException","not_found"],["InvalidPasswordException","invalid_password"],["CodeMismatchException","invalid_code"],["ExpiredCodeException","expired_code"],["TooManyRequestsException","throttled"],["unexpected","unavailable"]]);
 for(const [name,code] of cases){const error=mapCognitoDirectoryError({name,message:"sensitive provider detail"});assert.ok(error instanceof CognitoDirectoryError);assert.equal(error.code,code);assert.doesNotMatch(error.message,/sensitive/);}
});
