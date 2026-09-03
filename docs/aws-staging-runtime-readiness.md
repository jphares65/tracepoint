# AWS staging runtime readiness

Target: account `559054714699`, region `us-east-1`, hostname
`staging.tracepointhq.com`. Every AWS-aware helper begins with an STS account,
role, and region gate and refuses management account `265544358665`.

## Required human inputs

- Staging values named `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_SITE_URL` in the
  retained Secrets Manager JSON object. The site URL must be exactly
  `https://staging.tracepointhq.com`.
- Runtime values named `SUPABASE_SECRET_KEY`, `BREVO_API_KEY`,
  `NOTIFICATION_DISPATCH_SECRET`, and
  `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`. The Server Actions value must be base64
  for a 16-, 24-, or 32-byte AES key and must be identical at build and runtime.
- `CONFIGURATION_ENVIRONMENT`, entered as the exact value `staging` through the
  same concealed-input flow.
- Runtime provider controls are fixed to `supabase`, `brevo`, and `supabase` for
  data, email, and storage. The container validates these controls and all four
  required secret names before starting Next.js. Errors list names only.
- An issued `us-east-1` ACM certificate for `staging.tracepointhq.com`, followed
  by a platform-owner DNS alias. No helper requests a certificate or changes DNS.
- Permission for the staging deployment role to read KMS rotation status if that
  verification is to become conclusive.

## Verified 2026-09-03 inventory

The `tracepoint-staging-image-build` stack is `CREATE_COMPLETE` with termination
protection enabled. Its CodeBuild project uses `BUILD_GENERAL1_SMALL`, privileged
Docker, no output artifacts, a 30-minute build timeout, and the tracked-source S3
object. The source bucket is versioned, blocks all public access, uses the
stack-specific KMS key, and expires current/noncurrent archives after seven days.
Build logs use the same key and a 30-day retention period.

The ECR repository is KMS-encrypted and immutable, has scan-on-push enabled, and
expires images beyond the newest 30. It currently has no images. The application
secret currently contains only its CDK bootstrap fields (`initialized` and
`bootstrapNonce`); all five build-time names and three runtime-only names remain
unset. Values were neither displayed nor copied. Local `.env.local` has some
similarly named values but its site URL is not the approved staging URL, so those
values were deliberately not promoted to staging.

## Operator sequence

1. Run `test-tracepoint-staging-acm-dns.ps1` with the explicit staging hostname.
2. Review and invoke `set-tracepoint-staging-secret.ps1`; it collects all eight
   fields as concealed input, replaces the complete JSON value atomically without
   a local secret file, prints no value, and rejects production-looking values.
3. Run `publish-tracepoint-staging-image.ps1`. It permits only the protected
   untracked demo files, archives an explicit tracked build-source allowlist,
   rejects secret/environment/credential/dump/generated paths, and starts the
   deployed CodeBuild project with the full commit SHA as its immutable tag.
4. Run `scripts/deploy-tracepoint-staging.ps1` in its default `Verify` mode, then
   invoke it with `-Action DeployRuntime -ImageTag <full-commit-sha>
   -CertificateArn <approved-arn>` only after review. It consumes the immutable
   ECR image and repeats STS, role, region, cost, secret, production, diff,
   replacement, and deletion gates. It never builds or publishes an image.
5. Run `test-tracepoint-staging-runtime.ps1`, then the smoke script. Without a
   session cookie, protected reads must return 401/403; with one, they must return
   200 for the same authorized staging tenant.
6. Keep rollback dry-run-only until a reviewed orchestration change can accept an
   explicit prior immutable image digest. Never destroy the runtime or foundation.

Before any live step, run `scripts/get-tracepoint-staging-inventory.ps1`; its
first call is STS and it refuses every account or role outside the staging
boundary. The GitHub foundation workflow is separate from runtime deployment and
cannot publish an image or enable the runtime stack.

The checked-in Next.js 16 container uses standalone output, copies `public` and
`.next/static`, runs the minimal `server.js` as a non-root user on port 3000, and
uses `/api/health` through the ALB. The route is dynamic, returns `200` JSON, and
sets `Cache-Control: no-store` without touching providers.

## Execution checkpoint — 2026-09-03

Identity and source gates passed with inherited environment credentials: account
`559054714699`, role `AWSReservedSSO_TracePointMigrationStaging`, region
`us-east-1`, branch `codex/aws-staging-readiness-20260902`, and commit
`aebb2af5eea3d6c5bed3653cf38f7fc404328d9b`. The staging helpers were updated to
use those inherited credentials and no longer pass a named AWS CLI/CDK profile.

The exact required secret fields remain:
`SUPABASE_SECRET_KEY`, `BREVO_API_KEY`, `NOTIFICATION_DISPATCH_SECRET`,
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`, and
`CONFIGURATION_ENVIRONMENT`. Safe metadata inspection found none of the eight in
`tracepoint/staging/application`. The local configuration is incomplete, is not
marked staging, has a non-staging site URL, and matches the repository's linked
Supabase project; it was not copied or treated as a separate staging project.
Supabase and Brevo therefore remain authoritative and unchanged.

AWS resource change: ACM certificate
`arn:aws:acm:us-east-1:559054714699:certificate/90d7c1b4-3d71-4168-a908-8678501f5e5a`
was requested for only `staging.tracepointhq.com`, with DNS validation and
certificate-transparency logging enabled. Status is `PENDING_VALIDATION`. This
account has no public Route 53 hosted zone for `tracepointhq.com`, so no DNS
record was changed. The external DNS owner must create exactly:

```text
Name:  _cf391b761ec604139a02ad89ac26fc3b.staging.tracepointhq.com.
Type:  CNAME
Value: _0c3b1ad8d569000f2d926c56c9c29f47.jkddzztszm.acm-validations.aws.
```

Image status: the reviewed Git archive allowlist produced 323 tracked source
files for the full commit SHA and rejected prohibited path classes. Publication
and CodeBuild were not started because staging configuration is unavailable.
ECR still contains zero images; image tag and digest are therefore `none`.

Runtime status: not deployed. A runtime CDK diff was intentionally not run
because the secret, immutable-image, and issued-certificate gates do not pass.
No runtime CloudFormation, ECS, ALB, HTTPS, log, secret-injection, smoke-test, or
rollback-alarm claims are possible yet.

Focused verification evidence: all nine modified PowerShell helpers parse;
profile-regression search passed; the shared identity helper passed against the
required account, role, and region; the deployment helper's non-mutating Verify
mode passed its account, protected-path, and `$75` budget gates; ECR image count
was confirmed as zero; and ACM/domain validation were confirmed pending. The two
protected untracked demo paths were not modified, staged, deleted, or archived.

Remaining human-only inputs are a completely separate non-production Supabase
project's staging credentials, a staging Brevo key, and external creation of the
single ACM validation CNAME above. The notification-dispatch and Server Actions
keys can then be generated specifically for staging without production reuse.

Revised completion: foundation infrastructure `100%`; staging automation and
safety gates `95%`; application configuration `0%`; immutable image publication
`0%`; staging TLS `50%`; runtime deployment and verification `0%`; aggregate
staging runtime readiness `61%`.
