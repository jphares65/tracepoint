import * as cdk from "aws-cdk-lib";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface StorageStackProps extends cdk.StackProps {
  environmentName: string;
  dataKey: kms.IKey;
  logBucket: s3.IBucket;
}

export class StorageStack extends cdk.Stack {
  public readonly attachmentsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    this.attachmentsBucket = new s3.Bucket(this, "AttachmentsBucket", {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: props.dataKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      serverAccessLogsBucket: props.logBucket,
      serverAccessLogsPrefix: `s3-access/attachments/${props.environmentName}/`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      lifecycleRules: [
        {
          id: "abort-incomplete-multipart",
          enabled: true,
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        {
          id: "noncurrent-version-retention",
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(365),
        },
      ],
    });

    new cdk.CfnOutput(this, "AttachmentsBucketName", {
      value: this.attachmentsBucket.bucketName,
    });
  }
}
