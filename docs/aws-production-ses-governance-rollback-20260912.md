# Production SES governance rollback — 2026-09-12

This rollback closes the SES mutation window without deleting the SES foundation.
It restores the effective pre-SES permissions boundary (`v7`) and the exact
pre-SES SCP content. It does not change DNS, send email, or delete resources.

## Captured state

- SCP `p-rvx1u7q7` before SHA-256:
  `33a65fe45a4cd1a94a3ff83db92de198e4c5d2626c454a3e9ff26352dce35fb1`
- SCP current SES-foundation SHA-256:
  `1beecd19d24912f1cac8a9225644125254a0ae818c5a72965046eef60551e5b2`
- Boundary pre-SES default `v7` SHA-256:
  `466ca79aae5213840a3f697f89ead5c552508ce6232651fad784d82c42133359`
- Boundary current default `v8` SHA-256:
  `c289fbfcba6f6cd7036ce59e7ee3ba64992c7ca6a7409f43fdb258c055eca3ed`

## Exact effective rollback

Run only with an explicit rollback authorization:

```powershell
aws iam set-default-policy-version `
  --profile tracepoint-production `
  --policy-arn arn:aws:iam::193644343389:policy/TracePointProductionBoundary `
  --version-id v7

aws organizations update-policy `
  --profile tracepoint-staging `
  --policy-id p-rvx1u7q7 `
  --description "TracePoint production guardrails: us-east-1 runtime, protected audit/security controls, no DNS traffic cutover, Cognito, or SES activation" `
  --content file://infra/policies/tracepoint-production-guardrails.pre-ses-20260912.scp.json
```

Verify the exact restored state:

```powershell
aws iam get-policy `
  --profile tracepoint-production `
  --policy-arn arn:aws:iam::193644343389:policy/TracePointProductionBoundary `
  --query Policy.DefaultVersionId `
  --output text

aws iam simulate-principal-policy `
  --profile tracepoint-production `
  --policy-source-arn arn:aws:iam::193644343389:role/TracePointMigrationProduction `
  --action-names ses:PutAccountDetails ses:PutAccountSuppressionAttributes ses:SendEmail ses:CreateEmailIdentity `
  --resource-arns "*" `
  --query "EvaluationResults[].{Action:EvalActionName,Decision:EvalDecision,Organizations:OrganizationsDecisionDetail.AllowedByOrganizations}" `
  --output json
```

Expected: default boundary is `v7`; every simulated SES mutation is denied.
Canonicalize and SHA-256 hash both live documents before declaring rollback
complete. The expected hashes are the two pre-SES hashes above.

The old nondefault boundary `v3` slot was retired before creating `v8`, because
IAM managed policies allow five stored versions. Its captured canonical SHA-256
was `81f266facf5c2f72730893080c7068a552d3c824654fd51850f28af732f8162d`.
That historical slot is not needed for the effective rollback; `v7` remains live.
