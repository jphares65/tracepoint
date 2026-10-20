# Security backlog: information disclosure

Updated 2026-10-20. This lists the information-disclosure findings that are still open after the integration batches (B0–B11, F1–F6b, TV, DC). Each item is kept here until it is fixed in code and validated in staging, or the owner closes it by decision. **B6 notification delivery stays a separately authorized change** and is not part of this backlog's remediation path.

| ID | Exposure | Who can see what | Current state | Next step |
|---|---|---|---|---|
| ADM-32 (residual) | Raw database and provider error text in API responses | Any caller who triggers a failure in about 63 API route files outside the eight admin files fixed by B11 (notifications included) | Partly fixed (B11) | Batch the remaining routes after B6 settles `notifications/route.ts`. `/api/settings/data` deliberately passes intentional SQL messages; review whether any carries data. |
| ARM-32 | Attachment list | Any agency member can list attachments across modules | Owner decision. TV (048) scoped qualification evidence only | Decide the visibility rule per module, then apply it in the API and DB as for TV |
| TV residual | `pilot_range_workspaces` JSON document | Member-readable at the database level; the API filters it to the caller's own entries | Documented. Only the application holds database credentials | Keep. Revisit if any non-application path to the database is added |
| RNG-28 residual | Drill library and drill documents | No feature check on the routes (training material, not officer records) | Not changed | Owner decision whether the feature gate should apply |
| B9 049 profiles read | Former members' profile rows (name, email, phone) | Holders of `manage_users`, `manage_equipment` or `administer_department` in the same agency | In integration (049), owner review pending | B8a is evaluating a narrow identity function instead; narrow 049 the same way if that is safe |
| B8 holder names | Holder names for armorers | `manage_firearms`-only armorers see "Unknown User" (under-disclosure, not a leak) | B8a in progress, with narrowly scoped identity fields | Validate in staging (S22a) |
| ADM-12 | CSV exports are not audited | Anyone with export rights can export without a trail | Deferred (missing capability) | Owner decision |
| NEW-ARM-E | QR existence disclosure | Fixed for bridge mode (F4, F6b). AWS-native was always tenant-bound | Fixed in code | Staging S4 |
| B6 secret comparison | Scheduler secret compared without constant time | Timing side channel on the scheduler endpoint | Fixed on `claude/fix-b6-notification-delivery`, **not in integration** | Ships with B6 after its separate authorization |
| ARM-04 | `update_firearm_with_audit` executable by PUBLIC on the Supabase projects | Anyone with the Supabase anon key, if those projects are live | Corrected on AWS-native (017) | Confirm the Supabase projects are retired or restricted |
