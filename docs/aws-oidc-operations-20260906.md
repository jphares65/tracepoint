# Read-only staging operations through OIDC

The separate operations workflow collects current runtime/public-route/log/alarm
evidence and actual budget metadata without image publication, ECS changes or
CloudFormation deployment. It shares release concurrency, so it cannot overlap
an AWS release in this repository. It does not use the expired local AWS session.

The existing environment-scoped GitHub role is further restricted with an inline
allowlist of specific metadata reads, budget reads, secret reads and decryption.
The existing intersected role retains the exact staging budget, application
secret, KMS key and Secrets Manager service restrictions.
Session policies intersect the existing role; no IAM role policy is changed.
See the action's [session-policy interface](https://github.com/aws-actions/configure-aws-credentials#session-policies).

The existing runtime collector performs HEAD-only staging notification-queue
counts. It prints no secret or queue contents. It does not query production.
Cost Explorer access is optional and explicitly reported as unavailable when
denied; actual budget usage and the monthly model are separate fields.

To execute, first commit and push reviewed tooling. In a separate commit, write
only `.github/staging-operations.json` with this shape, substituting actual SHAs:

```json
{
  "action": "collect-read-only-evidence",
  "account": "559054714699",
  "region": "us-east-1",
  "reviewedCommit": "<exact parent commit, 40 hex characters>",
  "imageCommit": "<currently accepted immutable image, 40 hex characters>"
}
```

Push to `codex/aws-staging-readiness-20260902`. The validator requires the exact
branch, single request-file change, reviewed parent and ancestral image. Extra
fields or arbitrary actions are rejected before acquiring AWS credentials.

Collect the completed sanitized evidence using:

```powershell
node scripts/collect-staging-workflow-evidence.mjs <request-commit-sha> --operations --completed-logs --save
```

Five focused workflow/request/log-sanitization tests and changed-file lint pass.
This tooling checkpoint alone does not claim a successful live operations run
or change weighted readiness. Production hotfix integration remains deferred.

The first request (`e00afe8`, run 34035819964) passed source/request validation
but STS rejected the AWS-managed ReadOnlyAccess ARN as a session policy reference.
No AWS evidence reads or mutations ran. The corrected workflow uses the explicit
inline read allowlist; the saved failed-run evidence is retained for accuracy.

The second request (`dd66e34`, run 34036177287) reached STS but exceeded its packed
policy limit at 102%. The compact correction removes resource restrictions that
are already enforced by the intersected role and omits unusable Cost Explorer
permission. It retains the explicit read-only action list and regional boundary.
