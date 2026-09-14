# TracePoint Mobile V1 API Matrix

This contract is AWS-native only. Cognito access tokens are accepted as `Authorization: Bearer`; the server verifies signature, issuer, client, token type, lifetime, live Cognito state, and the active TracePoint identity link. `X-TracePoint-Department-Id` is only a requested context: PostgreSQL membership, RBAC, and RLS remain authoritative.

| Capability | API | Authority | Retry / storage behavior |
| --- | --- | --- | --- |
| Current session and agency selection | `GET /api/mobile/session` | Active Cognito identity link and active department membership | Read-only; returns `selectionRequired` for multiple memberships |
| Range Day summary | `GET /api/mobile/range-days/{rangeDayId}` | Range/qualification feature plus tenant membership | Read-only, no-store |
| Attendance | `POST /api/mobile/range-days/{rangeDayId}` with `attendance` | `manage_range_days` or department administration | Signed operation ID; idempotent replay; optimistic workspace revision |
| Roster add/remove | same endpoint with `add-roster` / `remove-roster` | `manage_range_days`; added officer must be an active member | History-bearing entries cannot be removed |
| Drill add/reorder/remove | same endpoint with `add-drill` / `reorder-drills` / `remove-drill` | `manage_range_days`; add copies an active server-side library template | Scored drills cannot be removed; exact-order validation |
| Score save/resume | same endpoint with `save-score` | `score_range_days`, `manage_qualifications`, or range management | Per-result idempotency, encrypted local retry queue, optimistic revision |
| Inspection evidence authorization | `POST /api/mobile/fleet/vehicles/{vehicleId}/inspections/{inspectionId}/evidence/initiate` | Inspector, configured inspection role, or granular Fleet permission | Exact type/size, unique object ID, 60-second S3 PUT |
| Inspection evidence confirmation | sibling `/confirm` endpoint | Same identity, tenant, vehicle, inspection, checklist item, and signed 120-second intent | S3 HEAD verifies size/type/tenant/object metadata; mismatch is deleted |
| Inspection evidence retrieval | `GET .../evidence/{evidenceId}` | Tenant membership plus granular Fleet view/management permission | Fresh 60-second S3 view URL; path is revalidated from server metadata |

Inspection media uses the existing `fleet_vehicle_inspections.checklist` JSON document. This avoids a new schema migration while preserving the existing Fleet RLS boundary. No bucket name, AWS credential, Supabase endpoint, or provider secret is exposed to the client.

Mobile range mutations deliberately do not use the older whole-workspace `PUT`. Each action is whitelisted, authorized independently, checked against finalized history, and committed only if the workspace revision is unchanged.
