# Production final-capture executor deployment evidence

This deployment prepares the isolated capture executor only. No capture build,
source fence, maintenance response, final import, key retirement, or authority
switch was started.

- AWS account/region: `193644343389` / `us-east-1`.
- Reviewed source commit: `ff05e78485f1299d625a2889acf5373924bd2cea`.
- Source ZIP key:
  `source/tracepoint-production-final-capture-fa5cd8f88aa27670d5f42c61b5176470d2866a062f009905f021ff711f7bbd8f.zip`.
- ZIP whole-file SHA-256:
  `fa5cd8f88aa27670d5f42c61b5176470d2866a062f009905f021ff711f7bbd8f`.
- Build-source S3 VersionId: `3GxSfjg5MV3nmvqdmZNVuGTyoBvdW8ef`;
  private bucket versioning enabled, SSE-KMS key
  `6880c1ac-f131-4077-9075-8d063ec43cba`, checksum verified by `HeadObject`.
- Change set: `tracepoint-final-capture-object-archive-ff05e78-20260928`.
  The reviewed change contained only `CaptureRole` policy modification (no
  replacement) and `CaptureProject` source/service-role reference modification.
  No public ECS, ALB, DNS, or runtime resource was in the change set.
- Stack: `tracepoint-production-final-source-capture-20260927`,
  `UPDATE_COMPLETE`. CodeBuild source points to the exact ZIP above, role is
  `TracePoint-ProductionFinalSourceCapture-20260927`, and source project ref
  remains `izlkwggluhlhzlumtzes`.
- Capture role boundary: `TracePointProductionBoundary` v16. IAM principal
  simulation: `s3:PutObject`, `s3:GetObject`, `s3:GetObjectVersion` allowed for
  the pinned capture-B `department-assets` archive prefix; exact production
  rollback-secret `GetSecretValue` implicitly denied.

The production composite preflight still fails closed. In particular, final
import integration/reconciliation rehearsal and several live writer controls
are not yet proven. The executor must not be started until the full frozen
preflight passes and the composite attestation is version-pinned.
