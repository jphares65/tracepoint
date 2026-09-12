import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

export type ProductionPostgresTopology = "aurora-serverless-v2" | "rds-multi-az" | "rds-single-az";

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
    const databaseLogGroup = new logs.LogGroup(this, "DatabaseLogs", {
      logGroupName: `/aws/rds/${props.topology === "aurora-serverless-v2" ? "cluster" : "instance"}/tracepoint-production/postgresql`,
      encryptionKey: key,
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const migratorSecret = new secretsmanager.Secret(this, "MigratorCredential", {
      secretName: "tracepoint/production/database/migrator",
      description: "Owner credential used only by the controlled production database migration task",
      encryptionKey: key,
      generateSecretString: {
        secretStringTemplate: this.toJsonString({ username: "tracepoint_migrator" }),
        generateStringKey: "password",
        passwordLength: 40,
        excludePunctuation: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    if (props.topology === "aurora-serverless-v2") {
      const cluster = new rds.DatabaseCluster(this, "Database", {
        clusterIdentifier: "tracepoint-production",
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_17_9,
        }),
        credentials: rds.Credentials.fromSecret(migratorSecret, "tracepoint_migrator"),
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
        removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      });
      cluster.node.addDependency(databaseLogGroup);
      this.endpointAddress = cluster.clusterEndpoint.hostname;
      NagSuppressions.addResourceSuppressions(cluster,[{
       id:"AwsSolutions-RDS6",
       reason:"TracePoint uses separate least-privilege PostgreSQL roles with Secrets Manager rotation semantics; IAM database tokens are not yet used by the pooled pg transport.",
      },{
       id:"AwsSolutions-RDS11",
       reason:"The database is isolated in private subnets and accepts 5432 only from exact workload security groups; changing PostgreSQL's standard port would not add a meaningful authorization boundary and would break the reviewed migration tooling contract.",
      }]);
      new cloudwatch.Alarm(this, "DatabaseCpuAlarm", {
        alarmName: "tracepoint-production-database-cpu",
        alarmDescription: "Database CPU is above 80% for three minutes; missing continuous RDS telemetry is treated as a monitoring failure.",
        metric: cluster.metricCPUUtilization({period: cdk.Duration.minutes(1)}), threshold: 80,
        evaluationPeriods: 3, datapointsToAlarm: 3,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      });
      new cloudwatch.Alarm(this, "DatabaseConnectionsAlarm", {
        alarmName: "tracepoint-production-database-connections",
        alarmDescription: "Connections exceed the bounded four-task plus worker pool allowance; missing continuous RDS telemetry is treated as a monitoring failure.",
        metric: cluster.metricDatabaseConnections({period: cdk.Duration.minutes(1)}), threshold: 100,
        evaluationPeriods: 3, datapointsToAlarm: 3,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      });
    } else {
      const initialSingleAz = props.topology === "rds-single-az";
      const parameters = new rds.ParameterGroup(this, "DatabaseParameters", {
        engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17_9 }),
        parameters: { "rds.force_ssl": "1", log_statement: "none", log_min_error_statement: "panic" },
      });
      const instance = new rds.DatabaseInstance(this, "Database", {
        instanceIdentifier: "tracepoint-production",
        engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17_9 }),
        credentials: rds.Credentials.fromSecret(migratorSecret, "tracepoint_migrator"),
        databaseName: "tracepoint",
        vpc: props.vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        securityGroups: [props.securityGroup],
        publiclyAccessible: false,
        availabilityZone: initialSingleAz ? props.vpc.isolatedSubnets[0].availabilityZone : undefined,
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T4G,
          initialSingleAz ? ec2.InstanceSize.SMALL : ec2.InstanceSize.MEDIUM,
        ),
        allocatedStorage: initialSingleAz ? 20 : 100,
        maxAllocatedStorage: initialSingleAz ? 100 : 500,
        storageType: rds.StorageType.GP3,
        storageEncrypted: true,
        storageEncryptionKey: key,
        multiAz: !initialSingleAz,
        backupRetention: cdk.Duration.days(35),
        deleteAutomatedBackups: false,
        deletionProtection: true,
        copyTagsToSnapshot: true,
        autoMinorVersionUpgrade: false,
        allowMajorVersionUpgrade: false,
        parameterGroup: parameters,
        cloudwatchLogsExports: ["postgresql"],
        enablePerformanceInsights: true,
        performanceInsightEncryptionKey: key,
        performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
        removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      });
      instance.node.addDependency(databaseLogGroup);
      NagSuppressions.addResourceSuppressions(instance,[{
        id:"AwsSolutions-RDS11",
        reason:"The database is isolated in private subnets and accepts 5432 only from exact workload security groups; changing PostgreSQL's standard port would not add a meaningful authorization boundary and would break the reviewed migration tooling contract.",
      }, ...(initialSingleAz ? [{
        id:"AwsSolutions-RDS3",
        reason:"The explicitly selected initial-production tier uses Single-AZ RDS with 35-day PITR, AWS Backup, deletion protection, and rehearsed restore; Multi-AZ is the documented growth upgrade and requires no database-engine migration.",
      }] : [])]);
      this.endpointAddress = instance.dbInstanceEndpointAddress;
      new cloudwatch.Alarm(this, "DatabaseCpuAlarm", {
        alarmName: "tracepoint-production-database-cpu",
        alarmDescription: "Database CPU is above 80% for three minutes; missing continuous RDS telemetry is treated as a monitoring failure.",
        metric: instance.metricCPUUtilization({period: cdk.Duration.minutes(1)}), threshold: 80,
        evaluationPeriods: 3, datapointsToAlarm: 3,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      });
      new cloudwatch.Alarm(this, "DatabaseConnectionsAlarm", {
        alarmName: "tracepoint-production-database-connections",
        alarmDescription: "Connections exceed the bounded runtime plus worker pool allowance; missing continuous RDS telemetry is treated as a monitoring failure.",
        metric: instance.metricDatabaseConnections({period: cdk.Duration.minutes(1)}), threshold: initialSingleAz ? 50 : 100,
        evaluationPeriods: 3, datapointsToAlarm: 3,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      });
      new cloudwatch.Alarm(this, "DatabaseStorageAlarm", {
        alarmName: "tracepoint-production-database-free-storage",
        alarmDescription: "Free database storage is below the reviewed reserve; missing continuous RDS telemetry is treated as a monitoring failure.",
        metric: instance.metricFreeStorageSpace({period: cdk.Duration.minutes(1)}), threshold: (initialSingleAz ? 5 : 10) * 1024 * 1024 * 1024,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 3, datapointsToAlarm: 3,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
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
    ]);
    cdk.Tags.of(this).add("Backup", "daily");
    cdk.Tags.of(this).add("ArchitectureTarget", "full-aws");
    new cdk.CfnOutput(this, "DatabaseEndpoint", { value: this.endpointAddress });
    new cdk.CfnOutput(this, "MigratorSecretArn", { value: migratorSecret.secretArn });
    new cdk.CfnOutput(this, "RuntimeSecretArn", { value: this.runtimeSecret.secretArn });
    new cdk.CfnOutput(this, "Topology", { value: props.topology });
  }
}
