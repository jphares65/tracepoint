import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import {Template,Match} from 'aws-cdk-lib/assertions';
import {RequestControlsStack,RequestControlsProps} from '../lib/request-controls-stack';
const props:RequestControlsProps={env:{account:'559054714699',region:'us-east-1'},expectedAccount:'559054714699',environment:'staging',loadBalancerArn:'arn:aws:elasticloadbalancing:us-east-1:559054714699:loadbalancer/app/staging/abc',mode:'count'};
test('count first, private request logs, no raw sampling and exact ALB association',()=>{const t=Template.fromStack(new RequestControlsStack(new cdk.App(),'test',props));t.hasResourceProperties('AWS::WAFv2::WebACL',{Scope:'REGIONAL',VisibilityConfig:{SampledRequestsEnabled:false,CloudWatchMetricsEnabled:true,MetricName:'tracepoint-staging-requests'},Rules:Match.arrayWith([Match.objectLike({Action:{Count:{}},Statement:{RateBasedStatement:Match.objectLike({AggregateKeyType:'IP',Limit:1000,EvaluationWindowSec:300})}})])});t.hasResourceProperties('AWS::WAFv2::LoggingConfiguration',{RedactedFields:Match.arrayWith([{SingleHeader:{Name:'authorization'}},{SingleHeader:{Name:'cookie'}},{QueryString:{}},{UriPath:{}}])});t.hasResourceProperties('AWS::WAFv2::WebACLAssociation',{ResourceArn:props.loadBalancerArn});t.hasResourceProperties('AWS::Logs::LogGroup',{KmsKeyId:Match.anyValue(),RetentionInDays:7});});
test('enforcement returns 429, production omits the synthetic probe',()=>{const t=Template.fromStack(new RequestControlsStack(new cdk.App(),'prod',{...props,env:{account:'111111111111',region:'us-east-1'},expectedAccount:'111111111111',environment:'production',loadBalancerArn:props.loadBalancerArn.replace('559054714699','111111111111'),mode:'enforce'}));t.hasResourceProperties('AWS::WAFv2::WebACL',{Rules:Match.arrayWith([Match.objectLike({Action:{Block:{CustomResponse:{ResponseCode:429,ResponseHeaders:[{Name:'Retry-After',Value:'60'}]}}}})])});t.hasResourceProperties('AWS::Logs::LogGroup',{RetentionInDays:90});for(const override of [{expectedAccount:'265544358665'},{environment:'production' as const},{loadBalancerArn:props.loadBalancerArn.replace('559054714699','111111111111')}])assert.throws(()=>new RequestControlsStack(new cdk.App(),'bad',{...props,...override}));});

test('only exact approved uploads count the common body-size rule',()=>{
  const production={...props,env:{account:'111111111111',region:'us-east-1'},expectedAccount:'111111111111',environment:'production' as const,loadBalancerArn:props.loadBalancerArn.replaceAll('559054714699','111111111111'),mode:'enforce' as const};
  const resources=Template.fromStack(new RequestControlsStack(new cdk.App(),'shadow-scope',production)).findResources('AWS::WAFv2::WebACL');
  const acl=Object.values(resources)[0].Properties;
  const rules=acl.Rules as Array<Record<string,any>>;
  assert.deepEqual(rules.map(rule=>rule.Name),['RequestFlood','AwsCommonProtection','ShadowAmmunitionCommonProtection','AgencyPatchUploadCommonProtection','AwsKnownBadInputs','AwsIpReputation']);
  const shadow=rules[2].Statement.ManagedRuleGroupStatement;
  const patch=rules[3].Statement.ManagedRuleGroupStatement;
  assert.deepEqual(shadow.ScopeDownStatement.AndStatement.Statements.map((statement:any)=>[statement.ByteMatchStatement.FieldToMatch,statement.ByteMatchStatement.SearchString]),[
    [{SingleHeader:{Name:'host'}},'shadow.tracepointhq.com'],
    [{Method:{}},'PUT'],
    [{UriPath:{}},'/api/pilot/ammunition'],
  ]);
  assert.deepEqual(patch.ScopeDownStatement.AndStatement.Statements.map((statement:any)=>[statement.ByteMatchStatement.FieldToMatch,statement.ByteMatchStatement.SearchString]),[
    [{SingleHeader:{Name:'host'}},'tracepointhq.com'],
    [{Method:{}},'POST'],
    [{UriPath:{}},'/api/settings/department-patch'],
  ]);
  assert.deepEqual(rules[1].Statement.ManagedRuleGroupStatement.ScopeDownStatement.NotStatement.Statement,{OrStatement:{Statements:[shadow.ScopeDownStatement,patch.ScopeDownStatement]}});
  assert.deepEqual(shadow.RuleActionOverrides,[{Name:'SizeRestrictions_BODY',ActionToUse:{Count:{}}}]);
  assert.deepEqual(patch.RuleActionOverrides,[{Name:'SizeRestrictions_BODY',ActionToUse:{Count:{}}},{Name:'CrossSiteScripting_BODY',ActionToUse:{Count:{}}}]);
  assert.equal(rules[1].Statement.ManagedRuleGroupStatement.RuleActionOverrides,undefined);
  assert.deepEqual(rules[4].Statement.ManagedRuleGroupStatement,{VendorName:'AWS',Name:'AWSManagedRulesKnownBadInputsRuleSet'});
  assert.deepEqual(rules[5].Statement.ManagedRuleGroupStatement,{VendorName:'AWS',Name:'AWSManagedRulesAmazonIpReputationList'});
});
