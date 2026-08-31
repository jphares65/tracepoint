# TracePoint module migration matrix

**Basis:** static route/module and migration inventory on 2026-08-30. `AWS target`
means a design target, not an existing resource. Supabase remains active.

| Module / routes | Current dependency | AWS target | Difficulty | Primary security risk | Required tests | Dependencies / sequence |
|---|---|---|---|---|---|---|
| `src/proxy.ts`, `lib/supabase/proxy.ts` | Supabase claims/cookies/RPC/RLS | Cognito verifier + authorization service | Very high | route or tenant bypass | cookie refresh, unauthenticated, wrong-agency, platform isolation | Last Auth phase; claims model first |
| Login, `/auth/*`, `/activate` | Supabase password, OTP, PKCE, activation | Cognito user pool/coexistence adapter | Very high | takeover/session fixation | invite, activate, reset, replay, expiry, rollback | Subject mapping + email first |
| Settings users/onboarding personnel | Auth Admin + profiles/memberships/RPC | Cognito admin adapter + Aurora transactions | Very high | privileged user creation/role escalation | authorization negatives, partial-failure compensation, audit | Claims and DB transaction design |
| `lib/tracepoint/server-access.ts` | user lookup + membership/permission DB + service role | Provider-neutral access context | Very high | service-role RLS bypass | every permission, inactive membership, support mode, cross-tenant | First authorization boundary |
| Platform routes/pages (`/api/platform/*`, `/api/super-admin`) | platform RPC/tables/admin | Cognito + Aurora isolated platform policy | Very high | platform/agency boundary collapse | non-platform denial, support-mode attribution | Separate claims and operational roles |
| Armory firearms/assignments/inspections/ammunition | PostgREST, RPC, Auth Admin joins, RLS | Aurora PostgreSQL repository | High | firearm/personnel exposure | CRUD, concurrency, tenant negatives, audit rollback | DB/RLS before client conversion |
| Personal/off-duty firearm routes | PostgREST + workflow RPCs/RLS | Aurora PostgreSQL functions/repositories | High | owner/reviewer scope error | workflow state machine, serial uniqueness, cross-tenant | Function compatibility first |
| Qualifications/range/readiness/training | PostgREST, views, RLS, attachments | Aurora + S3 | High | evidence exposure, stale qualification | calculations, history, signed URL, tenant negatives | DB then storage |
| Agency training routes | PostgREST, closeout RPCs, Storage | Aurora + S3 | High | roster/certificate disclosure | closeout atomicity, generated certificate, file rollback | DB functions + storage |
| Equipment routes | PostgREST, assignment triggers/RLS | Aurora PostgreSQL | High | assignment history corruption | uniqueness, trigger equivalence, audit, tenant negatives | Trigger validation |
| Fleet routes | PostgREST, audit helpers, document metadata | Aurora + later S3 | High | fleet document leakage | state/odometer rules, audit, tenant negatives | DB then documents |
| Notifications/preferences | DB queue + admin queries | Aurora; later SQS/EventBridge optional | High | cross-user notification or spoofing | recipient isolation, dedupe, retries, audit | Keep DB queue initially |
| `/api/notifications/email-dispatch` and activation sender | DB queue/token + shared secret + typed Brevo provider | Brevo retained; SES is design-only | Medium | forged dispatch/replay, PII logs | provider request/error tests; queue/auth parity remains covered by build/type checks | Email boundary complete; no SES activation |
| Audit/export routes and helpers | `audit_events`, `audit_log`, actor UUID | Aurora + central immutable log export later | Very high | missing/altered audit trail | append-only, actor/agency, export authorization | Subject ID strategy first |
| `tracepoint-attachments` flows | typed server-only `ObjectStore` + Supabase Storage + attachments metadata | S3 remains design-only | High | service-role signing, object-key tenant escape, retained archive objects | path/upsert/signing/config tests pass; route/cross-agency and orphan-reconcile tests remain | Supabase adapter complete; no AWS provider |
| Department patch | typed server-only `ObjectStore` + public `department-assets` | S3 remains design-only | Medium | public retained assets, route/bucket size mismatch | image/path/upsert/public URL/rollback tests; replacement cleanup remains | Supabase adapter complete; remediation needed before any provider work |
| Browser direct queries (`page.tsx`, settings panels, shell) | Browser Supabase + RLS | Server API/repository boundary | Very high | removing RLS exposes tenants | response parity, auth expiry, tenant negatives | Convert last, endpoint-by-endpoint |
| Pilot/import/onboarding routes | Admin PostgREST bulk operations | Aurora transactional import service | Very high | mass cross-tenant write | dry run, idempotency, rollback, row errors, audit | Dedicated import boundary |
| Database migrations | Supabase PostgreSQL/RLS/auth schema | Aurora PostgreSQL migrations | Very high | silent policy/function mismatch | clean apply, upgrade, rollback, schema diff | Before any data rehearsal |

## Route-level disposition

All current routes are internal application routes except `/api/health`; none is
approved as a public integration contract. The following exhaustive families
cover every handler under `src/app/api`:

- Access/context: `/api/access`, `/api/active-department`, `/api/health`.
- Agency training: courses, course detail, events, event detail, certificates,
  closeout, files, report, roster, instructors, requirements.
- Armory: ammunition/reconciliations, firearms/detail/archive/assignments/
  attachments/restore/status, inspections, personal-rifles/detail/inbox/rules.
- Attachments: metadata detail and signed download.
- Command dashboard operations.
- Equipment: assets, requirements, types.
- Fleet: rules, vehicles/detail/documents/equipment/inspections/work-orders.
- Notifications: events, preferences, internal email dispatcher.
- Off-duty firearms: collection, detail, inspections.
- Pilot/import: ammunition, performance summary, personnel, range workspace,
  remediations.
- Platform: agencies, agency-user administrator, support mode, super-admin.
- Qualifications/evidence and readiness certifications/equipment.
- Settings: audit/export, certification capabilities, rules, data exports,
  department patch, off-duty rules, all onboarding handlers, overview, and all
  user lifecycle handlers.
- Training: certification requirements/types/certifications/detail.

Each non-health route requires authentication/authorization, tenant-negative,
error-contract and audit-attribution tests before provider conversion. Routes
using the admin client additionally require proof that every query is scoped by
the resolved department or explicit platform authorization.

## Recommended conversion waves

1. Contracts and observability only; zero call-site behavior change.
2. Email delivery adapter while retaining Brevo.
3. Server-only object-storage adapter while retaining Supabase Storage.
4. Read-only bounded repositories with parity tests.
5. Transactional domain writes and audit coupling.
6. Browser direct-query removal.
7. Auth/session coexistence and cutover last.
