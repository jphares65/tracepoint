# Cutover §2.1: public-app ALB maintenance response

This is a prepared procedure, **not an instruction to activate maintenance now**. It covers the production application at `https://www.tracepointhq.com/` only. The apex `tracepointhq.com` is a separate Vercel-hosted site (its `/login` returned 404 on 2026-09-26) and is not served by this ALB. No DNS, application image, source writer, or production data change is part of this procedure.

## Pinned baseline and review

- Account `193644343389`, region `us-east-1`, profile `tracepoint-production`.
- Managed runtime stack `tracepoint-production-runtime`; CloudFormation listener resource `ServiceLBPublicListener46709EAA` is `IN_SYNC`.
- HTTPS listener `arn:aws:elasticloadbalancing:us-east-1:193644343389:listener/app/tracep-Servi-HFH2HwVNXfys/95b1a0c4cb1f514d/068663ecd22df15a`.
- Its exact expanded live default forward action is captured in [baseline.json](../infra/changesets/production-maintenance-response-20260926/baseline.json). It targets `arn:aws:elasticloadbalancing:us-east-1:193644343389:targetgroup/tracep-Servi-HOJCXFWUTKCY/81b48286a38164ed`, weight 1, stickiness disabled. The runtime stack's original template expresses the same forward with `TargetGroupArn: {Ref: ServiceLBPublicListenerECSGroup0CC8688C}`. Neither is modified by this change.
- `www.tracepointhq.com` is a Route 53 A alias to the public ALB. The same listener also has isolated shadow/rehearsal rules at priorities 10–13. Priority 5 is currently unused.
- The public ECS service is 1/1 running, its target is healthy, and an external `/landing` request returns 200 before activation.

The versioned [maintenance.json](../infra/changesets/production-maintenance-response-20260926/maintenance.json) has SHA-256 `044EB4E334E1B5281F26FA135FD4B23F24350BAE09CFCAE8E15C27CE98BB6400`. It defines exactly one CloudFormation-managed `AWS::ElasticLoadBalancingV2::ListenerRule`: host header exactly `www.tracepointhq.com`, priority 5, fixed `503`, `text/plain`, and the short maintenance message. It does **not** replace the listener default action. The production target group therefore remains referenced by the default rule, preserving ALB health-check visibility. Shadow/rehearsal hosts do not match this rule. The rule has `DeletionPolicy: Delete`, so deletion of the one-resource maintenance stack restores the exact captured default forwarding without modifying it.

The review-only CloudFormation change set is `arn:aws:cloudformation:us-east-1:193644343389:changeSet/activate-www-503-20260926/1330c60b-9066-41fa-a923-0a533a2ea7a6` in stack `arn:aws:cloudformation:us-east-1:193644343389:stack/tracepoint-production-maintenance-response-20260926/863d2100-ba27-11f1-aed4-0affffd37699`. Its reviewed diff is exactly **Add `PublicAppMaintenanceResponse` (`AWS::ElasticLoadBalancingV2::ListenerRule`)**. Status is `CREATE_COMPLETE`, execution `AVAILABLE`; the stack is `REVIEW_IN_PROGRESS` with zero resources. The change set has **not** been executed. IAM simulation permits the operator's `ExecuteChangeSet` and `DeleteStack`, and the CloudFormation execution role's exact `CreateRule` and same-listener `DeleteRule`. The template passed `validate-template`; focused tests passed.

## Maintenance-window activation — do not run before §2.1 authorization

Use PowerShell from the repository root. Stop if any preflight differs; do not use a stale change set or choose a different listener/host/priority ad hoc.

```powershell
git status --short
Get-FileHash infra/changesets/production-maintenance-response-20260926/maintenance.json -Algorithm SHA256
node scripts/check-production-maintenance-response.mjs baseline
aws cloudformation describe-change-set --change-set-name arn:aws:cloudformation:us-east-1:193644343389:changeSet/activate-www-503-20260926/1330c60b-9066-41fa-a923-0a533a2ea7a6 --stack-name tracepoint-production-maintenance-response-20260926 --profile tracepoint-production --region us-east-1 --query "{Status:Status,ExecutionStatus:ExecutionStatus,Changes:Changes[].ResourceChange.{Action:Action,LogicalResourceId:LogicalResourceId,ResourceType:ResourceType}}" --output json
```

Require the file hash above, a clean approved release state, healthy baseline, and exactly one `Add PublicAppMaintenanceResponse` change. Record operator, start time, and change-set ARN. Then the **exact activation command** is:

```powershell
aws cloudformation execute-change-set --change-set-name arn:aws:cloudformation:us-east-1:193644343389:changeSet/activate-www-503-20260926/1330c60b-9066-41fa-a923-0a533a2ea7a6 --stack-name tracepoint-production-maintenance-response-20260926 --profile tracepoint-production --region us-east-1
aws cloudformation wait stack-create-complete --stack-name arn:aws:cloudformation:us-east-1:193644343389:stack/tracepoint-production-maintenance-response-20260926/863d2100-ba27-11f1-aed4-0affffd37699 --profile tracepoint-production --region us-east-1
node scripts/check-production-maintenance-response.mjs active
```

The active verifier checks the exact default forward action still exists, priority-5 host-only rule is present, shadow/rehearsal rules 10–13 remain, public ECS is 1/1, target health is `healthy`, and a cache-busted external HTTPS GET to `/landing` returns exactly `503` and the reviewed message. A matching ALB fixed-response rule generates the response at the ALB, without forwarding matched requests to the application. ALB access logs are enabled in `s3://tracepoint-production-alb-access-193644343389/alb/`; if log arrival permits, corroborate the unique probe path with `actions_executed=fixed-response`, no target address and no target status code. Do not delay an emergency reversal waiting for access-log delivery. The app's `/api/health` behind this host also receives 503 for normal clients; use `describe-target-health` and ECS service health for independent target visibility.

If stack creation or the active verifier fails, stop §2.1 and perform the reversal below immediately. Do not freeze source writes.

## Exact reversal / abort operation

Before deletion, inspect the maintenance stack: it must be the exact pinned stack ID above and contain only `PublicAppMaintenanceResponse` of type `AWS::ElasticLoadBalancingV2::ListenerRule` on the pinned listener. If it has acquired any other resource, stop and review rather than deleting it. The **exact reversal operation** is:

```powershell
aws cloudformation list-stack-resources --stack-name arn:aws:cloudformation:us-east-1:193644343389:stack/tracepoint-production-maintenance-response-20260926/863d2100-ba27-11f1-aed4-0affffd37699 --profile tracepoint-production --region us-east-1 --output json
aws cloudformation delete-stack --stack-name arn:aws:cloudformation:us-east-1:193644343389:stack/tracepoint-production-maintenance-response-20260926/863d2100-ba27-11f1-aed4-0affffd37699 --profile tracepoint-production --region us-east-1
aws cloudformation wait stack-delete-complete --stack-name arn:aws:cloudformation:us-east-1:193644343389:stack/tracepoint-production-maintenance-response-20260926/863d2100-ba27-11f1-aed4-0affffd37699 --profile tracepoint-production --region us-east-1
node scripts/check-production-maintenance-response.mjs restored
```

The restored verifier requires priority 5 absent, exact original listener default action, healthy target, public ECS 1/1, and an external public HTTPS response in the 2xx/3xx range without the maintenance body. This restores normal ALB forwarding, but **does not** unfreeze source writers; writer restoration remains governed by the separate single-authority abort/cutover runbook. If deletion fails, keep the source in the known single-writer state and escalate; do not use unmanaged `modify-listener` or manually delete unrelated rules.
