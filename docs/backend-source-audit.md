# TracePoint backend source audit

## What the current prototype is doing

The uploaded source confirms that TracePoint currently uses three browser-local workspaces:

| Current browser storage | Current purpose | Database destination |
|---|---|---|
| `tracepoint.rangeDays.workspace.v1` | Range days, drill library, rosters, scoring, malfunctions | `range_days`, `drill_templates`, `range_day_roster`, `range_day_drills`, `drill_run_results`, `firearm_malfunctions` |
| `tracepoint-off-duty-workflow-v1` | Off-duty firearm requests and approval state | `off_duty_firearm_requests`, `off_duty_request_actions` |
| `tracepoint-inbox-v1` | Officer and chief notifications | `inbox_items` |

## Important inconsistencies resolved by the schema

1. **Two separate range-day type systems existed.**  
   `types.ts` and `range-day-types.ts` both defined Range Day records. The database now establishes one authoritative model.

2. **Roles were inconsistent.**  
   The prototype used `Admin`/`Command` in one file and `Administrator`/`Command Staff` in another. The backend uses stable role codes and allows one person to hold multiple roles.

3. **Scoring was split between two concepts.**  
   `ScoringMode` supported four values, while the current Range page added Qualification, Points, Time, Hit Count, Completion, Pass/Fail, and Notes Only. The backend uses one `scoring_format` enum containing all seven modes.

4. **Array fields needed normalization.**  
   Instructor IDs, roster firearm IDs, and malfunction IDs were stored as arrays. These are now relationship tables or direct foreign keys.

5. **The current user is hard-coded.**  
   `current-user.ts` remains useful for the prototype, but Supabase Auth and department memberships will replace it.

6. **Cross-module analytics are currently reconstructed in each page.**  
   The database provides normalized records and initial views so Home, Command Dashboard, Qualifications, Firearm History, and Analytics can query the same source of truth.

## Migration order

1. Establish Supabase project, schema, RLS, and Auth clients.
2. Add sign-in and create the Readington department membership.
3. Migrate Range & Training reads/writes.
4. Connect Qualifications and Firearm History to the same data.
5. Migrate Off-Duty workflow and unified inbox.
6. Replace prototype current-user logic with authenticated profile and permissions.
7. Add pilot data import and acceptance testing.
