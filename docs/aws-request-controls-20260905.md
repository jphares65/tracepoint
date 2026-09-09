# Staging request controls

The separate regional WAF stack is restricted to the existing staging ALB. Its phases are logging, Count, then enforcing HTTP 429 with Retry-After. A global IP rule uses 1,000 requests per five minutes; a staging-only health-query probe uses 10 per minute to validate threshold behavior without blocking normal application routes. This is volumetric throttling, not an authentication brute-force/MFA replacement or a production capacity proof.

The deployment script requires live redacted-log proof before Count and recent Count-mode proof before enforcement. Existing-resource updates permit only WAF rule changes. It cannot replace another ACL or modify runtime/network/data resources. The production construct omits the diagnostic rule, validates account/ALB separation and retains logs for 90 days.

Cookie, Authorization, Referer, API-key, query-string and URI fields are redacted in encrypted retained CloudWatch logs. Request sampling is disabled because log redaction does not protect raw console samples. Verification reads records in memory and emits aggregate evidence only. The CloudWatch delivery resource policy scopes the destination and source account, using the Logs service source-ARN format required by delivery.

At [AWS WAF published pricing](https://aws.amazon.com/waf/pricing/), one ACL is $5/month, two rules are $2/month, and requests are $0.60/million. Reserve $10/month for these controls including their KMS key, alarm, low-volume requests and logs. Combined with the $57.17 existing model and a separate $2 disposable RDS rehearsal reserve, the conservative total is $69.17. This is a usage model, not a billing cap. Recheck actual usage and the model before activation.

Commands, in order, after each preceding proof passes:

```powershell
./scripts/deploy-staging-request-controls.ps1 -Mode logging
node scripts/test-staging-request-controls.mjs --execute --mode logging
./scripts/deploy-staging-request-controls.ps1 -Mode count
node scripts/test-staging-request-controls.mjs --execute --mode count
./scripts/deploy-staging-request-controls.ps1 -Mode enforce
node scripts/test-staging-request-controls.mjs --execute --mode enforce
```

No live WAF capability is credited until association, logging, Count, blocking, normal-route preservation and recovery have been observed. Human alarm delivery and production tuning remain separate gates. Operators can inspect the [regional ACL console](https://us-east-1.console.aws.amazon.com/wafv2/homev2/web-acls?region=us-east-1); automated evidence is collected by the commands above.

## Live enforcement

Logging, count and enforce gates passed on September 5. Count mode allowed all 120 probes while observing 65 threshold matches and zero global-rule matches. Enforcement returned 429 with Retry-After 60 after 29 allowed probes, then recovered in 90,483 ms. Redacted log delivery was verified. Normal health, login and protected routes remained healthy. The complete disposable authenticated acceptance suite and runtime evidence collector passed behind enforcement; runtime remains revision 16 on the accepted 5a511ed image. No production capacity claim is made from this bounded staging test.
