# TracePoint Supabase dependency map

**Inventory date:** 2026-08-31
**Method:** repository-wide static inspection of `src/`, `supabase/migrations/`, package metadata, and route handlers. No Supabase API or database was accessed.

## Executive finding

Supabase is not a replaceable connection string. It currently provides four
coupled control planes: Auth, PostgreSQL/PostgREST/RPC, RLS authorization, and
Storage. Most server routes use a privileged service-role client after an
application-layer access check; browser and cookie-aware server clients also
depend directly on Supabase session semantics. A safe migration therefore keeps
Supabase for the initial AWS hosting phase, then separates authorization and
provider boundaries before data or Auth cutover.

## Client construction paths

| Path | Runtime | Credential | Uses |
|---|---|---|---|
| `src/lib/supabase/client.ts` | Browser | public URL + publishable key | password/OTP sign-in, current user, browser data reads |
| `src/lib/supabase/server.ts` | Next.js server/components/routes | public URL + publishable key + request cookies | authenticated user/session and RLS-scoped queries/RPC |
| `src/lib/supabase/proxy.ts` | Next.js proxy | public URL + publishable key + request/response cookies | claim refresh, route protection, platform/admin and department permission resolution |
| `src/lib/supabase/admin.ts` | Server only | `SUPABASE_SECRET_KEY`, fallback `SUPABASE_SERVICE_ROLE_KEY` | Auth Admin, RLS-bypassing data operations, Storage, notifications |

Direct constructors are confined to those four files. Call sites import one of
these factories or receive an admin client through `getServerAccessContext`.
`src/lib/tracepoint/server-access.ts` is the highest-value existing boundary: it
authenticates with the server client, resolves membership/roles/permissions, and
returns an admin client plus actor/department context.

## Authentication and account lifecycle

- Browser password login and email OTP: `src/app/login/LoginForm.tsx`.
- Cookie/claim gate and active-department cookie: `src/proxy.ts` and
  `src/lib/supabase/proxy.ts`.
- OAuth/PKCE code exchange: `src/app/auth/callback/route.ts`.
- OTP confirmation: `src/app/auth/confirm/route.ts`.
- Sign-out: `src/app/auth/signout/route.ts`.
- Invitation/create user, profile, membership, role assignment and audit:
  `api/settings/users/invite` and onboarding personnel routes.
- Activation tokens, password assignment, expiry/use tracking, account update,
  membership activation and audit: `src/lib/tracepoint/activation.ts`,
  `/activate`, and settings activation/assign-password routes.
- Password-reset email: `api/settings/users/password-reset`.
- Auth Admin user lookup/list/update/create appears in armory identity joins,
  notification delivery, onboarding, activation and user administration.
- Client-side inactivity enforcement is implemented by
  `src/app/components/IdleSessionGuard.tsx`; Supabase refresh/session lifetime is
  otherwise provider-managed.
- No repository evidence of MFA enrollment/challenge was found.

User IDs are Supabase Auth UUIDs and are foreign-key identities throughout
`profiles`, memberships, assignments, audit actors, notification recipients,
training, qualifications and workflows. They must be preserved as an immutable
application subject ID even if Cognito receives a different `sub`.

## PostgreSQL surface

The repeatable source inventory (`scripts/inventory-supabase-access.mjs`) scans
200 first-party TypeScript files and records 478 `.from`, 65 `.rpc`, and 39 Auth/
session/Admin calls. Of 543 data calls, 24 are browser-side and 483 are statically
associated with service-role contexts. See `aws-data-access-inventory.md` and the
generated `aws-supabase-access-inventory.json`; these are static evidence, not
runtime authorization proof.

The 52 ordered migration files define at least:

- **66 tables**, including departments, profiles, membership/role/permission
  tables, firearms/assignments/inspections, personal/off-duty firearms,
  qualifications/range days, equipment, fleet, agency training, notifications,
  activation tokens and two audit stores.
- **3 views:** `v_active_firearm_assignments`,
  `v_latest_qualification_results`, `v_range_day_summary`.
- **31 functions/RPCs**, including authorization predicates, role assignment,
  department creation/seed, off-duty workflows, audit writers, equipment
  assignment normalization, training closeout/reopen and firearm audit updates.
- **46 triggers**, notably `on_auth_user_created` on `auth.users`, immutable
  audit controls, audit writers, timestamp maintenance and assignment history.
- **89 named indexes**, including partial/unique workflow invariants.
- **143 statically declared RLS policies** (one dynamic helper-generated policy
  name is also present).
- Extension `pgcrypto` for cryptographic/database UUID functionality.

The source of truth is `supabase/migrations/`, not only generated
`database.types.ts`. Compatibility validation must include `auth.uid()`,
`auth.role()`, `auth.users`, security-definer functions, PostgREST RPC conventions,
`pgcrypto`, PL/pgSQL, trigger ordering, partial indexes and RLS policy semantics.

## Tenant isolation and privileged access

Tenant scope is `department_id`, reinforced by RLS predicates that call
`is_department_member`, `is_active_department_member`,
`has_department_permission`, `has_any_department_permission`,
`has_department_role` and `is_platform_admin`. Platform administration is held
separately in `platform_admins`; configurable roles are represented by
`roles`, `permissions`, `department_membership_roles` and
`department_role_permissions` rather than fixed JWT groups.

RLS is not the only control. Many API routes call `getServerAccessContext`, then
use the service-role admin client. Those operations bypass RLS and depend on
correct application checks plus explicit `.eq("department_id", ...)` filters.
This is a major migration test surface: every privileged route needs negative
cross-agency tests before and after provider conversion.

## Storage

Two Supabase buckets are evidenced:

- `tracepoint-attachments`: firearm attachments, qualification evidence and
  agency-training files. Object metadata is stored in the `attachments` table;
  paths are generated server-side, uploads use `upsert: false`, failed metadata
  inserts remove the just-uploaded object, and downloads use 60-second signed URLs.
- `department-assets`: department patch image upload/removal; the department row
  stores the object path/public reference used by the UI.

No Realtime channel, `postgres_changes` subscription, or client event stream was
found. Storage operations are request/response. Malware scanning, quarantine,
explicit object retention and orphan reconciliation are not currently evidenced.

## Audit, notifications and background behavior

`audit_events` and legacy `audit_log` capture actor IDs, departments, entities,
actions and details. Database triggers and application helpers both write audit
records; some handlers compensate/rollback the primary write if auditing fails.
Actor attribution depends on Supabase Auth UUIDs and sometimes elevated admin
lookups.

`notification_events`, `notification_preferences` and
`notification_email_queue` form a database-backed notification engine. The
internal `api/notifications/email-dispatch` route authenticates with
`NOTIFICATION_DISPATCH_SECRET`, reads queued rows, sends through Brevo and marks
delivery state. No external scheduler definition is present in this repository;
the caller/schedule is an operational dependency that must be discovered before
cutover. Notification helper modules query data using the admin client.

## Environment variables

| Variable | Classification | Consumers |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public build/runtime configuration | all client factories |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public credential | browser/server/proxy factories |
| `SUPABASE_SECRET_KEY` | secret, preferred privileged key | admin factory |
| `SUPABASE_SERVICE_ROLE_KEY` | secret, legacy fallback | admin factory |
| `BREVO_API_KEY` | secret | activation and email dispatcher |
| `NOTIFICATION_DISPATCH_SECRET` | secret | internal dispatch route |

## Migration order implied by code

1. Freeze/validate schema inventory and tenant authorization tests.
2. Introduce subject/authorization contracts while Supabase remains authoritative.
3. Encapsulate privileged data access by bounded domain, starting with low-risk
   read paths; the imported qualification-history pilot is the first completed
   repository. Do not replace all PostgREST calls mechanically.
4. Migrate object storage behind server-only contracts and reconcile metadata.
5. Rehearse PostgreSQL migration with RLS and Auth compatibility shims.
6. Add Cognito coexistence with an immutable application-subject mapping.
7. Cut Auth only after database/RLS and every admin-bypass route can authorize
   independently of Supabase JWT helpers.

## Inventory limitations

This is source-backed, not live-state-backed. Dashboard-created SQL, storage
policies/buckets, Auth settings/templates/providers, scheduled jobs, database
extensions, database grants, and migrations applied outside the repository must
be exported as metadata after approved non-production credentials exist.
