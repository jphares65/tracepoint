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

The production composite preflight remains **BLOCKED**. In particular, the
public trigger install/abort, double-capture binding, exact unfence, and
complete autonomous-writer inventory are not proven. The direct Storage and
existing-user Auth probes cannot be promoted to live cutover evidence by
assumption. Production maintenance and source freeze must remain off until a
reversible production control for these writer paths is rehearsed and the
fail-closed production preflight passes.
