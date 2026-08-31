# Provider conversion status

| Boundary | Current implementation | Converted call sites | Status / proof needed |
|---|---|---:|---|
| Auth | Supabase browser/server/proxy/admin | 0 | designed; cookie/account lifecycle contract tests required |
| Authorization | Supabase RPC/RLS + `server-access` | 0 | highest risk; cross-agency matrix required |
| Data | Supabase PostgREST/RPC | 0 | domain repositories not generic adapter |
| Storage | typed server-only `ObjectStore`; Supabase sole implementation/default | 5 storage call sites | all direct route storage calls converted; bucket/path/upsert/signing/config tests added; route authorization and DB behavior unchanged; no AWS provider exists |
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
