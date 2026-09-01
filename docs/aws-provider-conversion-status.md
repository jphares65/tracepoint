# Provider conversion status

| Boundary | Current implementation | Converted call sites | Status / proof needed |
|---|---|---:|---|
| Auth | Supabase browser/server/proxy/admin | 0 | designed; cookie/account lifecycle contract tests required |
| Authorization | Supabase RPC/RLS + `server-access` | 0 | highest risk; cross-agency matrix required |
| Data | fifteen tenant-bound server repository callers; Supabase otherwise direct and authoritative | 38 provider reads across 15 GET paths | exact tenant/filter/field/order/limit/visibility/permission/aggregation contracts and negative tests pass; no Aurora/RDS provider exists |
| Storage | typed server-only `ObjectStore`; Supabase sole implementation/default | 5 storage call sites | all direct route storage calls converted; signed downloads validate authorized department/canonical path; no AWS provider exists |
| Email | typed server-only `EmailProvider`; Brevo sole implementation/default | 2 | both inventoried callers converted; focused request/config/error tests pass; no AWS provider exists |

The activation and queued-digest callers now share a typed server-only transport
boundary. Sender, recipients, subject/body generation, Brevo endpoint/headers,
provider message ID, activation error wording, digest retry calls, queue state,
and failure behavior are preserved. `TRACEPOINT_EMAIL_PROVIDER` defaults to
`brevo`; any other value fails closed at first server-only construction.
Supabase and Brevo remain authoritative, and no dormant flag can activate an AWS
implementation because none exists.

Focused Node tests cover the Brevo payload/headers, message ID, provider response
error, incomplete configuration, and unsupported-provider rejection. The next
safe sequence remains storage characterization, then bounded read-only domain
repositories; Auth and authorization stay last.

The storage conversion covers qualification, agency-training and firearm uploads,
the shared signed-download route, and department patch upload/public URL/rollback.
The boundary has domain-specific methods only; bucket names are fixed internally.
Focused tests prove the existing key formats, filename normalization, `upsert`
values, 60-second download, download filename, public URL, compensation removal
bucket and unsupported-provider rejection. Direct Supabase database metadata,
authorization, RLS/RPC behavior and the service-role privilege level remain
unchanged. See `aws-storage-contract-inventory.md` for exact risks and evidence
gaps; notably archive does not delete bytes, patch replacement retains old public
objects, compensation is best effort, and the repository does not evidence the
`tracepoint-attachments` bucket definition.

The first data pilot converts only `GET /api/qualifications` imported history to
`QualificationHistoryRepository`. Supabase remains the sole/default provider.
The repository requires an authorized department at construction and as explicit
input, selects the same fields, applies the same department and origin filters,
orders by qualification date descending, maps null data to an empty list, invokes
no mutation method, maps provider errors to a stable non-leaking 500 message, and
rejects unsupported providers. The deterministic source inventory still records
543 data calls; the selected direct route call moved behind the repository rather
than disappearing from the Supabase implementation.

Waves 2 and 3 add current department rules, certification types, the
agency-training course catalog, and three equipment GET paths. The equipment
boundary covers five reads, preserves self-only asset visibility for users
without department-wide permission, and denies missing/mismatched department or
user context before provider access. Nine of 543 static data calls are now behind
production repository boundaries; Supabase remains sole/default.

The settings-overview wave moves ten direct reads behind a tenant-bound boundary:
department, rules, permission-gated security settings, role and permission
catalogs, department role permissions, and the four support-mode membership
aggregation reads. The production route retains `resolveServerAccess`, the
`manage_users`/`administer_department` gates, support-mode branching, and the
authorization-sensitive `get_department_members` RPC. Cross-tenant input is
rejected before provider access; security and member reads are skipped when the
existing permissions do not allow them. Nineteen of 543 static data calls are now
behind production repository boundaries; Supabase remains sole/default.

The readiness wave adds ten reads across the equipment and certification
readiness GET handlers. Their production callers retain the existing feature and
permission gates; the tenant-bound core rejects mismatches before provider I/O,
preserves equipment self-only visibility, profile fallbacks, empty results, and
the existing readiness aggregation response shapes. Twenty-nine of the current
551 static data calls are now behind production repository boundaries.

The Agency Training read wave adds four provider reads across the instructors,
requirements, and events GET handlers. It preserves the instructor display
fallbacks and sorting, requirement course relation and ordering, event aggregate
mapping, and each route's existing permission-derived response. All colocated
mutations remain direct and behaviorally unchanged. Thirty-three of 551 static
data calls are now behind production repository boundaries.

The first Armory read checkpoint adds five reads across firearm inventory and
inspection history. Department-wide versus assigned-user visibility, archived
filtering, active assignment/member mapping, access flags, inspection joins,
ordering, limits, and provider errors are preserved. Thirty-eight of 551 calls
are behind production repository boundaries; Armory mutations remain direct.
