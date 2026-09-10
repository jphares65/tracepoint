export interface ProductionTarget {account:string;region:'us-east-1';roleArn:string;hostname:'tracepointhq.com';certificateArn:string;imageTag:string;emailFromAddress:string;architectureTarget:'full-aws';deploymentPhase:'temporary-provider-bridge';dataMode:'retain-production-providers';desiredCount:2;maxCapacity:4;deploymentAuthorization?:{account:string;roleArn:string;expiresAt:string;reference:string};}
export function validateProductionTarget(value:ProductionTarget,{offline=false}={}){
 if(!offline)throw Error('The temporary hybrid production bridge is retired for live operation. Use offline preview or scripts/execute-full-aws-production-rollback.ps1.');
 const denied=['265544358665','559054714699','111111111111'];
 if(!/^[0-9]{12}$/.test(value.account)||denied.includes(value.account)&&!(offline&&value.account==='111111111111'))throw Error('Dedicated production account required');
 if(value.region!=='us-east-1'||value.roleArn!=='arn:aws:iam::'+value.account+':role/TracePointMigrationProduction')throw Error('Exact production role and region required');
 if(value.hostname!=='tracepointhq.com'||value.architectureTarget!=='full-aws'||value.deploymentPhase!=='temporary-provider-bridge'||value.dataMode!=='retain-production-providers'||value.desiredCount!==2||value.maxCapacity!==4)throw Error('Reviewed temporary production hosting bridge and full-AWS target declaration required');
 if(!new RegExp('^arn:aws:acm:us-east-1:'+value.account+':certificate/[0-9a-f-]{36}$').test(value.certificateArn)||!/^[0-9a-f]{40}$/.test(value.imageTag)||!/^[-a-zA-Z0-9._+]+@tracepointhq\.com$/.test(value.emailFromAddress))throw Error('Production certificate, immutable image and sender required');
 return value;
}
export function verifyProductionIdentity(target:ProductionTarget,identity:{Account:string;Arn:string},region:string){
 validateProductionTarget(target);if(identity.Account!==target.account||region!==target.region||!new RegExp('^arn:aws:sts::'+target.account+':assumed-role/TracePointMigrationProduction/[^/]+$').test(identity.Arn))throw Error('Live production identity mismatch');
}
