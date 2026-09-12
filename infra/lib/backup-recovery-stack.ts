import * as cdk from "aws-cdk-lib";
import * as backup from "aws-cdk-lib/aws-backup";
import * as kms from "aws-cdk-lib/aws-kms";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

export interface BackupRecoveryStackProps extends cdk.StackProps {
  environmentName: "staging" | "production";
}

export class BackupRecoveryStack extends cdk.Stack {
  readonly vault: backup.BackupVault;
  constructor(scope: Construct, id: string, props: BackupRecoveryStackProps) {
    super(scope, id, props);
    if (this.region !== "us-east-1" || this.account === "265544358665" ||
        (props.environmentName === "staging" && this.account !== "559054714699") ||
        (props.environmentName === "production" && this.account === "559054714699")) {
      throw new Error("Backup target rejected");
    }
    const key = new kms.Key(this, "BackupKey", {
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    this.vault = new backup.BackupVault(this, "Vault", {
      backupVaultName: `tracepoint-${props.environmentName}`,
      encryptionKey: key,
      // Omitting changeableFor selects governance mode: retention is enforced
      // but an authorized operator can still alter/remove the lock. Compliance
      // mode is intentionally deferred until production restore evidence exists.
      lockConfiguration: props.environmentName === "production" ? {
        minRetention: cdk.Duration.days(35),
        maxRetention: cdk.Duration.days(365),
      } : undefined,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const plan = new backup.BackupPlan(this, "Plan", {
      backupPlanName: `tracepoint-${props.environmentName}`,
      backupVault: this.vault,
      backupPlanRules: [
        new backup.BackupPlanRule({
          ruleName: "daily",
          scheduleExpression: cdk.aws_events.Schedule.cron({ minute: "15", hour: "6" }),
          deleteAfter: cdk.Duration.days(props.environmentName === "production" ? 35 : 7),
          startWindow: cdk.Duration.hours(1),
          completionWindow: cdk.Duration.hours(4),
        }),
        ...(props.environmentName === "production" ? [new backup.BackupPlanRule({
          ruleName: "monthly",
          scheduleExpression: cdk.aws_events.Schedule.cron({ minute: "45", hour: "6", day: "1" }),
          deleteAfter: cdk.Duration.days(365),
          startWindow: cdk.Duration.hours(1),
          completionWindow: cdk.Duration.hours(8),
        })] : []),
      ],
    });
    const selection=plan.addSelection("TaggedResources", {
      resources: [backup.BackupResource.fromTag("Backup", "daily", backup.TagOperation.STRING_EQUALS)],
      allowRestores: true,
    });
    NagSuppressions.addResourceSuppressions(selection,[{
      id:"AwsSolutions-IAM4",
      reason:"AWS Backup's service-managed backup and restore policies are the AWS-defined permissions for the tag-selected RDS and S3 resources.",
      appliesTo:[
        "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup",
        "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores",
      ],
    }],true);
    new cdk.CfnOutput(this, "BackupVaultName", { value: this.vault.backupVaultName });
  }
}
