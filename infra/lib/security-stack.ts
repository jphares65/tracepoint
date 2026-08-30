import * as cdk from "aws-cdk-lib";
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

    new cdk.CfnOutput(this, "DataKeyArn", { value: this.dataKey.keyArn });
  }
}
