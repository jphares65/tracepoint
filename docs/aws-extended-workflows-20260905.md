# Extended live staging acceptance

The disposable harness now exercises off-duty submission/inspection/command approval/Inbox, fleet creation/inspection/report, training course/event/roster/CSV, armory creation/assignment/inspection/return, certification creation, and browser personnel CSV download. It tests officer write denial and foreign department access. The release wrapper requires these scenarios. Test identities and CSV contents stay in memory; cleanup removes children before audited parents and verifies no fixtures remain.

Live discovery found three real defects: missing armory runtime columns in the clean migration history; the absent department_certification_capabilities policy table; and certification handlers calling auth.uid-based permission RPCs through a service credential. Migrations 63/64 repair the schema with no RLS relaxation or agency rules seeded. The armory migration refuses legacy data conversion without an explicit reviewed mapping. Certification routes now use the authenticated server permission context.

Before the repair release, live fleet operations, training roster/CSV, browser personnel CSV, range protections and private document delivery passed. Failed runs also verified cleanup. Off-duty inspection returned 500 for the missing capability table; armory creation returned 500 for missing columns; certification type creation returned 403 because of the wrong permission context. These failures remain recorded until the repaired image passes live acceptance.

Validation: 64 clean PostgreSQL migrations, real armory SQL writes, capability member-read/client-write denial and cross-tenant foreign-key rejection; 158 application tests; TypeScript and configured Next production build. Changed route lint reports three existing any annotations, with no newly introduced lint errors.

Recovery run 1f7632ef-d8e8-4d0b-8df4-9c710cff3265 validated one-time Supabase recovery token exchange, password replacement, new-password login, rejected token replay and global refresh-token revocation. Cleanup passed. The token was generated server-side for a disposable account; recovery email delivery and the browser recovery UI are not claimed.

Run: `node --import tsx scripts/run-disposable-staging-acceptance.mjs --execute --range-documents --extended-workflows` with the gated staging AWS profile and installed Playwright Chromium. No acceptance credentials are required from the user.
