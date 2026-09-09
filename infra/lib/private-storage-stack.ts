import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
export interface PrivateStorageStackProps extends cdk.StackProps { environmentName: 'staging'|'production'; taskRole:iam.IRole; }
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
   encryption:s3.BucketEncryption.S3_MANAGED,blockPublicAccess:s3.BlockPublicAccess.BLOCK_ALL,
   objectOwnership:s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,enforceSSL:true,
   removalPolicy:cdk.RemovalPolicy.RETAIN,versioned:true,
   serverAccessLogsBucket:logs,serverAccessLogsPrefix:'objects/',
   lifecycleRules:[{noncurrentVersionExpiration:cdk.Duration.days(props.environmentName==='staging'?30:365),abortIncompleteMultipartUploadAfter:cdk.Duration.days(1)}],
  });
  new iam.Policy(this,'RuntimeObjectAccess',{
   roles:[props.taskRole],statements:[new iam.PolicyStatement({
    actions:['s3:GetObject','s3:PutObject','s3:DeleteObject'],
    resources:[this.bucket.arnForObjects('attachments/*'),this.bucket.arnForObjects('department-assets/*')],
    conditions:{StringEquals:{'s3:ResourceAccount':this.account}},
   })],
  });
  new cdk.CfnOutput(this,'PrivateBucketName',{value:this.bucket.bucketName});
  new cdk.CfnOutput(this,'ExpectedBucketOwner',{value:this.account});
 }
}
