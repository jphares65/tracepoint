import type { ProductionPostgresTopology } from "./production-database-stack";

export interface FullAwsProductionTarget {
  account:string;
  region:"us-east-1";
  roleArn:string;
  hostname:"tracepointhq.com";
  certificateArn:string;
  imageTag:string;
  architectureTarget:"full-aws";
  deploymentPhase:"full-aws-final";
  dataMode:"aws-postgres-authoritative";
  authMode:"cognito";
  storageMode:"s3";
  emailMode:"ses";
  databaseTopology:ProductionPostgresTopology;
  desiredCount:2;
  maxCapacity:4;
  humanAlertEmail?:string;
  deploymentAuthorization?:{account:string;roleArn:string;expiresAt:string;reference:string};
}

export function validateFullAwsProductionTarget(value:FullAwsProductionTarget,{offline=false,now=Date.now()}={}){
 const denied=["265544358665","559054714699","111111111111"];
 if(!/^\d{12}$/.test(value.account)||denied.includes(value.account)&&!(offline&&value.account==="111111111111"))throw Error("Dedicated production account required");
 if(value.region!=="us-east-1"||value.roleArn!==`arn:aws:iam::${value.account}:role/TracePointMigrationProduction`)throw Error("Exact production role and region required");
 if(value.hostname!=="tracepointhq.com"||value.architectureTarget!=="full-aws"||value.deploymentPhase!=="full-aws-final"||value.dataMode!=="aws-postgres-authoritative"||value.authMode!=="cognito"||value.storageMode!=="s3"||value.emailMode!=="ses"||!['aurora-serverless-v2','rds-multi-az'].includes(value.databaseTopology)||value.desiredCount!==2||value.maxCapacity!==4)throw Error("Complete full-AWS provider declaration required");
 if(!new RegExp(`^arn:aws:acm:us-east-1:${value.account}:certificate/[0-9a-f-]{36}$`).test(value.certificateArn)||!/^[0-9a-f]{40}$/.test(value.imageTag))throw Error("Production certificate and immutable image required");
 if(value.humanAlertEmail&&!/^[-a-zA-Z0-9._+]+@tracepointhq\.com$/.test(value.humanAlertEmail))throw Error("Reviewed TracePoint alert mailbox required");
 if(!offline){const a=value.deploymentAuthorization;if(!a||a.account!==value.account||a.roleArn!==value.roleArn||!a.reference||a.reference.length>160||!Number.isFinite(Date.parse(a.expiresAt))||Date.parse(a.expiresAt)<=now||Date.parse(a.expiresAt)>now+86400000)throw Error("Explicit unexpired production authorization required");}
 return value;
}

export function verifyFullAwsProductionIdentity(target:FullAwsProductionTarget,identity:{Account:string;Arn:string},region:string){
 validateFullAwsProductionTarget(target);if(identity.Account!==target.account||region!==target.region||!new RegExp(`^arn:aws:sts::${target.account}:assumed-role/TracePointMigrationProduction/[^/]+$`).test(identity.Arn))throw Error("Live production identity mismatch");
}
