# Source-fence Auth/Storage probe evidence — 2026-09-27

Scope: isolated paid Supabase project `reukdouvpshshvqnzsgw` only. The live
source project `izlkwggluhlhzlumtzes`, public maintenance listener, and AWS
authority were not changed. All probe credentials and tokens remained in
memory; no customer rows or credential values were printed.

## Synthetic Auth session

An existing disposable Auth user was created, then password sign-in was
attempted while the paid project's existing database trigger fence was on.
The Auth API returned HTTP 500 and issued no token. Before/after canonical
hashes for the user's authoritative fields and full identity record were
equal; session, refresh-token, MFA-factor, and recovery-token counts stayed
zero. The fence was reversed and the disposable user deleted. A final census
showed zero probe Auth users and `frozen=false`.

This demonstrates the paid project's existing Auth triggers block this path.
It does **not** prove that the same path is controlled on live production,
where the inspected Auth tables have no cutover triggers and are not owned by
the SQL operator.

## Direct authenticated Storage API

Using the paid project's existing synthetic tenant administrator (no password
reset), a short-lived Auth token was obtained via an administrative magic-link
verification, entirely in memory. The direct Storage API was tested against
one exact disposable object key in `department-assets`:

| State | Same-tenant upload | Cross-tenant upload | Persisted probe objects |
| --- | --- | --- | --- |
| Fence off, before | HTTP 200 | HTTP 400 | 0 after cleanup |
| Fence on | HTTP 500 | Not repeated | 0 |
| Fence off, restored | HTTP 200 | Not repeated | 0 after cleanup |

The paid database fence was set with the guarded `20260927_composite_fence_on.sql`
and reversed with `20260927_composite_fence_off.sql`. The final SQL census
confirmed `frozen=false`, zero exact probe objects, and zero disposable Auth
users. This proves the real authenticated Storage interface is capable of an
authoritative write when unfenced and blocked by the paid project's existing
Storage trigger layer when fenced. It does **not** establish a production
control: the production Storage tables are Supabase-managed and cannot use
that trigger layer under the reviewed operator permissions.

## Read-only live-source authorization findings

The TLS-pinned live production catalog still has 122 base relations, zero
cutover fence triggers, and no `tracepoint_cutover` schema. Storage object
INSERT/UPDATE/DELETE grants exist for `authenticated` and `service_role`.
The department-assets authenticated policies call the public,
security-definer `has_department_permission(uuid,text)` function; the
`service_role` can bypass Storage RLS. The SQL operator is neither owner nor
member of the Supabase Storage owner role, so a production Storage policy or
grant edit is not a reviewed available action. No separate S3-compatible key
was found in the earlier inventory.

## Independent controls tested after the trigger-layer probe

The paid project's Email provider was temporarily disabled in the dashboard
and then restored. A disposable existing user's password sign-in passed with
HTTP 200 before the switch and was rejected with HTTP 422 while Email was
disabled; no token was issued and the existing user's administrative fields
did not change. This is a reversible direct customer-sign-in control, not a
complete Auth fence: an administrative create with the exact paid-project
modern secret key still succeeded while Email was disabled. That test user
was deleted. Thus every autonomous holder of a modern secret key must be
stopped independently; disabling Email alone cannot satisfy the source fence.

Separately, with the paid project's Storage trigger state set to
`frozen=false`, the versioned `20260927_storage_policy_guard_probe_on.sql`
temporarily added a fence check to the existing operator-owned public
permission function, without editing a Supabase-managed Storage table or
policy. A same-tenant authenticated direct upload then failed with HTTP 400
and created no object. With the guard off, the same path returned HTTP 200.
An elevated paid-project service-key upload still returned HTTP 200 while
the guard was active, confirming the RLS bypass and need for a separate
server-key writer stop. The exact inverse SQL restored the original function
definition. A final read-only paid-project census showed `frozen=false`,
original function MD5 `11f7fb50c985589515faa758fb30b058`, guard table
absent, zero disposable Auth users, and zero probe Storage objects. The
production function is owned by `postgres` with pinned MD5
`5537f428cb4f1fac15320843cb213faa`; the production activation/abort SQL
contains a separately pinned adaptation, but has not been executed.

The production composite preflight remains **BLOCKED**. In particular, the
public trigger install/abort, double-capture binding, exact unfence, and
complete autonomous-writer inventory are not proven. The direct Storage and
existing-user Auth probes cannot be promoted to live cutover evidence by
assumption. Production maintenance and source freeze must remain off until a
reversible production control for these writer paths is rehearsed and the
fail-closed production preflight passes.
