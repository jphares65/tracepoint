# Production cutover preflight checkpoint — 2026-09-28

This is a read-only checkpoint, not approval to enter maintenance or run the importer.

## Verified in account 193644343389, us-east-1

- `tracepoint-production` STS identity: account `193644343389`, role `TracePointMigrationProduction`.
- Updated Vercel operator token can read exact team `team_HCPS7YRtZfKg7WZtSDfjhaSR` and project `prj_V03LJyQIc231luvZ9u0gcOAt4xK4`; baseline deployment `dpl_AfRHke111kN5zaHR7NGiMaqi4UMk`. No token or environment value was logged.
- Final RDS `tracepoint-production-final-cutover-20260926`: resource ID `db-X4DYNS3TMVSAP7Z3RISDWEYDVE`, endpoint `tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com`, status `available`, private subnet group.
- Managed one-shot read-only probe task `tracepoint-production-final-target-readonly-probe-20260928:1` added by a reviewed CloudFormation change set containing only that task definition. Task `c6f9ec8eff81463db6f6ff28eb090eba` exited 0 and reported CA-verified TLS, database `tracepoint`, 99 applied migrations, and 0 Auth users. Its SQL transaction was explicitly read-only and rolled back.
- The first read-only probe attempt using private subnet IDs and `assignPublicIp=DISABLED` did not reach its entrypoint: ECR API connectivity timed out. A command override on the importer task did not replace the image ENTRYPOINT and failed closed before database access. The managed probe task used the already-established ECS subnet `subnet-0f4cbed3e60d90bfc` with a public IP and the importer security group with **no ingress**. Final importer launch instructions must use a network path that can reach ECR/Secrets/Logs; private-subnet launch is not proven ready.
- Final importer CloudFormation stack `tracepoint-production-final-import-task-20260928`: `CREATE_COMPLETE`. Relational and object-copy task definitions are revision 1. Neither task was started. The relational task lacks the required frozen-capture execution override and therefore fails closed by default.
- Both task definitions use immutable ECR digest `sha256:b88c77d4b1938a05a6fbf963ae508c22dc0937ae35ff82595fa69c0c44c1bd24`; ECR scan is `COMPLETE` with zero findings.
- Exact artifact `s3:GetObjectVersion` and exact final-RDS `rds:DescribeDBInstances` task-role simulations are `allowed`. A simulation against an unrelated bucket was `implicitDeny`. No task-role access to application secrets was established.
- Final capture CodeBuild project `tracepoint-production-final-source-capture-20260927` remains pinned to the reviewed immutable source ZIP and exact production source project `izlkwggluhlhzlumtzes`. No capture build was started.
- Focused final-import/preflight tests: 14 passed; the dedicated probe template tests: 2 passed. TypeScript `npx tsc --noEmit`: passed. The updated final-import task CloudFormation template validates.

## Gate result

`node scripts/validate-production-composite-preflight.mjs docs/production-composite-preflight-evidence-20260927.json` returned `PRODUCTION_COMPOSITE_PREFLIGHT_BLOCKED`. It reports 40 unresolved assertions, including public trigger proof; full final-import integration and rollback rehearsal; old credential epoch retirement and rollback distribution; incomplete active writer inventory; and unproven production controls for the bridge, Vercel, Auth, elevated Storage, RPC, cron/background, and administrative/import writers.

The deployed importer is an implementation package, not completed final-apply evidence. No isolated PostgreSQL end-to-end integration proof was run for it. Do not convert implementation or unit-test status into passed production preflight evidence. Maintenance, source fence, live captures, final apply, SES repoint, and authority switch remain unstarted.
