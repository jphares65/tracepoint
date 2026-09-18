import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
export interface PrivateStorageStackProps extends cdk.StackProps { environmentName: 'staging'|'production'; taskRole:iam.IRole; dataKey:kms.IKey; }
export class PrivateStorageStack extends cdk.Stack {
 readonly bucket:s3.Bucket;
 constructor(scope:Construct,id:string,props:PrivateStorageStackProps){
  super(scope,id,props);
  this.node.setContext("@aws-cdk/aws-s3:serverAccessLogsUseBucketPolicy",true);
  if(this.account==='265544358665'||(props.environmentName==='staging'&&this.account!=='559054714699')||(props.environmentName==='production'&&this.account==='559054714699'))throw new Error('Private storage account mismatch');
  const logs=new s3.Bucket(this,'AccessLogs',{
   bucketName:'tracepoint-'+props.environmentName+'-storage-logs-'+this.account,
   encryption:s3.BucketEncryption.S3_MANAGED,blockPublicAccess:s3.BlockPublicAccess.BLOCK_ALL,
   objectOwnership:s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,enforceSSL:true,
   removalPolicy:cdk.RemovalPolicy.RETAIN,versioned:true,
   lifecycleRules:[{expiration:cdk.Duration.days(props.environmentName==='staging'?90:365),noncurrentVersionExpiration:cdk.Duration.days(30),abortIncompleteMultipartUploadAfter:cdk.Duration.days(1)}],
  });
  this.bucket=new s3.Bucket(this,'Objects',{
   bucketName:'tracepoint-'+props.environmentName+'-private-'+this.account,
   encryption:s3.BucketEncryption.KMS,encryptionKey:props.dataKey,bucketKeyEnabled:true,
   blockPublicAccess:s3.BlockPublicAccess.BLOCK_ALL,
   objectOwnership:s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,enforceSSL:true,
   removalPolicy:cdk.RemovalPolicy.RETAIN,versioned:true,
   serverAccessLogsBucket:logs,serverAccessLogsPrefix:'objects/',
   lifecycleRules:[{noncurrentVersionExpiration:cdk.Duration.days(props.environmentName==='staging'?30:365),abortIncompleteMultipartUploadAfter:cdk.Duration.days(1)}],
  });
  this.bucket.addToResourcePolicy(new iam.PolicyStatement({
   sid:'DenyExplicitNonKmsEncryption',effect:iam.Effect.DENY,principals:[new iam.AnyPrincipal()],actions:['s3:PutObject'],resources:[this.bucket.arnForObjects('*')],
   conditions:{Null:{'s3:x-amz-server-side-encryption':'false'},StringNotEquals:{'s3:x-amz-server-side-encryption':'aws:kms'}},
  }));
  this.bucket.addToResourcePolicy(new iam.PolicyStatement({
   sid:'DenyExplicitWrongKmsKey',effect:iam.Effect.DENY,principals:[new iam.AnyPrincipal()],actions:['s3:PutObject'],resources:[this.bucket.arnForObjects('*')],
   conditions:{Null:{'s3:x-amz-server-side-encryption-aws-kms-key-id':'false'},StringNotEquals:{'s3:x-amz-server-side-encryption-aws-kms-key-id':props.dataKey.keyArn}},
  }));
  this.bucket.addToResourcePolicy(new iam.PolicyStatement({
   sid:'DenyKmsWithoutExplicitKey',effect:iam.Effect.DENY,principals:[new iam.AnyPrincipal()],actions:['s3:PutObject'],resources:[this.bucket.arnForObjects('*')],
   conditions:{StringEquals:{'s3:x-amz-server-side-encryption':'aws:kms'},Null:{'s3:x-amz-server-side-encryption-aws-kms-key-id':'true'}},
  }));
  cdk.Tags.of(this.bucket).add('Backup','daily');
  const runtimeAccess=new iam.Policy(this,'RuntimeObjectAccess',{
   roles:[props.taskRole],statements:[new iam.PolicyStatement({
    actions:['s3:GetObject','s3:PutObject','s3:DeleteObject'],
    resources:[this.bucket.arnForObjects('attachments/*'),this.bucket.arnForObjects('department-assets/*')],
    conditions:{StringEquals:{'s3:ResourceAccount':this.account}},
   })],
  });
  const runtimeKeyAccess=new iam.Policy(this,'RuntimeKeyAccess',{
   roles:[props.taskRole],statements:[new iam.PolicyStatement({
    actions:['kms:Decrypt','kms:GenerateDataKey'],resources:[props.dataKey.keyArn],
    conditions:{StringEquals:{'kms:ViaService':`s3.${this.region}.amazonaws.com`},ArnEquals:{'kms:EncryptionContext:aws:s3:arn':this.bucket.bucketArn}},
   })],
  });
  NagSuppressions.addResourceSuppressions(runtimeAccess,[{
   id:'AwsSolutions-IAM5',
   reason:'Runtime object operations are restricted to the two reviewed bucket prefixes; an object-key suffix necessarily uses a wildcard.',
   appliesTo:['Resource::<ObjectsA92BA4F1.Arn>/attachments/*','Resource::<ObjectsA92BA4F1.Arn>/department-assets/*'],
  }]);
  runtimeKeyAccess.node.addDependency(this.bucket);
  new cdk.CfnOutput(this,'PrivateBucketName',{value:this.bucket.bucketName});
  new cdk.CfnOutput(this,'ExpectedBucketOwner',{value:this.account});
 }
}
