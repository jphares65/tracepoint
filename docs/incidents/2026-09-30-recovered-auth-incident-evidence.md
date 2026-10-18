# Recovered authentication incident evidence — 2026-09-30

This is a read-only incident record. No Cognito, authorization, database, or
infrastructure state was changed while capturing it.

## Verified live revision

- ECS service: `tracepoint-production`
- Current task definition: `tracepoint-production-consolidated-aws-native-20260929:7`
- Current source image tag: `7ba11188dc8eb9fae119e131bd8053150b666ee7-aws-native-production`
- Current image digest: `sha256:54fbf8e3fda5d40e1a65af65407c8426cfc8868d569f66580932b1a8394f63d2`
- Current task: `26a9060f1cf14cd4920b4c6901bb0f2e`, created 10:12:57 EDT and started 10:13:33 EDT.
- Service deployment reached steady state at 10:15:20 EDT.
- `/api/health` returned HTTP 200 with `{ "status": "ok", "service": "tracepoint" }`.

## Preceding revision and recovery boundary

- Previous image tag: `8c4c03224f7f0b5c6981ccca6d6182be7227367f-aws-native-production`
- Previous image digest: `sha256:f7619d2cfddaa9e0448636d72acd180a6d0319b10d8808154911ab72d11ff7c8`
- Previous task definition: revision 6, registered 09:05:00 EDT.
- Revision 7 was registered 10:12:40 EDT and replaced the previous task between 10:12 and 10:15 EDT.
- The application-source diff from revision-6 image commit to revision-7 image commit changes only firearm inventory and its associated test; it contains no authentication, session, support-mode, Cognito, or authorization code.

## Retained CloudWatch evidence locations

- Application log group: `/tracepoint/production/application`
- Recovered-revision stream: `native-proof/tracepoint/26a9060f1cf14cd4920b4c6901bb0f2e`
- Retired-revision stream: `native-proof/tracepoint/a43f295f7fb143f3aed918b13ce4f055`
- CodeBuild log group: `/tracepoint/production/aws-native-image-build`
- Provider-mode failure build: `5166902f-4f80-4e6f-a257-0238e58a0ea1`
- Post-repair build failures without image publication: `6a79737b-8cd7-4121-a0e3-509837f0d808`, `f3999723-94ad-4926-a7f0-5850c2e4ad05`, and `9bf544f7-bca9-474d-b902-cb8fa148113f`

No application log event matching `Support Mode` was present in the retained
application log query. The temporary structured session diagnostic was never
deployed, so no new diagnostic events exist for this incident.
