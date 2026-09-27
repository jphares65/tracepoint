# Cutover §2.1: complete public ALB ingress barrier

This supersedes the host-only 2026-09-26 procedure. It is **prepared but not active**. A read-only external probe proved `https://www.tracepointhq.com/api/health` and the same TLS origin with `Host: unmatched.tracepointhq.com` both returned HTTP 200 before maintenance. The old `www`-only rule could leave the default public forward reachable with a different Host header.

The CloudFormation template [maintenance.json](../infra/changesets/production-maintenance-response-20260927/maintenance.json) has SHA-256 `8CB9F3DE77D1099F6F254F7EC83D0B4970DA1A7C9217262681F9704B390A7BA8`. It adds exactly two fixed-503 rules to the pinned HTTPS listener: priority 5 for exact `www.tracepointhq.com`, and priority 20 with path `/*` for otherwise-unmatched hosts. The pre-existing shadow and rehearsal allow/deny rules at priorities 10–13 take precedence over priority 20. The listener default forward and public target group remain unchanged for health visibility. The maintenance stack owns only these two rules and is deleted to reverse them. This ALB barrier does **not** cover the separate legacy Vercel deployment or non-HTTP source writers.

Review-only change set, not executed:

- Stack: `arn:aws:cloudformation:us-east-1:193644343389:stack/tracepoint-production-maintenance-response-20260927/f41bc7e0-ba99-11f1-b90b-0e0ebc68fca1`
- Change set: `arn:aws:cloudformation:us-east-1:193644343389:changeSet/activate-complete-ingress-503-20260927/d1ae3fda-1505-4d28-b77c-16a55fb7c6ec`
- Expected diff: Add only `PublicAppMaintenanceResponse` and `UnmatchedHostMaintenanceResponse`, both `AWS::ElasticLoadBalancingV2::ListenerRule`.

Before activation, require a clean approved release, passing complete source-writer preflight and a current read-only `pending` check:

```powershell
Get-FileHash infra/changesets/production-maintenance-response-20260927/maintenance.json -Algorithm SHA256
node scripts/check-production-maintenance-ingress.mjs pending
```

The exact activation is:

```powershell
aws cloudformation execute-change-set --change-set-name arn:aws:cloudformation:us-east-1:193644343389:changeSet/activate-complete-ingress-503-20260927/d1ae3fda-1505-4d28-b77c-16a55fb7c6ec --stack-name tracepoint-production-maintenance-response-20260927 --profile tracepoint-production --region us-east-1
aws cloudformation wait stack-create-complete --stack-name arn:aws:cloudformation:us-east-1:193644343389:stack/tracepoint-production-maintenance-response-20260927/f41bc7e0-ba99-11f1-b90b-0e0ebc68fca1 --profile tracepoint-production --region us-east-1
node scripts/check-production-maintenance-ingress.mjs active
```

Require both external probes to return the exact 503 maintenance body, the original default forward to remain identical, and isolated rules 10–13 to remain present. Independently check public ECS target health. If any check fails, reverse immediately before touching the source.

Before reversal, `list-stack-resources` must show exactly the two named listener rules. The exact reversal is:

```powershell
aws cloudformation list-stack-resources --stack-name arn:aws:cloudformation:us-east-1:193644343389:stack/tracepoint-production-maintenance-response-20260927/f41bc7e0-ba99-11f1-b90b-0e0ebc68fca1 --profile tracepoint-production --region us-east-1 --output json
aws cloudformation delete-stack --stack-name arn:aws:cloudformation:us-east-1:193644343389:stack/tracepoint-production-maintenance-response-20260927/f41bc7e0-ba99-11f1-b90b-0e0ebc68fca1 --profile tracepoint-production --region us-east-1
aws cloudformation wait stack-delete-complete --stack-name arn:aws:cloudformation:us-east-1:193644343389:stack/tracepoint-production-maintenance-response-20260927/f41bc7e0-ba99-11f1-b90b-0e0ebc68fca1 --profile tracepoint-production --region us-east-1
node scripts/check-production-maintenance-ingress.mjs restored
```

The restored verifier requires both rules absent and both external requests no longer receiving the maintenance response. It does not itself unfence Supabase or resume Vercel; those are separate single-authority abort steps.
