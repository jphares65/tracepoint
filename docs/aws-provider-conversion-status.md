# Provider conversion status

| Boundary | Current implementation | Converted call sites | Status / proof needed |
|---|---|---:|---|
| Auth | Supabase browser/server/proxy/admin | 0 | designed; cookie/account lifecycle contract tests required |
| Authorization | Supabase RPC/RLS + `server-access` | 0 | highest risk; cross-agency matrix required |
| Data | Supabase PostgREST/RPC | 0 | domain repositories not generic adapter |
| Storage | Supabase Storage | 0 | five route groups inventoried; parity/orphan tests required |
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
