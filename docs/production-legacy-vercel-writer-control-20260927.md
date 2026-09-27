# Legacy Vercel source writer: production cutover control

Status: **identified, not yet rehearsed or activated**. This is a required
component of the production composite fence, not a replacement for it.

The signed-in Vercel dashboard identifies project `tracepoint` under
`jphares65s-projects`, project ID `prj_V03LJyQIc231luvZ9u0gcOAt4xK4`.
Its Production environment has `SUPABASE_SECRET_KEY` and a Supabase URL
variable; the exact production deployment is reachable at
`https://tracepoint-amber.vercel.app`. The live Supabase pg_cron dispatcher
posts to this host every 15 minutes. The project has ready Preview
deployments, but its configured Preview `NEXT_PUBLIC_SUPABASE_URL` is
`https://wztqqqashilusoppddxi.supabase.co` (staging). **The Preview server
secret's project binding remains unverified**, so preview URLs must not yet be
declared irrelevant to the production source. No credential value was read or
recorded.

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
