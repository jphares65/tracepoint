import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export interface NetworkStackProps extends cdk.StackProps {
  environmentName: string;
}

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly databaseSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: `tracepoint-${props.environmentName}`,
      ipAddresses: ec2.IpAddresses.cidr("10.40.0.0/16"),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public-ingress",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 27,
          name: "private-database",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
      restrictDefaultSecurityGroup: true,
      flowLogs: {
        cloudWatch: {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(),
          trafficType: ec2.FlowLogTrafficType.ALL,
        },
      },
    });
    this.databaseSecurityGroup = new ec2.SecurityGroup(this, "DatabaseSecurity", {
      vpc: this.vpc,
      description: "TracePoint PostgreSQL accepts TLS clients only from the application task security group",
      allowAllOutbound: false,
    });
    for (const subnet of [...this.vpc.publicSubnets, ...this.vpc.isolatedSubnets]) {
      cdk.Annotations.of(subnet.node.defaultChild!).acknowledgeWarning(
        "CloudFormation-Validate::W3010",
        "The staging AZs are intentionally pinned for deterministic offline synthesis and were verified in account 559054714699.",
      );
    }

    // S3 gateway endpoints have no hourly charge. Paid interface endpoints are
    // deliberately deferred for lean staging while the task already needs
    // public egress for Supabase and Brevo.
    this.vpc.addGatewayEndpoint("S3Endpoint", {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    new cdk.CfnOutput(this, "VpcId", { value: this.vpc.vpcId });
  }
}
