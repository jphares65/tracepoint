# Production source fence: owner-control safety stop (2026-09-27)

Status: **SOURCE FENCE REPAIR BLOCKED**. Do not reopen maintenance, freeze live
writes, or run final capture. The attempted production fence was one transaction;
it rolled back at the first Auth-owned `ALTER TABLE ... ENABLE ALWAYS TRIGGER`
with SQLSTATE 42501. Maintenance was reversed. No final artifact was created.

The read-only, TLS-verified production catalog inventory is pinned to Supabase
project `izlkwggluhlhzlumtzes`, database `postgres`, 122 relations, fingerprint
`36558b0730e3e96cad6426f38088a5b0`. `postgres` owns 87 public relations and
can alter their trigger states. `supabase_auth_admin` owns 27 Auth relations;
`supabase_storage_admin` owns 8 Storage relations. `postgres` is not a member
of either owner role, so it cannot alter trigger state on any of these 35. It
also lacks `TRIGGER` privilege on `auth.schema_migrations`,
`storage.buckets_vectors`, `storage.migrations`, and `storage.vector_indexes`.

The complete owner-controlled set is:

- Auth: `audit_log_entries`, `custom_oauth_providers`, `flow_state`,
  `identities`, `instances`, `mfa_amr_claims`, `mfa_challenges`, `mfa_factors`,
  `mfa_recovery_code_sets`, `mfa_recovery_codes`, `oauth_authorizations`,
  `oauth_client_states`, `oauth_clients`, `oauth_consents`, `one_time_tokens`,
  `refresh_tokens`, `saml_providers`, `saml_relay_states`, `schema_migrations`,
  `scim_tokens`, `scim_users`, `sessions`, `sso_domains`, `sso_providers`,
  `users`, `webauthn_challenges`, `webauthn_credentials` (all in `auth`).
- Storage: `buckets`, `buckets_analytics`, `buckets_vectors`, `migrations`,
  `objects`, `s3_multipart_uploads`, `s3_multipart_uploads_parts`,
  `vector_indexes` (all in `storage`).

The catalog ACLs expose public-table writes to `anon`, `authenticated`,
`service_role`, and `postgres` as applicable; Auth tables are principally
written by `supabase_auth_admin` (some also grant `dashboard_user` and
`postgres`); Storage tables are principally written by
`supabase_storage_admin` (some also grant API roles). These ACLs are not a
complete runtime-writer inventory: owner rights and platform service behavior
must also be considered.

## Mechanisms evaluated

1. **Existing owner/admin path:** only the existing SQL Editor `postgres` path
   and read-only migration-reader database path are approved/configured. The
   former failed owner-level DDL; the latter cannot mutate. No approved
   Auth/Storage owner credential was found in the production migration secret
   inventory. Do not change table ownership or grant superuser/owner rights.
2. **SECURITY DEFINER:** a definer function created by `postgres` still cannot
   run owner-only `ALTER TABLE` on these 35 tables. An owner-created function
   would require a separately authorized platform-owner mechanism, which has
   not been established. Do not install an unproven definer bypass.
3. **Policies/grants:** Auth and Storage service owners can mutate their own
   tables; RLS and client grants are not a demonstrated fence for owner,
   service-role, admin/import, and background writers. They cannot replace the
   244-trigger/equivalent requirement without writer-by-writer proof.
4. **Platform/API controls:** no supported control has been established that
   blocks *all* Auth and Storage mutations while preserving the reads/export
   needed by final capture. UI maintenance is not such a control.

The paid source rehearsal previously blocked representative Auth create and
Storage upload while fenced, with no persisted probe rows/objects. That is
useful but insufficient for this revised requirement: it did not establish
`ENABLE ALWAYS`-equivalent coverage on all 35 owner-controlled relations,
including the four without `TRIGGER` grant, nor every platform/admin writer.
No new paid-rehearsal mutation or rollback was performed in this inventory.

Before a replacement can pass, obtain a supported, narrowly authorized owner
or platform control; prove its exact behavior in the paid project for Public,
Auth, Storage, service-role, background, RPC, direct REST, and admin/import
writers with fence off/on and read/capture available; prove deterministic
unfence; then version and review a replacement activation, abort, and validator.
The present read-only `--readiness` probe deliberately exits nonzero for the
35 uncovered relations. Do not reduce the required relation count or skip them.
