# Disabled provider infrastructure foundations

Both separate offline CDK assemblies passed strict staging and production synthesis on September 5. Five assertions cover Cognito session/rotation/MFA settings, callback separation, SES TLS/suppression, encrypted feedback, sender-scoped IAM, retained resources, absence of DNS mutations/subscriptions, and account rejection. The normal release entry point does not include these stacks.

Run from `infra`, with AWS credential/profile variables and CDK_DEFAULT_ACCOUNT removed and AWS_EC2_METADATA_DISABLED=true:

```powershell
npx.cmd cdk synth --app 'npx ts-node --prefer-ts-exts bin/provider-foundations-preview.ts' -c environment=staging -c account=559054714699 -c region=us-east-1 -c mailFromSubdomain=bounce --lookups=false --strict --quiet
```

Production preview substitutes environment=production and placeholder account=111111111111. These assemblies contain an intentionally fictitious runtime role; they are review artifacts and must not be deployed. No AWS resources or DNS records were changed and no monthly cost was added.

Cognito requires working PKCE/callback, invite/reset/activation/logout, durable session revocation, identity mapping and database RLS compatibility before activation. SES requires a durable feedback consumer, verified sender DNS, sandbox readiness, imported suppression state and live delivery/bounce/complaint validation. DNS record outputs are prepared; DKIM values resolve only after an authorized identity deployment. Brevo and Supabase authentication remain active.

No weighted completion credit is claimed for these disabled providers.
