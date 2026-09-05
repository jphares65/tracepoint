# Staging alarm delivery

A separate CDK stack adds a composite alarm over the four existing runtime alarms, an encrypted SNS topic, a durable encrypted receipt queue and a dead-letter queue. It does not modify the existing runtime alarms or ECS resources. Both incident and recovery transitions publish. KMS and SNS permissions restrict CloudWatch to this account and exact composite alarm ARN; SQS accepts messages only from the topic and requires TLS. Stateful resources are retained and stack termination protection is enabled.

Two infrastructure tests cover encryption, retention, topic delivery, no automatic human recipient and account/region rejection. Strict synthesis and a live diff showed additions only. The monthly model reserves $2 for the additional key, composite alarm and low-volume messaging, increasing the modeled total from $55.17 to $57.17 under the $75 ceiling. [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/) lists $0.50 per composite alarm; [SNS key policy guidance](https://docs.aws.amazon.com/sns/latest/dg/sns-key-management.html) describes the CloudWatch service grant and source restrictions.

From `infra`, after the repository's exact staging identity gate:

```powershell
npx.cmd cdk diff --app 'npx ts-node --prefer-ts-exts bin/staging-alert-delivery.ts' -c account=559054714699 -c region=us-east-1 --lookups=false --strict --no-change-set
npx.cmd cdk deploy --app 'npx ts-node --prefer-ts-exts bin/staging-alert-delivery.ts' -c account=559054714699 -c region=us-east-1 --lookups=false --strict --require-approval never
```

The topic is prepared for an approved human destination. Jason must subscribe and confirm his chosen operational email endpoint, then verify receipt and name the backup responder before production cutover. No human endpoint is selected or messaged by this stack. Queue delivery alone does not establish human escalation or earn the notification-escalation completion check.
