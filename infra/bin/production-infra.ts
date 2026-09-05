import * as cdk from 'aws-cdk-lib';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {productionAssembly} from '../lib/production-assembly';import {validateProductionTarget,verifyProductionIdentity} from '../lib/production-target';
const app=new cdk.App(),mode=app.node.tryGetContext('productionOperation'),path=app.node.tryGetContext('productionConfig');
if(!['preview','authorized'].includes(mode)||typeof path!=='string'||!path)throw Error('Explicit production operation and reviewed config path required');
const offline=mode==='preview',target=validateProductionTarget(JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,'')),{offline});
if(offline){for(const key of ['AWS_PROFILE','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','CDK_DEFAULT_ACCOUNT'])if(process.env[key])throw Error('Production preview must run without AWS credentials');}
else{
 if(process.env.TRACEPOINT_PRODUCTION_AUTHORIZATION!==target.deploymentAuthorization?.reference)throw Error('Explicit matching production authorization reference required');
 let identity;try{identity=JSON.parse(execFileSync('aws.exe',['sts','get-caller-identity','--region','us-east-1','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}catch{throw Error('Production identity unavailable');}
 verifyProductionIdentity(target,identity,process.env.AWS_REGION??process.env.AWS_DEFAULT_REGION??'');
 let zones;try{zones=JSON.parse(execFileSync('aws.exe',['ec2','describe-availability-zones','--zone-names','us-east-1a','us-east-1b','--region','us-east-1','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})).AvailabilityZones;}catch{throw Error('Production availability-zone verification failed');}
 if(zones.length!==2||!zones.every((zone:{State:string;RegionName:string})=>zone.State==='available'&&zone.RegionName==='us-east-1'))throw Error('Production availability zones are not available');
}
productionAssembly(app,target,offline);
