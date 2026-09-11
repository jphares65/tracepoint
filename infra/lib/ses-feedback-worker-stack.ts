import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sources from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

export interface SesFeedbackWorkerProps extends cdk.StackProps {
  environmentName: "staging" | "production";
  vpc: ec2.IVpc;
  databaseSecurityGroup: ec2.ISecurityGroup;
  databaseSecret: secretsmanager.ISecret;
  feedbackTopic: sns.ITopic;
  feedbackQueue: sqs.IQueue;
  feedbackDeadLetterQueue: sqs.IQueue;
}

export class SesFeedbackWorkerStack extends cdk.Stack {
  readonly worker: lambda.Function;
  readonly alarms: cloudwatch.Alarm[];

  constructor(scope: Construct, id: string, props: SesFeedbackWorkerProps) {
    super(scope, id, props);
    const stagingAccount = "559054714699";
    if (this.region !== "us-east-1" || this.account === "265544358665" ||
        (props.environmentName === "staging" ? this.account !== stagingAccount : this.account === stagingAccount)) {
      throw new Error("SES feedback worker account/environment boundary");
    }

    const workerSecurityGroup = new ec2.SecurityGroup(this, "WorkerSecurity", {
      vpc: props.vpc, allowAllOutbound: false, description: "SES feedback worker has only RDS and AWS PrivateLink egress",
    });
    const endpointSecurityGroup = new ec2.SecurityGroup(this, "EndpointSecurity", {
      vpc: props.vpc, allowAllOutbound: false, description: "Private AWS API endpoints accept only the SES feedback worker",
    });
    endpointSecurityGroup.addIngressRule(workerSecurityGroup, ec2.Port.tcp(443), "Worker HTTPS to AWS APIs");
    workerSecurityGroup.addEgressRule(endpointSecurityGroup, ec2.Port.tcp(443), "AWS API PrivateLink only");
    workerSecurityGroup.addEgressRule(props.databaseSecurityGroup, ec2.Port.tcp(5432), "PostgreSQL feedback persistence only");
    new ec2.CfnSecurityGroupIngress(this, "DatabaseFromFeedbackWorker", {
      groupId: props.databaseSecurityGroup.securityGroupId,
      sourceSecurityGroupId: workerSecurityGroup.securityGroupId,
      ipProtocol: "tcp", fromPort: 5432, toPort: 5432,
      description: "SES feedback persistence",
    });

    for (const [name, service] of [
      ["SecretsEndpoint", ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER],
      ["SnsEndpoint", ec2.InterfaceVpcEndpointAwsService.SNS],
    ] as const) {
      new ec2.InterfaceVpcEndpoint(this, name, {
        vpc: props.vpc, service, privateDnsEnabled: true,
        securityGroups: [endpointSecurityGroup],
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      });
    }

    const caLayer = new lambda.LayerVersion(this, "RdsCaLayer", {
      code: lambda.Code.fromAsset(path.join(__dirname, "../assets/rds-ca")),
      description: "Official AWS RDS us-east-1 trust roots",
      compatibleRuntimes: [lambda.Runtime.NODEJS_24_X],
    });
    const logGroup = new logs.LogGroup(this, "WorkerLogs", {
      retention: props.environmentName === "production" ? logs.RetentionDays.ONE_YEAR : logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const workerRole = new iam.Role(this, "WorkerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Least-privilege SES feedback worker execution role",
    });
    workerRole.addToPolicy(new iam.PolicyStatement({
      actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
      resources: [`${logGroup.logGroupArn}:*`],
    }));
    workerRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        "ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DeleteNetworkInterface",
        "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses",
      ],
      resources: ["*"],
      conditions: { StringEquals: { "aws:RequestedRegion": this.region } },
    }));
    NagSuppressions.addResourceSuppressions(workerRole, [{
      id: "AwsSolutions-IAM5",
      reason: "CloudWatch Logs requires a stream suffix below this worker's dedicated retained log group, and Lambda VPC ENI lifecycle APIs do not support resource-level ARNs. The ENI statement is limited to the five required actions and the stack region.",
      appliesTo: [`Resource::<${this.getLogicalId(logGroup.node.defaultChild as cdk.CfnResource)}.Arn>:*`, "Resource::*"],
    }], true);
    this.worker = new lambdaNode.NodejsFunction(this, "Worker", {
      entry: path.resolve(__dirname, "../../src/lib/email/ses-feedback-handler.ts").replaceAll("\\", "/"),
      handler: "handler", runtime: lambda.Runtime.NODEJS_24_X, role: workerRole,
      depsLockFilePath: path.join(__dirname, "../../package-lock.json"),
      timeout: cdk.Duration.seconds(30), memorySize: 256, reservedConcurrentExecutions: 2,
      vpc: props.vpc, vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }, securityGroups: [workerSecurityGroup],
      layers: [caLayer], logGroup,
      environment: {
        TRACEPOINT_AWS_ACCOUNT: this.account,
        TRACEPOINT_DATABASE_SECRET_ARN: props.databaseSecret.secretArn,
        TRACEPOINT_RDS_CA_PATH: "/opt/us-east-1-bundle.pem",
        TRACEPOINT_SES_FEEDBACK_TOPIC_ARN: props.feedbackTopic.topicArn,
      },
      bundling: { minify: true, sourceMap: true, nodeModules: ["pg"] },
    });
    props.databaseSecret.grantRead(this.worker);
    this.worker.addEventSource(new sources.SqsEventSource(props.feedbackQueue, {
      batchSize: 10, reportBatchItemFailures: true, maxConcurrency: 2,
    }));

    this.alarms = [
      new cloudwatch.Alarm(this, "QueueAgeAlarm", { metric: props.feedbackQueue.metricApproximateAgeOfOldestMessage(), threshold: 300, evaluationPeriods: 2 }),
      new cloudwatch.Alarm(this, "DeadLetterAlarm", { metric: props.feedbackDeadLetterQueue.metricApproximateNumberOfMessagesVisible(), threshold: 1, evaluationPeriods: 1 }),
      new cloudwatch.Alarm(this, "WorkerErrorsAlarm", { metric: this.worker.metricErrors(), threshold: 1, evaluationPeriods: 1 }),
      new cloudwatch.Alarm(this, "WorkerThrottlesAlarm", { metric: this.worker.metricThrottles(), threshold: 1, evaluationPeriods: 1 }),
    ];
  }
}
