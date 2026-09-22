import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface SupabaseRestInitialImportStackProps extends cdk.StackProps {
  runId: string; authorizationReference: string; databaseCommit: string; objectCommit: string; databaseImageDigest: string; objectImageDigest: string;
  repositoryName: string; clusterName: string; vpcId: string; publicSubnetIds: string[];
  databaseSecurityGroupId: string; sourceSecretArn: string; targetSecretArn: string; targetHost: string;
}

export class SupabaseRestInitialImportStack extends cdk.Stack {
  readonly databaseTaskDefinition: ecs.CfnTaskDefinition;
  readonly objectTaskDefinition: ecs.CfnTaskDefinition;
  readonly databaseRunnerSecurityGroup: ec2.SecurityGroup;
  readonly objectRunnerSecurityGroup: ec2.SecurityGroup;
  constructor(scope: Construct, id: string, props: SupabaseRestInitialImportStackProps) {
    super(scope, id, props);
    const account='193644343389', runSuffix='4272874f', region='us-east-1';
    const sourceSecretArn=`arn:aws:secretsmanager:${region}:${account}:secret:tracepoint/production/migration/source-supabase-rest-wvh4pi`;
    const targetSecretArn=`arn:aws:secretsmanager:${region}:${account}:secret:tracepoint/production/database/migrator-8X57JT`;
    const originalRdsHost='tracepoint-production.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
    const cleanRdsHost='tracepoint-production-migration-clean-4272874f.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
    const auditFirstCleanRdsHost='tracepoint-production-migration-clean-4272874f-auditfirst.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
    const bucket='tracepoint-production-private-193644343389';
    const artifactKey=`migration/source/${props.runId}/initial-canonical.json`;
    const artifactSha256='8b01ea2a57a650b10d126160c5d171fecf1e98f1e07a9fa720e97e600d8d6d57';
    const keyArn=`arn:aws:kms:${region}:${account}:key/4dc71990-3cfa-49d7-88c6-383bc1067f55`;
    if(this.account!==account||this.region!==region||props.runId!=='4272874f-bae4-49f4-a0b4-67a39cec2874'||props.authorizationReference!=='TP-FINAL-DB-20260920-4272874FBAE4') throw new Error('Exact approved production migration context is required');
    if(!/^[0-9a-f]{40}$/.test(props.databaseCommit)||!/^[0-9a-f]{40}$/.test(props.objectCommit)||!/^sha256:[0-9a-f]{64}$/.test(props.databaseImageDigest)||!/^sha256:[0-9a-f]{64}$/.test(props.objectImageDigest)||props.repositoryName!=='tracepoint-production'||props.clusterName!=='tracepoint-production') throw new Error('Exact immutable migration image context is required');
    if(props.vpcId!=='vpc-04accb4047a914176'||props.publicSubnetIds.length!==2||new Set(props.publicSubnetIds).size!==2||!props.publicSubnetIds.every(value=>['subnet-0f4cbed3e60d90bfc','subnet-0a117bec5cb98607f'].includes(value))||props.databaseSecurityGroupId!=='sg-096e4787eae992cf4'||props.sourceSecretArn!==sourceSecretArn||props.targetSecretArn!==targetSecretArn||![originalRdsHost,cleanRdsHost,auditFirstCleanRdsHost].includes(props.targetHost)) throw new Error('Only reviewed migration network, source, and target are permitted');
    cdk.Tags.of(this).add('Purpose','isolated-rest-initial-import'); cdk.Tags.of(this).add('MigrationRun',props.runId); cdk.Tags.of(this).add('AuthorizationReference',props.authorizationReference);
    const vpc=ec2.Vpc.fromVpcAttributes(this,'Vpc',{vpcId:props.vpcId,availabilityZones:['us-east-1a','us-east-1b'],publicSubnetIds:props.publicSubnetIds});
    const cluster=ecs.Cluster.fromClusterAttributes(this,'Cluster',{clusterName:props.clusterName,vpc});
    const repository=ecr.Repository.fromRepositoryName(this,'Repository',props.repositoryName);
    const boundary=iam.ManagedPolicy.fromManagedPolicyArn(this,'ProductionPermissionsBoundary',`arn:aws:iam::${account}:policy/TracePointProductionBoundary`);
    const principal=new iam.ServicePrincipal('ecs-tasks.amazonaws.com',{conditions:{StringEquals:{'aws:SourceAccount':account},ArnLike:{'aws:SourceArn':`arn:${this.partition}:ecs:${region}:${account}:*`}}});
    const makeExecutionRole=(idValue:string,name:string,secretArns:string[],logArn:string,needsTargetSecretDecrypt:boolean)=>{
      const role=new iam.Role(this,idValue,{roleName:name,assumedBy:principal,description:'Temporary isolated TracePoint REST initial migration ECS execution role'}); iam.PermissionsBoundary.of(role).apply(boundary);
      role.addToPolicy(new iam.PolicyStatement({sid:'ReadOnlyReviewedMigrationSecrets',actions:['secretsmanager:GetSecretValue'],resources:secretArns}));
      if(needsTargetSecretDecrypt) role.addToPolicy(new iam.PolicyStatement({sid:'DecryptOnlyReviewedTargetSecret',actions:['kms:Decrypt'],resources:[keyArn],conditions:{StringEquals:{'kms:ViaService':`secretsmanager.${region}.amazonaws.com`}}}));
      role.addToPolicy(new iam.PolicyStatement({sid:'PullReviewedMigrationImage',actions:['ecr:BatchCheckLayerAvailability','ecr:BatchGetImage','ecr:GetDownloadUrlForLayer'],resources:[repository.repositoryArn]}));
      role.addToPolicy(new iam.PolicyStatement({sid:'EcrAuthenticationOnly',actions:['ecr:GetAuthorizationToken'],resources:['*']}));
      role.addToPolicy(new iam.PolicyStatement({sid:'WriteSanitizedMigrationEvidence',actions:['logs:CreateLogStream','logs:PutLogEvents'],resources:[logArn]})); return role;
    };
    const dbLogs=new logs.LogGroup(this,'DatabaseLogs',{logGroupName:`/tracepoint/production/rest-rds-import/${props.runId}`,retention:logs.RetentionDays.ONE_MONTH,removalPolicy:cdk.RemovalPolicy.RETAIN});
    const objectLogs=new logs.LogGroup(this,'ObjectLogs',{logGroupName:`/tracepoint/production/rest-object-copy/${props.runId}`,retention:logs.RetentionDays.ONE_MONTH,removalPolicy:cdk.RemovalPolicy.RETAIN});
    // Preserve the deployed policy's resource-array order so a diagnostic image
    // revision cannot cause a no-op IAM policy update.
    const dbRole=makeExecutionRole('DatabaseExecutionRole',`TracePoint-RestRdsImportExec-${runSuffix}`,[targetSecretArn],dbLogs.logGroupArn,true);
    const objectExecRole=makeExecutionRole('ObjectExecutionRole',`TracePoint-RestObjectCopyExec-${runSuffix}`,[sourceSecretArn],objectLogs.logGroupArn,false);
    const databaseRole=new iam.Role(this,'DatabaseTaskRole',{roleName:`TracePoint-RestRdsImportTask-${runSuffix}`,assumedBy:principal,description:'Temporary task role restricted to the adopted immutable source artifact'}); iam.PermissionsBoundary.of(databaseRole).apply(boundary);
    databaseRole.addToPolicy(new iam.PolicyStatement({sid:'ReadOnlyAdoptedSourceArtifact',actions:['s3:GetObject','s3:GetObjectVersion'],resources:[`arn:aws:s3:::${bucket}/${artifactKey}`]}));
    databaseRole.addToPolicy(new iam.PolicyStatement({sid:'DecryptOnlyAdoptedSourceArtifact',actions:['kms:Decrypt'],resources:[keyArn],conditions:{StringEquals:{'kms:ViaService':`s3.${region}.amazonaws.com`}}}));
    const objectRole=new iam.Role(this,'ObjectTaskRole',{roleName:`TracePoint-RestObjectCopyTask-${runSuffix}`,assumedBy:principal,description:'Temporary task role restricted to the two reviewed object keys'}); iam.PermissionsBoundary.of(objectRole).apply(boundary);
    const objectKeys=['department-assets/1d0e2994-4224-4237-8328-71020ba20027/patch-1787431778595.jpg','department-assets/d01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0/patch-1782439034425.png'];
    objectRole.addToPolicy(new iam.PolicyStatement({sid:'ReadAndCreateOnlyReviewedObjects',actions:['s3:GetObject','s3:PutObject'],resources:objectKeys.map(key=>`arn:aws:s3:::${bucket}/${key}`)}));
    objectRole.addToPolicy(new iam.PolicyStatement({sid:'UseBucketKeyForReviewedObjects',actions:['kms:Decrypt','kms:GenerateDataKey'],resources:[keyArn],conditions:{StringEquals:{'kms:ViaService':`s3.${region}.amazonaws.com`}}}));
    const databaseSecurityGroup=ec2.SecurityGroup.fromSecurityGroupId(this,'DatabaseSecurityGroup',props.databaseSecurityGroupId,{mutable:true});
    this.databaseRunnerSecurityGroup=new ec2.SecurityGroup(this,'DatabaseRunnerSecurityGroup',{vpc,allowAllOutbound:false,description:'Temporary REST-to-RDS importer; TLS only, no inbound traffic'});
    this.databaseRunnerSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(),ec2.Port.tcp(443),'TLS source REST and AWS control plane'); this.databaseRunnerSecurityGroup.addEgressRule(databaseSecurityGroup,ec2.Port.tcp(5432),'TLS only to reviewed RDS security group'); databaseSecurityGroup.addIngressRule(this.databaseRunnerSecurityGroup,ec2.Port.tcp(5432),'Temporary approved REST initial import');
    this.objectRunnerSecurityGroup=new ec2.SecurityGroup(this,'ObjectRunnerSecurityGroup',{vpc,allowAllOutbound:false,description:'Temporary create-only object copier; HTTPS only and no inbound traffic'}); this.objectRunnerSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(),ec2.Port.tcp(443),'TLS source storage and S3 only');
    const common=(logGroup:logs.LogGroup, importMode:'database'|'objects', roleArn:string, secrets:{name:string,valueFrom:string}[], taskRoleArn?:string):ecs.CfnTaskDefinitionProps=>{
      const database=importMode==='database', imageDigest=database?props.databaseImageDigest:props.objectImageDigest, commit=database?props.databaseCommit:props.objectCommit;
      const environment=database?[{name:'TRACEPOINT_MIGRATION_RUN_ID',value:props.runId},{name:'TRACEPOINT_MIGRATION_AUTHORIZATION_REFERENCE',value:props.authorizationReference},{name:'TRACEPOINT_EXPECTED_AWS_ACCOUNT',value:account},{name:'TRACEPOINT_REST_IMPORT_MODE',value:importMode},{name:'TRACEPOINT_SOURCE_COMMIT',value:commit},{name:'TRACEPOINT_SOURCE_MODE',value:'immutable-artifact'},{name:'TRACEPOINT_SOURCE_ARTIFACT_BUCKET',value:bucket},{name:'TRACEPOINT_SOURCE_ARTIFACT_KEY',value:artifactKey},{name:'TRACEPOINT_SOURCE_ARTIFACT_SHA256',value:artifactSha256},{name:'TARGET_DATABASE_SECRET_ARN',value:targetSecretArn},{name:'TARGET_PGHOST',value:props.targetHost},{name:'TARGET_PGDATABASE',value:'tracepoint'}]:[{name:'TRACEPOINT_MIGRATION_RUN_ID',value:props.runId},{name:'TRACEPOINT_MIGRATION_AUTHORIZATION_REFERENCE',value:props.authorizationReference},{name:'TRACEPOINT_EXPECTED_AWS_ACCOUNT',value:account},{name:'SOURCE_SUPABASE_REST_SECRET_ARN',value:sourceSecretArn},{name:'TRACEPOINT_REST_IMPORT_MODE',value:importMode},{name:'TRACEPOINT_SOURCE_COMMIT',value:commit},{name:'TRACEPOINT_TARGET_BUCKET',value:bucket}];
      return {family:`tracepoint-production-rest-${importMode}-initial-import-${runSuffix}`,requiresCompatibilities:['FARGATE'],networkMode:'awsvpc',cpu:'512',memory:'1024',executionRoleArn:roleArn,...(taskRoleArn?{taskRoleArn}:{}),containerDefinitions:[{name:database?'rest-rds-import':'rest-object-copy',image:`${repository.repositoryUri}@${imageDigest}`,essential:true,readonlyRootFilesystem:true,user:'node',logConfiguration:{logDriver:'awslogs',options:{'awslogs-group':logGroup.logGroupName,'awslogs-region':region,'awslogs-stream-prefix':importMode}},environment,secrets}]};
    };
    this.databaseTaskDefinition=new ecs.CfnTaskDefinition(this,'DatabaseTaskDefinition',common(dbLogs,'database',dbRole.roleArn,[{name:'TARGET_DATABASE_SECRET_JSON',valueFrom:targetSecretArn}],databaseRole.roleArn));
    this.objectTaskDefinition=new ecs.CfnTaskDefinition(this,'ObjectTaskDefinition',common(objectLogs,'objects',objectExecRole.roleArn,[{name:'SOURCE_SUPABASE_REST_SECRET_JSON',valueFrom:sourceSecretArn}],objectRole.roleArn));
    for(const resource of [dbRole.node.defaultChild,objectExecRole.node.defaultChild,databaseRole.node.defaultChild,objectRole.node.defaultChild,this.databaseRunnerSecurityGroup.node.defaultChild,this.objectRunnerSecurityGroup.node.defaultChild,this.databaseTaskDefinition,this.objectTaskDefinition,dbLogs.node.defaultChild,objectLogs.node.defaultChild]) (resource as cdk.CfnResource).addMetadata('com.aws.cloudformation.Context',{why:'isolated initial migration lane',must:['exact run and authorization only','no runtime authority switch','no Cognito client'],mutable:'review-required'});
    new cdk.CfnOutput(this,'ClusterName',{value:cluster.clusterName,description:'Existing cluster for one-shot tasks'}); new cdk.CfnOutput(this,'DatabaseTaskDefinitionArn',{value:this.databaseTaskDefinition.ref,description:'Approved REST-to-RDS initial importer'}); new cdk.CfnOutput(this,'ObjectTaskDefinitionArn',{value:this.objectTaskDefinition.ref,description:'Approved create-only object copier'}); new cdk.CfnOutput(this,'DatabaseRunnerSecurityGroupId',{value:this.databaseRunnerSecurityGroup.securityGroupId}); new cdk.CfnOutput(this,'ObjectRunnerSecurityGroupId',{value:this.objectRunnerSecurityGroup.securityGroupId});
  }
}
