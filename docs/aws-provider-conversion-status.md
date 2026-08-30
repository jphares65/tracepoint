# Provider conversion status

| Boundary | Current implementation | Converted call sites | Status / proof needed |
|---|---|---:|---|
| Auth | Supabase browser/server/proxy/admin | 0 | designed; cookie/account lifecycle contract tests required |
| Authorization | Supabase RPC/RLS + `server-access` | 0 | highest risk; cross-agency matrix required |
| Data | Supabase PostgREST/RPC | 0 | domain repositories not generic adapter |
| Storage | Supabase Storage | 0 | five route groups inventoried; parity/orphan tests required |
| Email | two direct Brevo REST callers | 0 | first candidate; retry/error/body snapshot tests required |

No behavior, provider configuration or call site was changed. Supabase and Brevo
remain authoritative. No dormant flag can activate an AWS implementation because
none exists. Recommended conversion sequence: characterize Brevo responses;
adapterize both sends; storage attachment adapter; department patch; read-only
repositories; writes/audit; browser queries; Auth last.
