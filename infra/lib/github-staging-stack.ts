import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import {Construct} from 'constructs';
export class GitHubStagingStack extends cdk.Stack {
 constructor(scope:Construct,id:string,props:cdk.StackProps){
  super(scope,id,props);if(this.account!=='559054714699'||this.region!=='us-east-1')throw Error('GitHub staging account/region rejected');
  const account=this.account,region=this.region;
  const provider=new iam.CfnOIDCProvider(this,'GitHubIssuer',{url:'https://token.actions.githubusercontent.com',clientIdList:['sts.amazonaws.com']});provider.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
  const role=new iam.Role(this,'StagingRelease',{roleName:'TracePointMigrationStagingGitHub',maxSessionDuration:cdk.Duration.hours(2),assumedBy:new iam.FederatedPrincipal(provider.ref,{StringEquals:{'token.actions.githubusercontent.com:aud':'sts.amazonaws.com','token.actions.githubusercontent.com:sub':'repo:jphares65/tracepoint:environment:aws-staging'}},'sts:AssumeRoleWithWebIdentity')});role.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
  const allow=(actions:string[],resources:string[],conditions?:Record<string,unknown>)=>role.addToPolicy(new iam.PolicyStatement({actions,resources,conditions}));
  const arn=(service:string,resource:string)=>`arn:aws:${service}:${region}:${account}:${resource}`;
  allow(['cloudformation:DescribeStacks','cloudformation:DescribeStackEvents','cloudformation:DescribeStackResources','cloudformation:GetTemplate','cloudformation:GetTemplateSummary'],[arn('cloudformation','stack/tracepoint-staging-*/*')]);
  allow(['cloudformation:CreateChangeSet','cloudformation:DescribeChangeSet','cloudformation:DeleteChangeSet','cloudformation:ExecuteChangeSet'],[arn('cloudformation','stack/tracepoint-staging-runtime/*'),arn('cloudformation','changeSet/cdk-deploy-change-set/*')]);
  allow(['cloudformation:ListExports','cloudformation:ValidateTemplate'],['*'],{StringEquals:{'aws:RequestedRegion':region}});
  allow(['iam:PassRole'],[`arn:aws:iam::${account}:role/cdk-hnb659fds-cfn-exec-role-${account}-${region}`],{StringEquals:{'iam:PassedToService':'cloudformation.amazonaws.com'}});
  allow(['ssm:GetParameter'],[arn('ssm','parameter/cdk-bootstrap/hnb659fds/version')]);
  allow(['s3:GetBucketLocation','s3:ListBucket','s3:GetBucketVersioning'],[`arn:aws:s3:::tracepoint-staging-build-source-${account}`,`arn:aws:s3:::cdk-hnb659fds-assets-${account}-${region}`]);
  allow(['s3:PutObject','s3:GetObject','s3:GetObjectVersion'],[`arn:aws:s3:::tracepoint-staging-build-source-${account}/source/tracepoint-staging-source.zip`,`arn:aws:s3:::cdk-hnb659fds-assets-${account}-${region}/*`]);
  allow(['codebuild:StartBuild'],[arn('codebuild','project/tracepoint-staging-image-build')]);
  allow(['codebuild:BatchGetBuilds'],[arn('codebuild','project/tracepoint-staging-image-build')]);
  allow(['budgets:ViewBudget'],[`arn:aws:budgets::${account}:budget/tracepoint-staging-monthly-75`]);
  allow(['ecr:DescribeImages','ecr:DescribeImageScanFindings','ecr:BatchGetImage','ecr:DescribeRepositories'],[arn('ecr','repository/tracepoint-staging')]);
  allow(['ecs:DescribeServices','ecs:UpdateService'],[arn('ecs','service/tracepoint-staging/tracepoint-staging')]);
  allow(['ecs:DescribeTasks'],[arn('ecs','task/tracepoint-staging/*')]);
  allow(['ecs:ListTasks'],['*'],{ArnEquals:{'ecs:cluster':arn('ecs','cluster/tracepoint-staging')}});
  allow(['ecs:DescribeTaskDefinition','elasticloadbalancing:DescribeTargetGroups','elasticloadbalancing:DescribeTargetHealth','elasticloadbalancing:DescribeLoadBalancers','cloudwatch:DescribeAlarms'],['*'],{StringEquals:{'aws:RequestedRegion':region}});
  allow(['acm:DescribeCertificate'],[arn('acm','certificate/90d7c1b4-3d71-4168-a908-8678501f5e5a')]);
  allow(['logs:DescribeLogStreams','logs:FilterLogEvents','logs:GetLogEvents'],[arn('logs','log-group:/tracepoint/staging/*'),arn('logs','log-group:/aws/codebuild/tracepoint-staging-image-build:*')]);
  allow(['secretsmanager:GetSecretValue','secretsmanager:DescribeSecret'],[arn('secretsmanager','secret:tracepoint/staging/application-p4ZFsw')]);
  allow(['kms:Decrypt'],[arn('kms','key/8a158690-ddbc-4887-8f61-0927dc279701')],{StringEquals:{'kms:ViaService':`secretsmanager.${region}.amazonaws.com`}});
  // Disposable acceptance cleanup is server-side and constrained to staging
  // prefixes. The browser never receives these AWS credentials or admin secret.
  allow(['s3:ListBucketVersions'],[`arn:aws:s3:::tracepoint-staging-private-${account}`],{StringLike:{'s3:prefix':['attachments/*','department-assets/*']}});
  allow(['s3:GetBucketPublicAccessBlock','s3:GetBucketVersioning','s3:GetEncryptionConfiguration'],[`arn:aws:s3:::tracepoint-staging-private-${account}`]);
  allow(['s3:GetObjectVersion','s3:DeleteObjectVersion'],[`arn:aws:s3:::tracepoint-staging-private-${account}/attachments/*`,`arn:aws:s3:::tracepoint-staging-private-${account}/department-assets/*`]);
  new cdk.CfnOutput(this,'DeployRoleArn',{value:role.roleArn});new cdk.CfnOutput(this,'IssuerArn',{value:provider.ref});
 }
}
