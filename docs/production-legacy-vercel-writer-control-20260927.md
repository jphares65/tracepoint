# Legacy Vercel source writer: production cutover control

Status: **isolated pause inverse rehearsed; live control not activated**. This is a required
component of the production composite fence, not a replacement for it.

The signed-in Vercel dashboard identifies project `tracepoint` under
`jphares65s-projects`, project ID `prj_V03LJyQIc231luvZ9u0gcOAt4xK4`.
Its Production environment has `SUPABASE_SECRET_KEY` and a Supabase URL
variable; the exact production deployment is reachable at
`https://tracepoint-amber.vercel.app`. The live Supabase pg_cron dispatcher
posts to this host every 15 minutes. The project has ready Preview
deployments, but its configured Preview `NEXT_PUBLIC_SUPABASE_URL` is
`https://wztqqqashilusoppddxi.supabase.co` (staging). The project has a
**separate Preview-scoped `SUPABASE_SECRET_KEY`** entry. **The Preview server
secret's project binding remains unverified**, so preview URLs must not yet be
declared irrelevant to the production source. No credential value was read or
recorded.

The later read-only Vercel settings inspection reconfirmed that Preview's
`NEXT_PUBLIC_SUPABASE_URL` is the staging project
`wztqqqashilusoppddxi`, but the Preview `SUPABASE_SECRET_KEY` is a
write-only Vercel Secret and its value cannot be revealed after saving. The
project's Cron Jobs page showed no configured jobs. Deployment Protection
has Vercel Authentication, **and one automation-bypass secret exists**;
therefore an unauthenticated 302 is not proof that every Preview writer is
blocked. The bypass holder and the Preview server-key project binding remain
unclassified. Neither Vercel secret nor deployment setting was changed.
Vercel documents that its [automation-bypass secret](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
can bypass project deployment protection until revoked.

The project environment inventory shows the Preview-scoped Supabase URL,
publishable key, and server secret were added on September 17; the older
production values remain Production-scoped. Repository inspection found that
`createAdminClient()` and the ordinary browser/server clients all use
`NEXT_PUBLIC_SUPABASE_URL` as their destination, and the server secret is a
credential for that same destination. The admin client has used this
coupling since its June 25 introduction. This strongly indicates current
Preview builds target staging even if their concealed server key were wrong.
It does not yet attest the immutable environment snapshot of **every** Ready
historical Preview deployment, so `previewProductionSourceExcluded` remains
false until the deployed artifacts or another exact deployment inventory
closes that gap. Project pause only blocks Production, not Preview.

The Vercel Activity log then exposed the historical risk directly:
`NEXT_PUBLIC_SUPABASE_URL` was originally added June 22 and edited June 23
with **Production and Preview** scope; a separate Preview-scoped URL was not
added until September 17. The same period has Ready Preview deployments and
a preexisting project automation-bypass secret. The old shared URL's exact
value and each historical deployment's immutable environment snapshot were
not exposed in this read-only view, so older Preview deployments must be
treated as **potential live-source writers**, not excluded based on the
current staging Preview setting. The Activity log separately confirms
`SUPABASE_SECRET_KEY` was added June 25 with **Production and Preview** scope.
Thus a pre-split Preview could have both the live source URL and an elevated
source credential. No project setting or deployment was changed.

A further read-only deployment-list inspection on September 27 loaded 200
entries: 194 Preview, six Production, and 102 marked Ready. The oldest loaded
entry was September 8, before the Preview-specific variables were introduced.
The UI still offered `Load More`, and deployment retention is enabled, so these
are **lower bounds**, not a complete per-deployment credential inventory.
The project-wide Preview-environment deny is intended to cover every retained
Preview deployment regardless of its immutable build-time variables; until
that exact rule and its inverse are proven, none of these historical entries
can be declared unable to write the production source.

Read-only live Firewall inventory showed **zero custom rules**. Vercel's
[WAF rule configuration](https://vercel.com/docs/vercel-firewall/vercel-waf/rule-configuration)
can match the request's deployment **Environment** and Deny
requests before they reach the application, even when a client passes
Deployment Protection; a rule can be disabled or deleted without a redeploy.
The proposed bounded cutover control is a temporary rule on exact project
`prj_V03LJyQIc231luvZ9u0gcOAt4xK4`:
`Environment Equals Preview` → `Deny`, paired with the already-proven
Production pause. This covers historical Preview URLs without reading or
rotating server credentials. The rule is **not yet approved/proven on the
disposable project**, and was not added to the live project. A disposable
`Environment Equals Production` Deny/inverse proof was prepared; its rule is
staged in Vercel's Review Change dialog but **not published/live**. The browser
safety reviewer rejected Publish pending approval for that exact disposable
rule. Do not mark this writer controlled until its real-interface negative
and inverse pass.

The production preflight and final-capture attestation now accept two distinct
safe Preview proofs: either every historical Preview is demonstrated unable
to reach the production source, or an exact-project, project-wide Preview deny
is reviewed, rehearsed, active during capture, supported by a negative-test
evidence hash, and reversible. This corrects the former impossible requirement
that pre-September-17 Preview deployments be declared production-source-free.
No evidence field has been marked passed merely by changing the validator.

Vercel documents that pausing a project stops its **Production Deployment**
with `503 DEPLOYMENT_PAUSED` and leaves Preview deployments, settings, and
data unaffected. It can be resumed from the same project's Settings page or
API without redeployment. Therefore production pause is reversible, but is
not by itself a complete proof that every Vercel deployment with source
credentials has stopped.

Before cutover maintenance, complete these checks without mutation:

1. Confirm the project ID, team, Production domain and active deployment in
   Vercel. Confirm the Production environment's Supabase project reference is
   exactly `izlkwggluhlhzlumtzes` without disclosing either server key.
2. Establish, without printing either value, whether the Preview
   `SUPABASE_SECRET_KEY` is bound to staging or production. If production,
   enumerate and independently block every reachable Preview deployment; do
   **not** treat the project pause as sufficient.
3. Prove pause and resume on an isolated non-production Vercel project. Require
   external `503 DEPLOYMENT_PAUSED` during pause and a healthy response after
   resume. Record the project ID, timings and exact inverse.
4. Ensure an operator access path exists for the live project (dashboard or
   project-scoped API token). Do not create or disclose a broad token merely
   to satisfy this document.

Disposable project `prj_wkk5IA0iS8cTKKuaTQoNbxYncCFw`
(`project-q7s6a` in the same Hobby team) was created with explicit approval to
rehearse the pause inverse. It had no deployment, environment variables, or
source connection at creation. Vercel initially refused to pause the empty
project with `Active production deployment does not exist`; no state changed.
With explicit approval, one 201-byte synthetic `index.html` was uploaded to
**that exact project only** as its first Production deployment
`dpl_Ew7sdctcCDr2pqHgZZf3RARFAR29`. No secrets or customer data were
included. The exact-origin, read-only external verifier
`scripts/verify-disposable-vercel-pause.mjs` recorded:

| State | UTC | External result |
| --- | --- | --- |
| Active before pause | 2026-09-27 18:41:40 | HTTP 200, exact synthetic marker |
| Paused | 2026-09-27 18:42:19 | HTTP 503, `DEPLOYMENT_PAUSED` |
| Resumed | 2026-09-27 18:42:49 | HTTP 200, exact synthetic marker |

The same Vercel Settings > General control performed pause and inverse resume;
no redeployment was required. This proves the **disposable project's**
reversible Production-deployment barrier. It does **not** resolve the live
project's Preview-secret binding or prove that every production-source writer
is fenced. The disposable project is left active with only its synthetic page.

Read-only inspection of the live project's deployment protection showed
project-level **Vercel Authentication / Require Log In** selected. Two Ready
Preview deployment URLs tested from an unauthenticated external client
redirected to Vercel login (HTTP 302), not to the application. This is a
useful unauthenticated negative but is not a complete writer exclusion:
signed-in team members, bypass mechanisms, and the separate Preview server
secret still require classification. The live project and Preview deployments
were not modified during this check.

During the controlled cutover window, after public maintenance is externally
verified and before the source fence/captures:

1. Reverify the exact live project ID and capture the current deployment
   identity and public response. Pause **only** project
   `prj_V03LJyQIc231luvZ9u0gcOAt4xK4`. The reviewed dashboard path is
   `Settings > General > Pause Project`. If a project-scoped token has been
   prepared and tested, the documented API is
   `POST /v1/projects/prj_V03LJyQIc231luvZ9u0gcOAt4xK4/pause` with the
   exact team scope. Never use a project name or wildcard in the mutation.
2. Require external `503 DEPLOYMENT_PAUSED` from
   `https://tracepoint-amber.vercel.app`. Confirm no production-sourced
   Preview deployment remains reachable with an elevated key. Pause failure,
   ambiguous response, or a surviving writer means **do not capture**.
3. Pause and drain the exact Supabase dispatcher; verify no in-flight run.
   Then apply and test the remaining source controls. Keep Vercel paused
   through both immutable captures and the quiet interval.

Before an abandoned pre-authority cutover is reversed, require zero AWS-only
authoritative writes and source single-authority attestation. Restore the
database fence and exact dispatcher first while maintenance remains active;
then resume **only** the captured Vercel project from its Settings page or
`POST /v1/projects/prj_V03LJyQIc231luvZ9u0gcOAt4xK4/unpause` with the
same team scope. Verify the same Production deployment serves healthy
requests. Finally reverse public maintenance. Do not resume the legacy
writer after AWS has become authoritative.

No Vercel Production project was paused or changed while preparing this
inventory. The documented Vercel pause/resume semantics are from
https://vercel.com/docs/projects/managing-projects .
