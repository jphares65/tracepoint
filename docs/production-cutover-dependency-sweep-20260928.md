# Production cutover dependency sweep — 2026-09-28

This is a pre-maintenance inventory, not authorization to freeze or change
authority. Source is exactly Supabase `izlkwggluhlhzlumtzes` and AWS account is
`193644343389` / `us-east-1`. `PASS` means the specified **preflight** was
actually observed; rehearsal evidence is identified separately. Unknown or
unverified controls fail closed. No production key was retired, no source
capture was started, and no public traffic was changed during this sweep.

| Dependency | Observed state | Remaining cutover binding |
| --- | --- | --- |
| Production key inventory | One publishable `default`; modern secrets `default`, capture epoch and rollback epoch; legacy JWT keys enabled | Recheck immediately before freeze; identify exact old secret row for retirement without revealing values |
| Capture and rollback secrets | Both authenticate only to exact production project and are distinct; capture role reads capture ARN, not rollback/old REST ARN | Prove rollback secret has no active-writer assignment; pin key IDs to deletion/rollback commands |
| Known elevated holders | Public ECS bridge references old application secret; old migration REST secret matches that value | Old-epoch retirement is the fence for unknown holders; prove rejected use before capture |
| Supabase Auth | 16 sessions and 21 refresh tokens observed; rehearsal new-sign-in block and guarded session drain passed | Production exact-project Email control, active-session drain, admin/service negative, and inverse must be pinned |
| Supabase Storage | Authenticated RLS function guard rehearsed; production S3 settings show no separate S3 access keys | Recheck S3-key absence at freeze; old modern and legacy service credentials must fail elevated Storage writes |
| PostgREST / public writes | 87 public relations are owner-controllable; public-trigger layer rehearsed | Production activation remains fail-closed until full external fence attestation |
| RPC and SECURITY DEFINER | 30 public SECURITY DEFINER functions inventoried; 18 contain DML text, seven are anon-executable, none contains direct Auth/Storage-qualified DML text | Exact real-interface negatives plus old-epoch retirement and public-table trigger coverage |
| Cron and notification/background | One active notification dispatcher cron job observed; isolated stop/restore pattern exists | Exact production pause, queue/drain, negative and restoration evidence |
| Import/admin/external writers | AWS migration/proof roles and old REST secret are known; historical non-AWS holders cannot be fully enumerated | Retire old epoch, block Auth/Storage and prove the old credential is rejected; operator writes prohibited during freeze |
| Vercel Production/Preview | Project `prj_V03LJyQIc231luvZ9u0gcOAt4xK4`, exact team `team_HCPS7YRtZfKg7WZtSDfjhaSR`; disposable pause/Preview-deny proof passed; replacement operator token passed exact-team/project read-only attestation on 2026-09-28 | Reattest token/deployment/variable IDs immediately before maintenance; execute only the pinned pause and new-deployment rollback procedure after the full source-fence preflight passes |
| Public ECS bridge | Service revision 4 desired/running 1/1; no pause applied | Exact scale-to-zero/drain and reverse with newly distributed rollback key during maintenance |
| Production maintenance ingress | Exact ALB listener/default forward and complete-ingress guard PASS; public endpoints return normal 200 | Activate only after full preflight; confirm both canonical and unmatched Host 503; preserve reverse operation |
| Capture executor | Four-resource CloudFormation stack UPDATE_COMPLETE; content-addressed source ZIP and KMS/versioned artifact target; capture-only secret IAM | No build yet; require complete composite fence attestation, A/B jobs, quiet interval and immutable comparator |
| Final RDS | `tracepoint-production-final-cutover-20260926`, resource `db-X4DYNS3TMVSAP7Z3RISDWEYDVE`, private/encrypted/deletion-protected/available, PG 17.9 | Reattest TLS, lineage 99 and clean customer baseline immediately before apply |
| Relational final apply | Historical importer only accepts September 23 rehearsal RDS and initial pinned artifact/counts | Implement and rehearse separate exact-final-RDS, exact-slot-B, variable-count atomic apply/reconciliation; never retarget the historical importer by changing constants |
| Objects | Rehearsal copied two objects with size/SHA-256/reference parity and delivered both patch routes | Build dynamic final manifest/copy/reference comparison from capture B; reject missing/extra/cross-tenant objects |
| Cognito | Production pool/client pinned; one current pool user observed; isolated identity migration/login rehearsed | Stage/reconcile actual frozen identity cohort only after final relational parity; suppress customer invitations |
| Native image/ECS | Production-origin digest `sha256:cf19c9887eee2c79eac2abf2e0337f5a2bb95beefc5e20d0f1ffc0453a2f7b46` scan COMPLETE/zero findings; isolated boot passed | Reattest digest, final secrets, no-public-route task and target health before traffic |
| SES and feedback | Sender/configuration set and isolated delivery/bounce/complaint feedback PASS | Live worker remains on old DB; reviewed paused CloudFormation transition to final RDS occurs after reconciliation, before AWS traffic |
| WAF, ALB and DNS | WAF attached to public ALB; listener baseline PASS; no DNS change made | Reattest routing and WAF just before authority switch; no DNS change unless runbook requires it |
| Monitoring | 17 alarms OK; runtime SNS has confirmed human subscriber and a received test alert | Recheck alarms and receipt queue during/after cutover |
| Rollback and acceptance | Bridge rollback image scan COMPLETE/zero findings; one-record data-authority rollback rehearsed; bidirectional Officer tenant negatives passed in isolated rehearsal | Exact production rollback-key distribution/new Vercel deployment, final delta replay contract, production read/write and cross-tenant acceptance remain gated |

The production composite validator still returns `BLOCKED`. Requirements are
not frozen as passing: writer-control attestation and the runnable,
rehearsed final-artifact apply path are open. A tested capture-B transaction
boundary is present, but its actual relation-apply adapter and full
reconciliation have not been connected or exercised against a clean isolated
target. Do not infer a cutover GO from successful
credential attestation, capture-package deployment, or isolated rehearsal.
