import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

export const productionComponentsCents={
  alb_public_ipv4_and_low_lcu:2431,
  two_fargate_tasks_and_public_ipv4:2532,
  four_kms_keys_and_one_secret:440,
  cloudwatch_and_s3_logs_allowance:500,
  codebuild_600_minutes_allowance:300,
  seven_metric_and_one_composite_alarm:120,
  encrypted_sns_sqs_alert_delivery_allowance:100,
  waf_acl_rule_and_low_requests_allowance:1000,
  ecs_container_insights_allowance:1000,
  data_transfer_allowance:500,
  account_security_services_allowance:1000,
};

export function calculateProductionCostModel(components=productionComponentsCents){
  for(const [name,value] of Object.entries(components))assert.ok(Number.isInteger(value)&&value>=0,`Invalid cents for ${name}`);
  const baselineCents=Object.values(components).reduce((sum,value)=>sum+value,0);
  const fourTaskBurstIncrementCents=2532;
  return {baselineCents,fourTaskBurstIncrementCents,fourTaskBurstCents:baselineCents+fourTaskBurstIncrementCents};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify({componentsCents:productionComponentsCents,...calculateProductionCostModel()},null,2));

