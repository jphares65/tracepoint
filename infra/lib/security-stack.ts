import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import { Construct } from "constructs";

export interface SecurityStackProps extends cdk.StackProps {
  environmentName: string;
}

export class SecurityStack extends cdk.Stack {
  public readonly dataKey: kms.Key;

  constructor(scope: Construct, id: string, props: SecurityStackProps) {
    super(scope, id, props);

    this.dataKey = new kms.Key(this, "DataKey", {
      alias: `alias/tracepoint/${props.environmentName}/data`,
      description: `TracePoint ${props.environmentName} customer-managed data key`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const logGroupArn = (name: string) => cdk.Stack.of(this).formatArn({
      service: "logs",
      resource: "log-group",
      resourceName: name,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    const encryptedLogGroupArns = [
      logGroupArn(`/tracepoint/${props.environmentName}/application`),
      logGroupArn(`/tracepoint/${props.environmentName}/network/vpc-flow`),
      logGroupArn(`/tracepoint/${props.environmentName}/ses-feedback-worker`),
      logGroupArn(`/tracepoint/${props.environmentName}/identity-migration/*`),
      logGroupArn(`/aws/rds/instance/tracepoint-${props.environmentName}/postgresql`),
      logGroupArn(`/aws/rds/cluster/tracepoint-${props.environmentName}/postgresql`),
    ];
    this.dataKey.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`)],
        actions: [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey",
        ],
        resources: ["*"],
        conditions: {
          ArnLike: {
            "kms:EncryptionContext:aws:logs:arn": encryptedLogGroupArns,
          },
        },
      }),
    );

    new cdk.CfnOutput(this, "DataKeyArn", { value: this.dataKey.keyArn });
  }
}
