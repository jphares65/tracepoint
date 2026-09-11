import { execFileSync, spawnSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  DescribeUserPoolCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type IAuthenticationCallback,
} from "amazon-cognito-identity-js";

const account = "559054714699";
const region = "us-east-1";
const applicationOrigin = "https://staging.tracepointhq.com";
const value = (name: string) => {
  const index = process.argv.indexOf(name);
  assert.ok(index >= 0 && process.argv[index + 1], `Missing ${name}.`);
  return process.argv[index + 1];
};
assert.ok(process.argv.includes("--execute"), "Explicit staging acceptance authorization is required.");
const sourceCommit = value("--source-commit");
const runtimeImageDigest = value("--runtime-image-digest");
const toolingImageDigest = value("--tooling-image-digest");
const authorizationReference = value("--authorization-reference");
assert.match(sourceCommit, /^[0-9a-f]{40}$/);
assert.match(runtimeImageDigest, /^sha256:[0-9a-f]{64}$/);
assert.match(toolingImageDigest, /^sha256:[0-9a-f]{64}$/);
assert.match(authorizationReference, /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,159}$/);

function aws(args: string[]) {
  try {
    return JSON.parse(execFileSync("aws.exe", [...args, "--region", region, "--output", "json"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }));
  } catch { throw new Error("Staging AWS metadata request failed."); }
}
function gate() {
  const identity = aws(["sts", "get-caller-identity"]);
  assert.equal(identity.Account, account);
  assert.match(identity.Arn, /^arn:aws:sts::559054714699:assumed-role\/[^/]*TracePointMigrationStaging[^/]*\//);
}
function outputs(stackName: string) {
  const stack = aws(["cloudformation", "describe-stacks", "--stack-name", stackName]).Stacks[0];
  assert.ok(["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(stack.StackStatus));
  return Object.fromEntries(stack.Outputs.map((item: {OutputKey: string; OutputValue: string}) => [item.OutputKey, item.OutputValue]));
}
function otp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "";
  for (const char of secret.replace(/=+$/, "")) { const v = alphabet.indexOf(char); assert.ok(v >= 0); bits += v.toString(2).padStart(5, "0"); }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map(part => parseInt(part, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest(), offset = digest[19] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}

type FixtureUser = {kind: "manager"|"officer"|"foreign"; id: string; email: string; subject?: string; totp?: string};
const run = randomUUID();
const password = `${randomBytes(40).toString("base64url")}Aa1!`;
const users: FixtureUser[] = (["manager", "officer", "foreign"] as const).map(kind => ({
  kind, id: randomUUID(), email: `aws-native-${kind}-${run}@example.invalid`,
}));
let fixtureCreated = false;
let acceptancePassed = false;
let poolId = "";
const client = new CognitoIdentityProviderClient({region, maxAttempts: 2});
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

async function createAndEnroll(user: FixtureUser, poolId: string, clientId: string) {
  gate();
  await client.send(new AdminCreateUserCommand({
    UserPoolId: poolId, Username: user.email, TemporaryPassword: password, MessageAction: "SUPPRESS",
    UserAttributes: [{Name: "email", Value: user.email}, {Name: "email_verified", Value: "true"}],
  }));
  await client.send(new AdminSetUserPasswordCommand({UserPoolId: poolId, Username: user.email, Password: password, Permanent: true}));
  const record = await client.send(new AdminGetUserCommand({UserPoolId: poolId, Username: user.email}));
  user.subject = record.UserAttributes?.find(attribute => attribute.Name === "sub")?.Value;
  assert.match(user.subject ?? "", /^[0-9a-f-]{36}$/);
  const memory = new Map<string,string>();
  const storage = {getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,item:string)=>{memory.set(key,item);},removeItem:(key:string)=>{memory.delete(key);},clear:()=>memory.clear()};
  const pool = new CognitoUserPool({UserPoolId: poolId, ClientId: clientId, Storage: storage, AdvancedSecurityDataCollectionFlag: false});
  const cognitoUser = new CognitoUser({Username: user.email, Pool: pool, Storage: storage});
  await new Promise<void>((resolvePromise, reject) => {
    const callbacks: IAuthenticationCallback = {
      onSuccess: () => resolvePromise(), onFailure: reject,
      mfaSetup: () => cognitoUser.associateSoftwareToken({onFailure: reject, associateSecretCode: secret => {
        void (async () => {
          user.totp = secret;
          const remaining = 30000 - Date.now() % 30000; if (remaining < 5000) await new Promise(done => setTimeout(done, remaining + 500));
          cognitoUser.verifySoftwareToken(otp(secret), "TracePoint AWS-native acceptance", callbacks);
        })().catch(reject);
      }}),
    };
    cognitoUser.authenticateUser(new AuthenticationDetails({Username: user.email, Password: password}), callbacks);
  });
  if (!user.totp) {
    await new Promise<void>((resolvePromise, reject) => cognitoUser.associateSoftwareToken({onFailure: reject, associateSecretCode: secret => {
      void (async () => {
        user.totp = secret;
        const remaining = 30000 - Date.now() % 30000; if (remaining < 5000) await new Promise(done => setTimeout(done, remaining + 500));
        cognitoUser.verifySoftwareToken(otp(secret), "TracePoint AWS-native acceptance", {onSuccess:()=>resolvePromise(),onFailure:reject});
      })().catch(reject);
    }}));
  }
  await new Promise<void>((resolvePromise,reject)=>cognitoUser.setUserMfaPreference(null,{Enabled:true,PreferredMfa:true},error=>error?reject(error):resolvePromise()));
  assert.ok(user.totp);
}

function fixture(operation: "setup"|"cleanup", poolId: string) {
  const [manager, officer, foreign] = users;
  const script = resolve(repositoryRoot, "scripts", "execute-aws-native-staging-fixture.ps1");
  const args = ["-NoProfile","-ExecutionPolicy","Bypass","-File",script,"-Operation",operation,"-SourceCommit",sourceCommit,"-ToolingImageDigest",toolingImageDigest,"-RunId",run,
    "-ManagerId",manager.id,"-ManagerSubject",manager.subject!,"-ManagerEmail",manager.email,
    "-OfficerId",officer.id,"-OfficerSubject",officer.subject!,"-OfficerEmail",officer.email,
    "-ForeignUserId",foreign.id,"-ForeignSubject",foreign.subject!,"-ForeignEmail",foreign.email,
    "-CognitoIssuer",`https://cognito-idp.${region}.amazonaws.com/${poolId}`,"-AuthorizationReference",authorizationReference,"-Execute","-Confirm:$false"];
  const env = {...process.env};
  if (operation === "cleanup") env.TRACEPOINT_STAGING_FIXTURE_CLEANUP_AUTHORIZATION = authorizationReference;
  const result = spawnSync("powershell.exe", args, {cwd: repositoryRoot, env, encoding:"utf8", stdio:["ignore","pipe","pipe"]});
  if (result.status !== 0) throw new Error(`Staging fixture ${operation} failed; sensitive output suppressed.`);
}

try {
  gate();
  const budget = aws(["budgets","describe-budget","--account-id",account,"--budget-name","tracepoint-staging-monthly-125"]).Budget;
  assert.equal(Number(budget.BudgetLimit.Amount), 125); assert.equal(budget.BudgetLimit.Unit, "USD");
  const cognito = outputs("tracepoint-staging-cognito");
  poolId = cognito.UserPoolId;
  const service=aws(["ecs","describe-services","--cluster","tracepoint-staging","--services","tracepoint-staging"]).services[0];
  assert.equal(service.runningCount,service.desiredCount);assert.equal(service.pendingCount,0);
  const definition=aws(["ecs","describe-task-definition","--task-definition",service.taskDefinition]).taskDefinition;
  const container=definition.containerDefinitions.find((candidate:{name:string})=>candidate.name==="tracepoint");assert.ok(container);
  assert.equal(container.image,`${account}.dkr.ecr.${region}.amazonaws.com/tracepoint-staging@${runtimeImageDigest}`);
  const runtimeEnvironment=Object.fromEntries(container.environment.map((entry:{name:string;value:string})=>[entry.name,entry.value]));
  assert.deepEqual([runtimeEnvironment.TRACEPOINT_RUNTIME_PROVIDER_MODE,runtimeEnvironment.TRACEPOINT_DATA_PROVIDER,runtimeEnvironment.TRACEPOINT_AUTH_PROVIDER,runtimeEnvironment.TRACEPOINT_STORAGE_PROVIDER,runtimeEnvironment.TRACEPOINT_EMAIL_PROVIDER],["aws-native","postgres","cognito","s3","ses"]);
  const serializedDefinition=JSON.stringify(definition);assert.doesNotMatch(serializedDefinition,/SUPABASE|BREVO|VERCEL/i);
  const pool = (await client.send(new DescribeUserPoolCommand({UserPoolId:cognito.UserPoolId}))).UserPool!;
  const appClient = (await client.send(new DescribeUserPoolClientCommand({UserPoolId:cognito.UserPoolId,ClientId:cognito.ClientId}))).UserPoolClient!;
  assert.equal(pool.MfaConfiguration,"ON");assert.deepEqual(appClient.CallbackURLs,[`${applicationOrigin}/api/auth/cognito/callback`]);
  for (const user of users) await createAndEnroll(user,cognito.UserPoolId,cognito.ClientId);
  fixture("setup",cognito.UserPoolId); fixtureCreated=true;
  const [manager,officer,foreign]=users;
  const environment={...process.env,
    TRACEPOINT_ACCEPTANCE_EMAIL:manager.email,TRACEPOINT_ACCEPTANCE_PASSWORD:password,TRACEPOINT_ACCEPTANCE_DEPARTMENT_ID:manager.id,
    TRACEPOINT_ACCEPTANCE_MANAGER_ID:manager.id,TRACEPOINT_ACCEPTANCE_MANAGER_TOTP_SECRET:manager.totp!,
    TRACEPOINT_ACCEPTANCE_OFFICER_ID:officer.id,TRACEPOINT_ACCEPTANCE_OFFICER_EMAIL:officer.email,TRACEPOINT_ACCEPTANCE_OFFICER_PASSWORD:password,TRACEPOINT_ACCEPTANCE_OFFICER_TOTP_SECRET:officer.totp!,
    TRACEPOINT_ACCEPTANCE_FOREIGN_USER_ID:foreign.id,TRACEPOINT_ACCEPTANCE_FOREIGN_EMAIL:foreign.email,TRACEPOINT_ACCEPTANCE_FOREIGN_DEPARTMENT_ID:foreign.id,TRACEPOINT_ACCEPTANCE_FOREIGN_TOTP_SECRET:foreign.totp!,
    TRACEPOINT_ACCEPTANCE_WRITES:"disposable-staging",TRACEPOINT_ACCEPTANCE_STORAGE_PROVIDER:"s3",TRACEPOINT_ACCEPTANCE_RANGE_DOCUMENTS:"enabled",TRACEPOINT_ACCEPTANCE_EXTENDED_WORKFLOWS:"enabled",
  };
  const result=spawnSync(process.execPath,[resolve(repositoryRoot,"scripts","test-staging-acceptance.mjs")],{cwd:repositoryRoot,env:environment,stdio:"inherit"});
  assert.equal(result.status,0,"AWS-native application acceptance failed.");acceptancePassed=true;
} catch (error) {
  console.error(JSON.stringify({status:"FAILED",run,errorName:(error as Error).name,sensitiveDetailsPrinted:false}));process.exitCode=1;
} finally {
  let cleanup=true;
  if(fixtureCreated){try{fixture("cleanup",poolId);}catch{cleanup=false;process.exitCode=1;}}
  if(poolId)for(const user of users){try{gate();await client.send(new AdminDeleteUserCommand({UserPoolId:poolId,Username:user.email}));}catch(error){if((error as Error).name!=="UserNotFoundException"){cleanup=false;process.exitCode=1;}}}
  client.destroy();
  console.log(JSON.stringify({status:acceptancePassed&&cleanup?"PASSED":"FAILED",run,users:3,departments:2,syntheticOnly:true,awsNativeRuntime:true,fixtureCleanupVerified:cleanup,credentialsPrinted:false}));
}
