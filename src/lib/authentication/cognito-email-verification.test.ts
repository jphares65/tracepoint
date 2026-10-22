import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { pendingUserCreateInput } from "./cognito-pending-user-core.ts";

// ADM-07: an invited user's email is never marked verified without proof of
// mailbox control, in particular never because the user signed in or because an
// administrator assigned a password. cognito-admin.ts is server-only, so the
// directory runs in a child process under the react-server condition against a
// mocked Cognito client that applies Cognito's documented state rules.
const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
// file:// URLs, not paths: import() of a Windows absolute path (C:\...) is refused.
const directoryModule = new URL("./cognito-admin.ts", import.meta.url).href;
const coreModule = new URL("./cognito-admin-core.ts", import.meta.url).href;

const child = String.raw`(async()=>{
const {AwsCognitoAdminDirectory}=(await import(process.env.DIRECTORY_MODULE)).default??await import(process.env.DIRECTORY_MODULE);
const core=await import(process.env.CORE_MODULE);const {assertCognitoPasswordResetReady}=core.default??core;
const subjects={"invited@example.invalid":"11111111-1111-4111-8111-111111111111","signedin@example.invalid":"22222222-2222-4222-8222-222222222222","normal@example.invalid":"33333333-3333-4333-8333-333333333333","assigned@example.invalid":"44444444-4444-4444-8444-444444444444"};
const users=new Map(),sent=[];
const fault=name=>Object.assign(new Error(name),{name});
const find=key=>[...users.values()].find(user=>user.username===key||user.attributes.email===key);
const view=user=>({Username:user.username,UserAttributes:Object.entries(user.attributes).map(([Name,Value])=>({Name,Value})),Attributes:Object.entries(user.attributes).map(([Name,Value])=>({Name,Value})),Enabled:true,UserStatus:user.status});
// Mocked Cognito: AdminCreateUser keeps the supplied attributes (no implicit
// email_verified); RESEND only in FORCE_CHANGE_PASSWORD; a reset needs a
// confirmed user with a verified email (NotAuthorized / InvalidParameter otherwise).
const client={async send(command){
 const name=command.constructor.name,input=command.input;sent.push({name,input});
 if(name==="AdminGetUserCommand"){const user=find(input.Username);if(!user)throw fault("UserNotFoundException");return view(user);}
 if(name==="AdminCreateUserCommand"){
  if(input.MessageAction==="RESEND"){const user=find(input.Username);if(!user)throw fault("UserNotFoundException");if(user.status!=="FORCE_CHANGE_PASSWORD")throw fault("UnsupportedUserStateException");return{User:view(user)};}
  const email=input.UserAttributes.find(item=>item.Name==="email").Value,subject=subjects[email];
  const user={username:subject,status:"FORCE_CHANGE_PASSWORD",attributes:{sub:subject,...Object.fromEntries(input.UserAttributes.map(item=>[item.Name,item.Value]))}};
  users.set(subject,user);return{User:view(user)};
 }
 const user=find(input.Username);if(!user)throw fault("UserNotFoundException");
 if(name==="AdminSetUserPasswordCommand"){if(input.Permanent)user.status="CONFIRMED";return{};}
 if(name==="AdminUpdateUserAttributesCommand"){for(const item of input.UserAttributes)user.attributes[item.Name]=item.Value;return{};}
 if(name==="AdminResetUserPasswordCommand"){if(user.status==="FORCE_CHANGE_PASSWORD")throw fault("NotAuthorizedException");if(user.attributes.email_verified!=="true")throw fault("InvalidParameterException");user.status="RESET_REQUIRED";user.codeSent=true;return{};}
 return{};
}};
const directory=new AwsCognitoAdminDirectory(client,"us-east-1_TESTPOOL","testclient1");
const readiness=user=>{try{assertCognitoPasswordResetReady(user);return"ready";}catch(error){return error.code;}};
const attempt=async run=>{try{await run();return"ok";}catch(error){return error.code??error.name;}};
const result={};
// Invite (Settings invite, personnel import and AI importer all use createPending + resendInvitation).
for(const email of Object.keys(subjects)){const created=await directory.createPending({username:"99999999-9999-4999-8999-999999999999",email,fullName:"Synthetic User"});await directory.resendInvitation(email,created.subject);}
result.invite=sent.filter(item=>item.name==="AdminCreateUserCommand").slice(0,2).map(item=>({messageAction:item.input.MessageAction,mediums:item.input.DesiredDeliveryMediums??null,attributes:(item.input.UserAttributes??[]).map(attribute=>attribute.Name)}));
// Cognito's own NEW_PASSWORD_REQUIRED completion: status changes, attributes do not.
users.get(subjects["signedin@example.invalid"]).status="CONFIRMED";
const normal=users.get(subjects["normal@example.invalid"]);normal.status="CONFIRMED";normal.attributes.email_verified="true";
// Administrator Assign Password, as assignCognitoPassword drives the directory.
const assigned=subjects["assigned@example.invalid"];
const before=sent.length;
await directory.get(assigned);await directory.setPermanentPassword(assigned,"Synthetic-Passw0rd!Long");await directory.globalSignOut(assigned);
result.assignCommands=sent.slice(before).map(item=>item.name);
// Every directory operation on every state: none may write email_verified.
for(const method of Object.getOwnPropertyNames(AwsCognitoAdminDirectory.prototype).filter(name=>name!=="constructor"&&!["username","email","send","map"].includes(name))){
 for(const subject of Object.values(subjects)){const user=users.get(subject),saved=JSON.stringify(user);
  const args={createPending:[{username:subject,email:"other-"+subject+"@example.invalid",fullName:"Other"}],resendInvitation:[user.attributes.email,subject],setPermanentPassword:[subject,"Synthetic-Passw0rd!Long"],completePasswordReset:[subject,"123456","Synthetic-Passw0rd!Long"]}[method]??[subject];
  subjects["other-"+subject+"@example.invalid"]=subject.replace(/^./,"5");
  await attempt(()=>directory[method](...args));users.set(subject,JSON.parse(saved));
 }
}
result.methods=Object.getOwnPropertyNames(AwsCognitoAdminDirectory.prototype);
result.emailVerifiedWrites=sent.filter(item=>JSON.stringify(item.input).includes("email_verified")).map(item=>item.name);
result.states={};
for(const [label,email] of [["invitedNeverSignedIn","invited@example.invalid"],["invitedSignedIn","signedin@example.invalid"],["assignedPassword","assigned@example.invalid"],["normal","normal@example.invalid"]]){
 const user=await directory.get(email);const resend=await attempt(()=>directory.resendInvitation(email,user.subject));
 const ready=readiness(user);const reset=ready==="ready"?await attempt(()=>directory.beginPasswordReset(user.username)):"not attempted";
 result.states[label]={status:user.status,emailVerified:user.emailVerified,adminResetReadiness:ready,adminReset:reset,sendActivation:resend};
}
process.stdout.write(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exit(1);});`;

function runDirectory() {
  const env: NodeJS.ProcessEnv = { ...process.env, DIRECTORY_MODULE: directoryModule, CORE_MODULE: coreModule, AWS_CONFIG_FILE: "/dev/null", AWS_SHARED_CREDENTIALS_FILE: "/dev/null" };
  for (const key of Object.keys(env)) if (/^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|PROFILE)$/.test(key)) delete env[key];
  const run = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "-e", child], { env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout) as {
    invite: Array<{ messageAction: string; mediums: string[] | null; attributes: string[] }>;
    assignCommands: string[];
    methods: string[];
    emailVerifiedWrites: string[];
    states: Record<string, { status: string; emailVerified: boolean; adminResetReadiness: string; adminReset: string; sendActivation: string }>;
  };
}

test("ADM-07: invitations do not set email_verified; Cognito delivers the temporary password by email", () => {
  const input = pendingUserCreateInput("99999999-9999-4999-8999-999999999999", "Invited@Example.invalid", "Synthetic User", "Aa1!temporary");
  assert.deepEqual(input.UserAttributes.map((item) => item.Name), ["email", "name"]);
  const result = runDirectory();
  assert.deepEqual(result.invite, [
    { messageAction: "SUPPRESS", mediums: null, attributes: ["email", "name"] },
    { messageAction: "RESEND", mediums: ["EMAIL"], attributes: [] },
  ]);
});

test("ADM-07: no directory operation, including Assign Password, marks an email verified", () => {
  const result = runDirectory();
  assert.deepEqual(result.emailVerifiedWrites, []);
  assert.ok(!result.methods.includes("markEmailVerified"));
  assert.deepEqual(result.assignCommands, ["AdminGetUserCommand", "AdminSetUserPasswordCommand", "AdminUserGlobalSignOutCommand"]);
});

test("ADM-07: each account state gets the documented recovery path", () => {
  const { states } = runDirectory();
  // Never signed in: Forgot password is refused by Cognito; Send Activation re-sends the invitation.
  assert.deepEqual(states.invitedNeverSignedIn, { status: "FORCE_CHANGE_PASSWORD", emailVerified: false, adminResetReadiness: "initial_password_required", adminReset: "not attempted", sendActivation: "ok" });
  // Signed in through the invitation: the email stays unverified until the user verifies it with a code.
  assert.deepEqual(states.invitedSignedIn, { status: "CONFIRMED", emailVerified: false, adminResetReadiness: "recovery_unavailable", adminReset: "not attempted", sendActivation: "unavailable" });
  // Assign Password confirms the account but proves nothing about the mailbox.
  assert.deepEqual(states.assignedPassword, { status: "CONFIRMED", emailVerified: false, adminResetReadiness: "recovery_unavailable", adminReset: "not attempted", sendActivation: "unavailable" });
  assert.deepEqual(states.normal, { status: "CONFIRMED", emailVerified: true, adminResetReadiness: "ready", adminReset: "ok", sendActivation: "unavailable" });
});

test("ADM-07: sign-in and first-login activation never touch Cognito user attributes", () => {
  const signInPaths = ["./postgres-sessions.ts", "./postgres-mapping.ts", "./cognito-runtime-transport.ts", "./cognito-transport.ts", "./cognito-initial-session.ts", "./cognito-establish.ts", "./cognito-pkce.ts", "./cognito-mobile-session.ts", "./cognito-mobile-session-core.ts", "../../app/api/auth/cognito/callback/route.ts", "../../app/api/mobile/session/route.ts"];
  for (const path of signInPaths) {
    assert.doesNotMatch(source(path), /email_verified|UpdateUserAttributes|VerifyUserAttribute|markEmailVerified|getCognitoAdminDirectory/, path);
  }
  const lifecycle = source("./cognito-password-lifecycle.ts");
  assert.doesNotMatch(lifecycle, /markEmailVerified|email_verified/);
  assert.match(lifecycle, /await directory\.setPermanentPassword\(prepared\.providerUsername, input\.password\);\s*(\/\/[^\n]*\s*)*await directory\.globalSignOut\(prepared\.providerUsername\);/);
  assert.doesNotMatch(source("./cognito-admin.ts"), /AdminUpdateUserAttributes|email_verified"?\s*,\s*Value\s*:\s*"true"/);
});

test("ADM-07: refusals name the remedy for each state", () => {
  const route = source("../../app/api/settings/users/password-reset/route.ts");
  assert.match(route, /initial password change\. Use Send Activation or Assign Password; no reset email was sent\./);
  assert.match(route, /email address has not been verified[^"]*Use Assign Password[^"]*No reset email was sent\./);
});
