import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as kms from "aws-cdk-lib/aws-kms";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

export type ProductionPostgresTopology = "aurora-serverless-v2" | "rds-multi-az";

export interface ProductionDatabaseStackProps extends cdk.StackProps {
  topology: ProductionPostgresTopology;
  vpc: ec2.IVpc;
  dataKey: kms.IKey;
  securityGroup: ec2.ISecurityGroup;
}

/**
 * Production PostgreSQL target supporting both choices already documented in
 * aws-database-target-decision.md. Selection is configuration-only; no code
 * change is needed after the owner selects measured Aurora vs RDS economics.
 */
export class ProductionDatabaseStack extends cdk.Stack {
  readonly runtimeSecret: secretsmanager.Secret;
  readonly endpointAddress: string;

  constructor(scope: Construct, id: string, props: ProductionDatabaseStackProps) {
    super(scope, id, props);
    if (this.region !== "us-east-1" || ["265544358665", "559054714699"].includes(this.account)) {
      throw new Error("Dedicated production PostgreSQL account and us-east-1 are required");
    }
    const key = kms.Key.fromKeyArn(this, "ImportedDataKey", props.dataKey.keyArn);
    let migratorSecret: secretsmanager.ISecret;

    if (props.topology === "aurora-serverless-v2") {
      const cluster = new rds.DatabaseCluster(this, "Database", {
        clusterIdentifier: "tracepoint-production",
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_17_9,
        }),
        credentials: rds.Credentials.fromGeneratedSecret("tracepoint_migrator", {
          encryptionKey: key,
          secretName: "tracepoint/production/database/migrator",
        }),
        defaultDatabaseName: "tracepoint",
        writer: rds.ClusterInstance.serverlessV2("writer"),
        readers: [rds.ClusterInstance.serverlessV2("reader", { scaleWithWriter: true })],
        serverlessV2MinCapacity: 0.5,
        serverlessV2MaxCapacity: 4,
        vpc: props.vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        securityGroups: [props.securityGroup],
        storageEncrypted: true,
        storageEncryptionKey: key,
        backup: { retention: cdk.Duration.days(35) },
        deletionProtection: true,
        copyTagsToSnapshot: true,
        cloudwatchLogsExports: ["postgresql"],
        cloudwatchLogsRetention: cdk.aws_logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      });
      this.endpointAddress = cluster.clusterEndpoint.hostname;
      migratorSecret = cluster.secret!;
      NagSuppressions.addResourceSuppressions(cluster,[{
        id:"AwsSolutions-RDS6",
        reason:"TracePoint uses separate least-privilege PostgreSQL roles with Secrets Manager rotation semantics; IAM database tokens are not yet used by the pooled pg transport.",
      }]);
      new cloudwatch.Alarm(this, "DatabaseCpuAlarm", {
        alarmName: "tracepoint-production-database-cpu",
        metric: cluster.metricCPUUtilization(), threshold: 80,
        evaluationPeriods: 3, datapointsToAlarm: 3,
      });
      new cloudwatch.Alarm(this, "DatabaseConnectionsAlarm", {
        alarmName: "tracepoint-production-database-connections",
        metric: cluster.metricDatabaseConnections(), threshold: 150,
        evaluationPeriods: 3, datapointsToAlarm: 3,
      });
    } else {
      const parameters = new rds.ParameterGroup(this, "DatabaseParameters", {
        engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17_9 }),
        parameters: { "rds.force_ssl": "1", log_statement: "none", log_min_error_statement: "panic" },
      });
      const instance = new rds.DatabaseInstance(this, "Database", {
        instanceIdentifier: "tracepoint-production",
        engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17_9 }),
        credentials: rds.Credentials.fromGeneratedSecret("tracepoint_migrator", {
          encryptionKey: key,
          secretName: "tracepoint/production/database/migrator",
        }),
        databaseName: "tracepoint",
        vpc: props.vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        securityGroups: [props.securityGroup],
        publiclyAccessible: false,
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
        allocatedStorage: 100,
        maxAllocatedStorage: 500,
        storageType: rds.StorageType.GP3,
        storageEncrypted: true,
        storageEncryptionKey: key,
        multiAz: true,
        backupRetention: cdk.Duration.days(35),
        deleteAutomatedBackups: false,
        deletionProtection: true,
        copyTagsToSnapshot: true,
        autoMinorVersionUpgrade: false,
        allowMajorVersionUpgrade: false,
        parameterGroup: parameters,
        cloudwatchLogsExports: ["postgresql"],
        cloudwatchLogsRetention: cdk.aws_logs.RetentionDays.ONE_MONTH,
        enablePerformanceInsights: true,
        performanceInsightEncryptionKey: key,
        performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
        removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      });
      this.endpointAddress = instance.dbInstanceEndpointAddress;
      migratorSecret = instance.secret!;
      new cloudwatch.Alarm(this, "DatabaseCpuAlarm", {
        alarmName: "tracepoint-production-database-cpu",
        metric: instance.metricCPUUtilization(), threshold: 80,
        evaluationPeriods: 3, datapointsToAlarm: 3,
      });
      new cloudwatch.Alarm(this, "DatabaseConnectionsAlarm", {
        alarmName: "tracepoint-production-database-connections",
        metric: instance.metricDatabaseConnections(), threshold: 150,
        evaluationPeriods: 3, datapointsToAlarm: 3,
      });
      new cloudwatch.Alarm(this, "DatabaseStorageAlarm", {
        alarmName: "tracepoint-production-database-free-storage",
        metric: instance.metricFreeStorageSpace(), threshold: 10 * 1024 * 1024 * 1024,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 3, datapointsToAlarm: 3,
      });
    }

    this.runtimeSecret = new secretsmanager.Secret(this, "RuntimeCredential", {
      secretName: "tracepoint/production/database/runtime",
      description: "Non-owner PostgreSQL login for the TracePoint production runtime",
      encryptionKey: key,
      generateSecretString: {
        secretStringTemplate: this.toJsonString({
          host: this.endpointAddress,
          port: 5432,
          username: "tracepoint_runtime",
          dbname: "tracepoint",
        }),
        generateStringKey: "password",
        passwordLength: 40,
        excludePunctuation: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    for(const secret of [migratorSecret,this.runtimeSecret])NagSuppressions.addResourceSuppressions(secret,[{
      id:"AwsSolutions-SMG4",
      reason:"Database credentials are created before the PostgreSQL roles exist; the committed bootstrap/rotation workflow changes the database login and secret atomically before activation.",
    }]);
    NagSuppressions.addStackSuppressions(this,[
      {id:"AwsSolutions-SMG4",reason:"Database roles do not exist until bootstrap; the committed bootstrap/rotation workflow changes the database login and Secrets Manager value atomically before activation."},
      {id:"AwsSolutions-IAM4",reason:"The CDK RDS log-retention provider uses its standard Lambda execution policy only to configure the exact generated RDS log group."},
      {id:"AwsSolutions-IAM5",reason:"The CDK RDS log-retention provider requires log-service discovery and retention calls whose service API does not support a narrower resource during creation."},
    ]);
    cdk.Tags.of(this).add("Backup", "daily");
    cdk.Tags.of(this).add("ArchitectureTarget", "full-aws");
    new cdk.CfnOutput(this, "DatabaseEndpoint", { value: this.endpointAddress });
    new cdk.CfnOutput(this, "MigratorSecretArn", { value: migratorSecret.secretArn });
    new cdk.CfnOutput(this, "RuntimeSecretArn", { value: this.runtimeSecret.secretArn });
    new cdk.CfnOutput(this, "Topology", { value: props.topology });
  }
}
