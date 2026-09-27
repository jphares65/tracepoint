# Isolated ECS writer pause and inverse proof

Date: 2026-09-27. Account: `193644343389`, region `us-east-1`.

The isolated Phase 3C rehearsal service
`tracepoint-production-phase3c-rehearsal-app` was attested at task revision
`:23`, desired/running `1/1`, and target group
`arn:aws:elasticloadbalancing:us-east-1:193644343389:targetgroup/tracep-Targe-7OUSA2XRQM5A/bd67f4134e0c93f4`.
The production migration role's effective `ecs:UpdateService` decision for
this exact service was `allowed`. This rehearsal service uses AWS-native
RDS/S3 configuration and no Supabase source secret; it was used to prove the
**ECS scale mechanism**, not the complete production source fence.

`pwsh -NoProfile -File scripts/rehearse-ecs-writer-pause.ps1` is pinned to
the isolated service. It checks the baseline, sets desired count to zero,
waits for zero running/pending tasks, then restores desired count one in a
`finally` path and requires one running task and a healthy ALB target.
The first invocation restored the service but exited with a verifier error:
it incorrectly required exactly one target while the old target was draining
and the new one healthy. The verifier was corrected to allow exactly one
healthy target with any other target only in `draining` state. The corrected
invocation completed:

```json
{"status":"ISOLATED_ECS_SCALE_INVERSE_REHEARSED","service":"tracepoint-production-phase3c-rehearsal-app","originalDesired":1,"stoppedDesired":0,"stoppedRunning":0,"restoredDesired":1,"restoredRunning":1,"targetHealth":"healthy","checkedAtUtc":"2026-09-27T18:15:37.0323174Z"}
```

An independent read-only ECS check after the successful invocation showed
both `tracepoint-production` and the isolated rehearsal service at
desired/running/pending `1/1/0`, with their original task definitions.
No public service, source data, DNS, listener, or authority was changed.

For the live cutover, the exact public service is
`arn:aws:ecs:us-east-1:193644343389:service/tracepoint-production/tracepoint-production`.
Its task revision `:4` receives `SUPABASE_SECRET_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`, so the maintenance ALB response must be
followed by a reviewed, exact-service scale-to-zero/drain before source
capture. Its pre-authority inverse is the **captured baseline** desired count
of one and original task revision, restored while maintenance remains active,
followed by healthy target and external app verification before maintenance
reversal. This live action has **not** run. ECS scale-down also does not
disable direct Supabase clients, the legacy Vercel deployment, or external
Auth/Storage writers; those remain separate fail-closed gates.
