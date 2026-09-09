import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import {Construct} from 'constructs';

export interface RehearsalProps extends cdk.StackProps {run:string;imageDigest:string;engineVersion:string;}
export class PostgresRehearsalStack extends cdk.Stack {
 constructor(scope:Construct,id:string,props:RehearsalProps){
  super(scope,id,props);
  if(this.account!=='559054714699'||this.region!=='us-east-1'||!/^[a-f0-9]{12}$/.test(props.run)||!/^sha256:[a-f0-9]{64}$/.test(props.imageDigest)||!/^18\.\d+$/.test(props.engineVersion))throw Error('Disposable staging PostgreSQL target rejected');
  const name='tp-rehearsal-'+props.run;
  cdk.Tags.of(this).add('RehearsalRun',props.run);cdk.Tags.of(this).add('Purpose','disposable-synthetic-only');
  cdk.Tags.of(this).add('created_by','rds-oss-skill');cdk.Tags.of(this).add('generation_model','GPT-6');
  // New, isolated resources only. Destruction is authorized solely for this run's
  // synthetic fixtures; no existing application/network/database is imported.
  const vpc=new ec2.Vpc(this,'Network',{maxAzs:2,natGateways:0,subnetConfiguration:[{name:'runner',subnetType:ec2.SubnetType.PUBLIC,cidrMask:27},{name:'database',subnetType:ec2.SubnetType.PRIVATE_ISOLATED,cidrMask:27}]});
  const runnerSg=new ec2.SecurityGroup(this,'RunnerSecurity',{vpc,allowAllOutbound:true});
  const databaseSg=new ec2.SecurityGroup(this,'DatabaseSecurity',{vpc,allowAllOutbound:false});databaseSg.addIngressRule(runnerSg,ec2.Port.tcp(5432));
  const key=new kms.Key(this,'RehearsalKey',{enableKeyRotation:true,pendingWindow:cdk.Duration.days(7),removalPolicy:cdk.RemovalPolicy.DESTROY});
  key.addToResourcePolicy(new iam.PolicyStatement({principals:[new iam.ServicePrincipal('logs.us-east-1.amazonaws.com')],actions:['kms:Encrypt','kms:Decrypt','kms:ReEncrypt*','kms:GenerateDataKey*','kms:DescribeKey'],resources:['*'],conditions:{ArnLike:{'kms:EncryptionContext:aws:logs:arn':`arn:aws:logs:us-east-1:${this.account}:log-group:/tracepoint/rehearsal/${props.run}*`}}}));
  // RDS PostgreSQL log names are prescribed by the service.
  key.addToResourcePolicy(new iam.PolicyStatement({principals:[new iam.ServicePrincipal('logs.us-east-1.amazonaws.com')],actions:['kms:Encrypt','kms:Decrypt','kms:ReEncrypt*','kms:GenerateDataKey*','kms:DescribeKey'],resources:['*'],conditions:{ArnEquals:{'kms:EncryptionContext:aws:logs:arn':`arn:aws:logs:us-east-1:${this.account}:log-group:/aws/rds/instance/${name}/postgresql`}}}));
  const dbLogs=new logs.LogGroup(this,'DatabaseLogs',{logGroupName:`/aws/rds/instance/${name}/postgresql`,encryptionKey:key,retention:logs.RetentionDays.ONE_WEEK,removalPolicy:cdk.RemovalPolicy.DESTROY});
  const subnet=new rds.CfnDBSubnetGroup(this,'DatabaseSubnets',{dbSubnetGroupDescription:'Private disposable rehearsal only',subnetIds:vpc.isolatedSubnets.map(s=>s.subnetId)});
  const parameters=new rds.CfnDBParameterGroup(this,'DatabaseParameters',{family:'postgres18',description:'TLS-only disposable rehearsal',parameters:{'rds.force_ssl':'1','log_statement':'none','log_min_error_statement':'panic'}});
  const database=new rds.CfnDBInstance(this,'Database',{dbInstanceIdentifier:name,engine:'postgres',engineVersion:props.engineVersion,dbInstanceClass:'db.t4g.micro',allocatedStorage:'20',storageType:'gp3',storageEncrypted:true,kmsKeyId:key.keyArn,publiclyAccessible:false,multiAz:false,dbName:'tracepoint_rehearsal',masterUsername:'tprehearsal',manageMasterUserPassword:true,masterUserSecret:{kmsKeyId:key.keyArn},dbSubnetGroupName:subnet.ref,vpcSecurityGroups:[databaseSg.securityGroupId],dbParameterGroupName:parameters.ref,backupRetentionPeriod:0,deletionProtection:false,deleteAutomatedBackups:true,enableCloudwatchLogsExports:['postgresql'],autoMinorVersionUpgrade:false,copyTagsToSnapshot:true});
  database.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);database.addResourceDependency(dbLogs.node.defaultChild as cdk.CfnResource);
  const cluster=new ecs.Cluster(this,'RunnerCluster',{vpc});
  const task=new ecs.FargateTaskDefinition(this,'RunnerTask',{cpu:256,memoryLimitMiB:1024,runtimePlatform:{cpuArchitecture:ecs.CpuArchitecture.X86_64,operatingSystemFamily:ecs.OperatingSystemFamily.LINUX}});
  const secret=secrets.Secret.fromSecretCompleteArn(this,'ManagedCredential',database.attrMasterUserSecretSecretArn);
  const output=new logs.LogGroup(this,'RunnerLogs',{logGroupName:`/tracepoint/rehearsal/${props.run}`,encryptionKey:key,retention:logs.RetentionDays.ONE_WEEK,removalPolicy:cdk.RemovalPolicy.DESTROY});
  const images=ecr.Repository.fromRepositoryName(this,'RunnerImages','tracepoint-staging');
  task.addContainer('rehearsal',{image:ecs.ContainerImage.fromEcrRepository(images,props.imageDigest),environment:{REHEARSAL_ACCOUNT:this.account,AWS_REGION:this.region,REHEARSAL_RUN:props.run,PGHOST:database.attrEndpointAddress,PGDATABASE:'tracepoint_rehearsal',REHEARSAL_PURPOSE:'disposable-synthetic-only'},secrets:{RDS_MANAGED_SECRET:ecs.Secret.fromSecretsManager(secret)},logging:ecs.LogDrivers.awsLogs({streamPrefix:'runner',logGroup:output}),user:'1000'});
  key.grantDecrypt(task.executionRole!);
  for(const [label,value]of Object.entries({Cluster:cluster.clusterName,TaskDefinition:task.taskDefinitionArn,RunnerSecurityGroup:runnerSg.securityGroupId,RunnerSubnet:vpc.publicSubnets[0].subnetId,DatabaseIdentifier:name,RunnerLogGroup:output.logGroupName}))new cdk.CfnOutput(this,label,{value});
 }
}
