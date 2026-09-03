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
2. Review and invoke `set-tracepoint-staging-secret.ps1`; it replaces the complete
   eight-field JSON value atomically, uses concealed input, prints no value, and
   rejects production-looking values.
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
