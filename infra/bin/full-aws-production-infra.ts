import * as cdk from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fullAwsProductionAssembly } from "../lib/full-aws-production-assembly";
import { validateFullAwsProductionTarget, verifyFullAwsProductionIdentity } from "../lib/full-aws-production-target";

const app=new cdk.App(),mode=app.node.tryGetContext("productionOperation"),path=app.node.tryGetContext("productionConfig");
if(!["preview","authorized"].includes(mode)||typeof path!=="string"||!path)throw Error("Explicit full-AWS production operation and reviewed config path required");
const offline=mode==="preview",target=validateFullAwsProductionTarget(JSON.parse(readFileSync(path,"utf8").replace(/^\uFEFF/,"")),{offline});
// CDK itself sets CDK_DEFAULT_ACCOUNT/REGION before launching the app, so those
// metadata values are not credential evidence. The preview target remains the
// non-deployable placeholder account and all credential-bearing variables are
// forbidden.
if(offline){for(const key of ["AWS_PROFILE","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","AWS_SESSION_TOKEN"])if(process.env[key])throw Error("Production preview must run without AWS credentials");}
else{
 if(process.env.TRACEPOINT_PRODUCTION_AUTHORIZATION!==target.deploymentAuthorization?.reference)throw Error("Explicit matching production authorization reference required");
 let identity;try{identity=JSON.parse(execFileSync("aws.exe",["sts","get-caller-identity","--region","us-east-1","--output","json"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));}catch{throw Error("Production identity unavailable");}
 verifyFullAwsProductionIdentity(target,identity,process.env.AWS_REGION??process.env.AWS_DEFAULT_REGION??"");
}
fullAwsProductionAssembly(app,target,offline);
cdk.Aspects.of(app).add(new AwsSolutionsChecks({verbose:true}));
