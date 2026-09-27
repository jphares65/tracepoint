import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';

// This stack owns only a no-load-balancer ECS service. It cannot create a
// listener, target group, DNS record, public authority, or task role.
export class ProductionNativeAuthorityRehearsalStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    if (this.account !== '193644343389' || this.region !== 'us-east-1') {
      throw new Error('Exact production account and region required');
    }
    const desiredCount = new cdk.CfnParameter(this, 'DesiredCount', {
      type: 'Number', default: 0, minValue: 0, maxValue: 1,
      description: '0 when dormant, 1 for a time-bounded isolated boot rehearsal',
    });
    new ecs.CfnService(this, 'NoPublicRouteService', {
      cluster: 'tracepoint-production',
      serviceName: 'tracepoint-production-native-authority-rehearsal',
      taskDefinition: 'arn:aws:ecs:us-east-1:193644343389:task-definition/tracepoint-production-aws-native-no-traffic-proof:1',
      launchType: 'FARGATE',
      schedulingStrategy: 'REPLICA',
      desiredCount: desiredCount.valueAsNumber,
      enableExecuteCommand: false,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: ['subnet-0f4cbed3e60d90bfc'],
          securityGroups: ['sg-0ccc72ae99581cdfd'],
          assignPublicIp: 'ENABLED',
        },
      },
    });
  }
}
