import * as cdk from 'aws-cdk-lib';
import * as waf from 'aws-cdk-lib/aws-wafv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import {Construct} from 'constructs';
export interface RequestControlsProps extends cdk.StackProps {environment:'staging'|'production';expectedAccount:string;loadBalancerArn:string;mode:'logging'|'count'|'enforce';}
export class RequestControlsStack extends cdk.Stack {
 constructor(scope:Construct,id:string,props:RequestControlsProps){
  super(scope,id,props);
  if(!['staging','production'].includes(props.environment)||!['logging','count','enforce'].includes(props.mode)||!/^\d{12}$/.test(props.expectedAccount)||this.account!==props.expectedAccount||this.account==='265544358665'||this.region!=='us-east-1')throw Error('Request controls target rejected');
  if((props.environment==='staging')!==(this.account==='559054714699'))throw Error('Environment/account separation failed');
  if(!props.loadBalancerArn.startsWith(`arn:aws:elasticloadbalancing:${this.region}:${this.account}:loadbalancer/app/`))throw Error('Exact same-account ALB required');
  const name='tracepoint-'+props.environment+'-requests';
  const groupName='aws-waf-logs-'+name;
  const key=new kms.Key(this,'RequestLogKey',{enableKeyRotation:true,removalPolicy:cdk.RemovalPolicy.RETAIN});
  key.addToResourcePolicy(new iam.PolicyStatement({principals:[new iam.ServicePrincipal('logs.us-east-1.amazonaws.com')],actions:['kms:Encrypt','kms:Decrypt','kms:ReEncrypt*','kms:GenerateDataKey*','kms:DescribeKey'],resources:['*'],conditions:{ArnEquals:{'kms:EncryptionContext:aws:logs:arn':`arn:aws:logs:us-east-1:${this.account}:log-group:${groupName}`}}}));
  const group=new logs.LogGroup(this,'RequestLogs',{logGroupName:groupName,encryptionKey:key,retention:props.environment==='production'?logs.RetentionDays.THREE_MONTHS:logs.RetentionDays.ONE_WEEK,removalPolicy:cdk.RemovalPolicy.RETAIN});
  // WAF's CloudWatch delivery service uses the Logs source ARN, not the web ACL
  // ARN, in this condition. The destination itself is scoped to this log group.
  const policy=new logs.ResourcePolicy(this,'RequestLogDelivery',{resourcePolicyName:name+'-delivery',policyStatements:[new iam.PolicyStatement({principals:[new iam.ServicePrincipal('delivery.logs.amazonaws.com')],actions:['logs:CreateLogStream','logs:PutLogEvents'],resources:[group.logGroupArn],conditions:{StringEquals:{'aws:SourceAccount':this.account},ArnLike:{'aws:SourceArn':`arn:aws:logs:us-east-1:${this.account}:*`}}})]});
  const visibility=(metricName:string)=>({cloudWatchMetricsEnabled:true,metricName,sampledRequestsEnabled:false});
  const action=props.mode==='enforce'?{block:{customResponse:{responseCode:429,responseHeaders:[{name:'Retry-After',value:'60'}]}}}:{count:{}};
  const rule=(ruleName:string,priority:number,limit:number,window:number,scopeDownStatement?:waf.CfnWebACL.StatementProperty):waf.CfnWebACL.RuleProperty=>({name:ruleName,priority,action,statement:{rateBasedStatement:{aggregateKeyType:'IP',limit,evaluationWindowSec:window,scopeDownStatement}},visibilityConfig:visibility(ruleName)});
  const probe:waf.CfnWebACL.StatementProperty={andStatement:{statements:[{byteMatchStatement:{fieldToMatch:{uriPath:{}},positionalConstraint:'EXACTLY',searchString:'/api/health',textTransformations:[{priority:0,type:'LOWERCASE'}]}},{byteMatchStatement:{fieldToMatch:{singleQueryArgument:{Name:'tracepoint_rate_probe'}},positionalConstraint:'EXACTLY',searchString:'rehearsal',textTransformations:[{priority:0,type:'NONE'}]}}]}};
  const acl=new waf.CfnWebACL(this,'RequestAcl',{name,scope:'REGIONAL',defaultAction:{allow:{}},visibilityConfig:visibility(name),rules:props.mode==='logging'?[]:[rule('RequestFlood',0,1000,300),...(props.environment==='staging'?[rule('SyntheticRateProbe',1,10,60,probe)]:[])]});acl.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
  const configuration=new waf.CfnLoggingConfiguration(this,'RequestLogging',{resourceArn:acl.attrArn,logDestinationConfigs:[group.logGroupArn.replace(/:\*$/,'')],redactedFields:[{singleHeader:{Name:'authorization'}},{singleHeader:{Name:'cookie'}},{singleHeader:{Name:'referer'}},{singleHeader:{Name:'x-api-key'}},{queryString:{}},{uriPath:{}}]});configuration.node.addDependency(policy);
  const association=new waf.CfnWebACLAssociation(this,'AlbProtection',{resourceArn:props.loadBalancerArn,webAclArn:acl.attrArn});association.node.addDependency(configuration);
  new cloudwatch.Alarm(this,'FloodAlarm',{alarmName:'tracepoint-'+props.environment+'-request-flood',alarmDescription:'Sustained WAF rate-limit blocks; inspect redacted logs and verify application health.',metric:new cloudwatch.Metric({namespace:'AWS/WAFV2',metricName:'BlockedRequests',dimensionsMap:{WebACL:name,Rule:'RequestFlood',Region:this.region},statistic:'Sum',period:cdk.Duration.minutes(1)}),threshold:100,evaluationPeriods:2,treatMissingData:cloudwatch.TreatMissingData.NOT_BREACHING});
  new cdk.CfnOutput(this,'WebAclArn',{value:acl.attrArn});new cdk.CfnOutput(this,'WebAclId',{value:acl.attrId});new cdk.CfnOutput(this,'LogGroupName',{value:group.logGroupName});new cdk.CfnOutput(this,'Mode',{value:props.mode});
 }
}
