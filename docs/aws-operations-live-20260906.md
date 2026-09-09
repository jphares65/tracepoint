# Read-only OIDC operations evidence

> Superseded by `aws-final-staging-release-20260906.md` and
> `aws-operations-488e13fadedad11e35a05d7e59b314e8a135cfb4.json`. The current
> restored runtime is revision 21 on image `8406719`, with matching digest,
> completed zero-finding scan, ECS `1/1/0`, one healthy target, six alarms `OK`,
> zero current-task error matches, and queue counts `0/0`. The historical notes
> below are retained to preserve the investigation trail for revision 18.

Run 34036686190 (`1791a34`) successfully assumed the restricted staging OIDC role
and collected evidence at 2026-09-06T13:38Z. It did not deploy or mutate AWS.

- Account 559054714699, us-east-1, required assumed-role pattern verified.
- Runtime CloudFormation UPDATE_COMPLETE; ECS revision 18, desired/running/pending
  1/1/0, completed rollout; one healthy ALB target.
- Image af8304f40bad8ccd7336b35cacd026a89be5149a, digest
  sha256:6a4c9d5dfb5d89b9d2b9d1be2c3dab2a0abba8fa73aa70da401c00b6c1b8f503.
  Running digest matches; ECR scan COMPLETE, zero findings.
- All six staging alarms OK. All 12 public checks passed. Staging notification
  queue failed/stale-processing counts are 0/0.
- Budget actual $2.983 of $75. Monthly model $68.67 plus $2 rehearsal reserve.
  Cost Explorer is unavailable to this restricted role; budget actual is not a
  complete real-time bill and may lag usage.

The overall runtime evidence gate **failed** because it found 10 error-pattern
matches across the current task's entire lifetime. No filesystem-permission
matches occurred. Their cause and recency were not established by that collector;
do not call these logs clean. A separate read-only classifier now reports counts,
categories and timestamps without messages, credentials or personal data.
Six focused classifier/workflow/sanitization tests and changed-file lint pass.

Run 34037214873 (`c7a1130`) reconfirmed those runtime and budget readings, but
the separate diagnostic query sequence failed and did not produce classification.
Classification is now embedded in the existing runtime collector's already-read
events, with no additional AWS query. Seven focused tests pass, including
extraction of nested sanitized classification. The strict error gate is unchanged.

Run 34037910721 (`f2001e6`) successfully classified the ten matches: eight rejected
Server Action requests and two unclassified events, all between 12:06:43.605Z and
12:06:45.833Z on September 6. There were zero matching errors in the preceding
60 minutes at 14:02Z. The strict task-lifetime gate remains failed. The unclassified
events are not assumed harmless; a fixed technical-vocabulary diagnostic was
added to investigate without logging messages or personal data.

The two preceding OIDC attempts failed before AWS reads: an invalid managed-policy
reference, then STS packed-policy size. Both failed-run reports are retained.
The compact explicit read allowlist succeeded without modifying the IAM role.

The local staging session remains expired. Main remains at e33e4a4 on the latest
fetch; the separate production qualification/Training Alerts hotfix has not been
integrated. No production ledger/data/configuration/DNS operation was performed.
Weighted readiness remains **66.50%**, pending log classification and the separate
production hotfix/migration reconciliation gates.
