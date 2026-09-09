import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as kms from "aws-cdk-lib/aws-kms";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface StagingDatabaseStackProps extends cdk.StackProps {
  environmentName: "staging";
  vpc: ec2.IVpc;
  dataKey: kms.IKey;
  securityGroup: ec2.ISecurityGroup;
  expiresAfterUtc: string;
}

export class StagingDatabaseStack extends cdk.Stack {
  readonly database: rds.DatabaseInstance;
  readonly runtimeSecret: secretsmanager.Secret;
  readonly securityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props: StagingDatabaseStackProps) {
    super(scope, id, props);
    if (this.account !== "559054714699" || this.region !== "us-east-1" ||
        !/^2026-09-1[0-3]T\d{2}:\d{2}:\d{2}Z$/.test(props.expiresAfterUtc)) {
      throw new Error("Explicit bounded staging database target required");
    }

    cdk.Tags.of(this).add("Purpose", "full-aws-synthetic-parity");
    cdk.Tags.of(this).add("DataClassification", "Synthetic-Non-PII");
    cdk.Tags.of(this).add("ExpiresAfterUTC", props.expiresAfterUtc);

    this.securityGroup = props.securityGroup;
    // Use an imported view inside this consumer stack so grants created by RDS,
    // Secrets Manager, or ECS remain identity-based here instead of mutating the
    // key policy in the security stack and introducing a dependency cycle.
    const dataKey = kms.Key.fromKeyArn(this, "ImportedDataKey", props.dataKey.keyArn);

    const parameters = new rds.ParameterGroup(this, "DatabaseParameters", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.of("18.4", "18"),
      }),
      parameters: {
        "rds.force_ssl": "1",
        log_statement: "none",
        log_min_error_statement: "panic",
      },
    });

    this.database = new rds.DatabaseInstance(this, "Database", {
      instanceIdentifier: "tracepoint-staging-full-aws",
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.of("18.4", "18"),
      }),
      credentials: rds.Credentials.fromGeneratedSecret("tracepoint_migrator", {
        encryptionKey: dataKey,
        secretName: "tracepoint/staging/database/migrator",
      }),
      databaseName: "tracepoint",
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [this.securityGroup],
      publiclyAccessible: false,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      allocatedStorage: 20,
      maxAllocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      storageEncryptionKey: dataKey,
      multiAz: false,
      backupRetention: cdk.Duration.days(1),
      deleteAutomatedBackups: false,
      deletionProtection: true,
      copyTagsToSnapshot: true,
      autoMinorVersionUpgrade: false,
      allowMajorVersionUpgrade: false,
      parameterGroup: parameters,
      cloudwatchLogsExports: ["postgresql"],
      cloudwatchLogsRetention: cdk.aws_logs.RetentionDays.ONE_WEEK,
      enablePerformanceInsights: false,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });
    this.runtimeSecret = new secretsmanager.Secret(this, "RuntimeCredential", {
      secretName: "tracepoint/staging/database/runtime",
      description: "Non-owner PostgreSQL login for the isolated full-AWS staging runtime",
      encryptionKey: dataKey,
      generateSecretString: {
        secretStringTemplate: this.toJsonString({
          host: this.database.dbInstanceEndpointAddress,
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

    new cdk.CfnOutput(this, "DatabaseEndpoint", { value: this.database.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, "DatabasePort", { value: this.database.dbInstanceEndpointPort });
    new cdk.CfnOutput(this, "MigratorSecretArn", { value: this.database.secret!.secretArn });
    new cdk.CfnOutput(this, "RuntimeSecretArn", { value: this.runtimeSecret.secretArn });
    new cdk.CfnOutput(this, "DatabaseSecurityGroupId", { value: this.securityGroup.securityGroupId });
    new cdk.CfnOutput(this, "ExpiresAfterUTC", { value: props.expiresAfterUtc });
  }
}
