# Paid rehearsal Auth session-control checkpoint — 2026-09-27

Scope: isolated paid Supabase project `reukdouvpshshvqnzsgw` only. No live
production Auth, user, schema, or source row was changed. Probe passwords,
JWTs, refresh tokens, service keys, and customer row contents were never
printed.

An exact-project read-only `GET /auth/v1/settings` against live production
reported Email as the only enabled external provider; signup is currently
enabled. That limits the new-interactive-sign-in provider inventory but does
not constrain refresh, recovery, or service-role Admin API writes. The
production migration-reader role cannot SELECT aggregate session counts, even
though catalog ACLs show the separate trusted SQL operator has DELETE on
`auth.sessions`; no production session mutation was attempted.

The Email provider was disabled twice for bounded rehearsal probes and
restored each time. A signed-in synthetic user's refresh-token grant still
returned HTTP 200 while Email was disabled, and an old user JWT still changed
`user_metadata` via `PUT /auth/v1/user` (HTTP 200). Thus disabling Email alone
does **not** fence existing sessions or refresh.

The supported global sign-out API was then exercised with a separate
disposable user: `POST /auth/v1/logout?scope=global` returned HTTP 204, the
old refresh token returned HTTP 400, and the old access token's Auth user
update returned HTTP 403. Administrative read confirmed its authoritative
probe metadata was unchanged after sign-out; the user was deleted. This is
real-interface evidence that Supabase Auth checks session revocation for
this Auth write, not a claim that stateless JWTs are universally invalidated
for PostgREST or Storage.

The paid SQL Editor showed `postgres` can delete from `auth.sessions` and
`auth.refresh_tokens`. The `refresh_tokens_session_id_fkey` uses ON DELETE
CASCADE. A separately approved, exact-email, count-guarded transaction
deleted **one** disposable `auth.sessions` row only after verifying exactly
one matching user, one session, and one associated refresh token. Read-only
post-checks returned one user, zero sessions, zero refresh tokens. The probe
process then timed out before testing its in-memory old JWT, and deleted the
disposable user. A later repeat probe timed out **before** any deletion and
also deleted its user. Final paid-project checks found zero exact probe users
and Email provider **Enabled**.

After separate approval, the same exact-user SQL was run once more with a
live probe waiting. With Email disabled and that one session deleted, a new
password sign-in returned HTTP 422, old refresh returned HTTP 400, and an
old-JWT `PUT /auth/v1/user` returned HTTP 403. Admin read remained HTTP 200
and confirmed authoritative probe metadata was unchanged. Email was then
re-enabled; new sign-in and Auth user write both returned HTTP 200. The
disposable user cleanup returned HTTP 200. The paid Email provider was
visibly confirmed **Enabled** afterward. No customer identity was touched.

Supabase Auth's own `Logout` implementation deletes from `auth.sessions` by
user ID, matching the SQL table-level operation. This supports the proposed
cutover-session control, and the SQL-delete-plus-old-JWT Auth write path is
now directly demonstrated for one disposable user. This does **not** establish
that deleting sessions invalidates stateless JWTs for PostgREST or Storage,
or that service/admin Auth writers are blocked. The wider composite fence remains
unproven until the other Auth, Storage, service/admin, and autonomous writer
controls and two immutable authoritative captures pass.

Primary behavior references:

- https://supabase.com/docs/guides/auth/signout
- https://github.com/supabase/auth/blob/master/internal/models/sessions.go
