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

    const applicationLogGroupArn = cdk.Stack.of(this).formatArn({
      service: "logs",
      resource: "log-group",
      resourceName: `/tracepoint/${props.environmentName}/application`,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
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
          ArnEquals: {
            "kms:EncryptionContext:aws:logs:arn": applicationLogGroupArn,
          },
        },
      }),
    );

    new cdk.CfnOutput(this, "DataKeyArn", { value: this.dataKey.keyArn });
  }
}
