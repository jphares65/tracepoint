# Paid source credential-epoch rehearsal — 2026-09-28

Scope: isolated Supabase project `reukdouvpshshvqnzsgw` only. No live
production source, public traffic, DNS, Cognito authority, or AWS application
authority was changed. No credential value or source row is included here.

## Key and writer state

- The old modern secret-key rows `default` and
  `tracepoint_source_rehearsal_20260925_rotated` were retired. The user
  performed the final dashboard credential-deletion actions. The latter
  matched the old AWS-stored rehearsal key, which was directly rejected.
  The former's value was not available for a direct post-deletion probe;
  dashboard absence is the available evidence for its retirement.
- The publishable `default` row was accidentally deleted and replaced with
  `default_replacement_20260927`. Final dashboard inventory showed that
  publishable row and only two secret rows:
  `tracepoint_epoch_capture_20260927` and
  `tracepoint_epoch_rollback_20260927`.
- Legacy JWT-based API keys remained disabled throughout old-modern-key
  retirement and rollback. The two new modern keys were distinct, and each
  independently read the exact paid-project synthetic fleet row. The
  rollback key was not installed in a continuously running source writer.
- The pre-retirement composite fence had the database fence, disabled Email
  provider, disabled signup, disabled S3 protocol, drained Auth sessions,
  and zero active cron jobs. A controlled rollback-key probe while frozen
  returned denied Auth and Storage writes with zero residual probes.
- The retired AWS-stored old key returned HTTP 401 for REST read/write and
  Auth; a simulated second holder of the same credential also returned
  HTTP 401. The Storage request returned HTTP 400 with exact
  `AccessDenied` / `Unauthorized` labels, while the identical request with
  the capture key returned HTTP 200. The synthetic source row was unchanged.
  The same negative checks passed again after unfence.

## Immutable capture and comparison

Both builds used the pinned isolated CodeBuild project
`tracepoint-production-source-rehearsal-capture-20260925`, source ZIP
VersionId `GVQ9I6YuUtLc.XY9HaSsklUDucJvTKSU`, and only the dedicated
capture secret injected as `SECRETS_MANAGER`. The artifacts remained in
AWS S3; no source-row artifact was downloaded to the workstation.

| Capture | Build suffix | S3 key suffix | VersionId | Whole-file SHA-256 |
| --- | --- | --- | --- | --- |
| A | `14af04fc-9fd1-40d2-9e9f-38bae138d70c` | `463606ba-ce48-468d-a91c-57c8067a0d3b/final-canonical.json` | `tbPTk63hnk56bzp_cw94l5AnHxhbK7pK` | `8d8eef632cd44228e775a785f08673d092a4aa6c0a8c6c06afebf0d2b99df59c` |
| B | `0359477f-3949-4328-971f-1c3b01d948ac` | `90e721c1-039b-47f8-b02d-c4e79d6100c8/final-canonical.json` | `dy89s6SJfQ6CI1jeLqQijuYqOexbv5OU` | `ad66795b903368a0c33f93a5a3646ac407845c2203748d704f406c48917bc729` |

Each artifact reported a stable fence, 90 relation contracts, 174 relational
rows, one identity, one membership, and one object. S3 HEAD confirmed a
versioned, SSE-KMS-encrypted artifact. AWS-local comparator build
`8c06a7e1-63ed-45fb-abfe-400b32ec6315` reported
`FROZEN_SOURCE_QUIESCENT` after 171,754 ms: zero changed relations,
identities, memberships, or objects. It logged no row payloads.

## Abort/resume proof

In the paid project only, Email sign-in, signup, and S3 protocol were
re-enabled, then the guarded SQL fence-off transaction committed
`frozen=false` at `2026-09-28 04:01:25.193685+00`. The reserved rollback
key subsequently created/deleted a synthetic Auth user and Storage object,
and performed a synthetic fleet self-update/read-back: Auth 200, Storage
200, REST 204, with zero residual probes. The final read-only census was
one department, one Auth user, zero Auth sessions, zero refresh tokens,
one Storage object, one synthetic fleet row, and zero active cron jobs.
The deleted old key remained rejected after this restoration.

The temporary inline IAM policy `PaidEpochCaptureExact20260927` granted
the isolated capture role only the capture secret, two exact artifact
keys, and pinned comparator source. It was removed after proof; the role's
only remaining inline policy is `SourceRehearsalCaptureExact20260925`.

This is a **paid-rehearsal proof**, not a live production credential-epoch
preflight or cutover. Production keys were not created or retired here.
