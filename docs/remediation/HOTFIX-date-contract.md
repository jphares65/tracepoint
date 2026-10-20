# Hotfix candidate: AWS-native calendar-date contract

**Status: CANDIDATE ONLY. Not deployed and not authorized.**

| | |
|---|---|
| Branch | `claude/hotfix-date-contract-candidate` |
| Base | `555f061` (`codex/staging-mobile-api-release-20261007`) |
| Change | One rule in `src/lib/database/postgres-type-parsers.ts`, plus its unit test. Identical to `cec3235` on the integration branch. |

## Defect stage

| Stage | Status |
|---|---|
| Found | Yes. Code reading plus a real-PostgreSQL reproduction (credential valid until 2028 evaluates **expired**). |
| Fixed in code | Yes, on this branch and in integration (`cec3235`). |
| Validated in staging | **No** |
| Confirmed resolved in production | **No** |

## Is production affected?

Very likely, if production runs AWS-native, which is the strong inference from the repo evidence:

- Every candidate production commit (`2a92bcc`, `564ff78`, `8c4c032`), and the staging line `555f061`, has the identical `postgres-type-parsers.ts` (sha256 prefix `51b51ccaf2e8`) with no `date` rule.
- All four are ancestors of this branch's base, so the one-line patch applies identically to whichever commit is deployed.

Impact, from the static inventory in [DC-production-impact-inventory.md](DC-production-impact-inventory.md) (read from `8c4c032`; not executed against production):

| Area | Symptom |
|---|---|
| Certifications | Every held credential of an expiration-required type evaluates **expired**. This drives readiness, Command Dashboard counts and Critical My Home alerts. Those alerts are persisted and **queued as Pending emails**. The certifications page itself shows the opposite: everything looks current. |
| Off-duty carry | **Approvals are blocked (409).** Approved requests show Non-Compliant, with the inspection shown as "Overdue". |
| Equipment | Expired or overdue gear shows as current. Some readiness requests return 500. |
| Qualifications | Stored qualification results are ignored, which produces false "qualification missing" alerts and "Invalid Date" on screen. |
| Fleet | Dashboard lists are empty; vehicles show "Not scheduled"; alert text shows a long date string. |
| Other | Personal-rifle expiry alerts are suppressed. Certification re-import can create duplicates. CSV exports carry timestamps. Some displays are one day early in US time zones. |

## Read-only production checks for the owner

- **Prefer SQL.** Opening My Home is not read-only: it writes `notification_events` and can queue emails.
- **SQL Q1–Q9** are in the inventory, §4, wrapped in `BEGIN TRANSACTION READ ONLY … ROLLBACK`. The column names were checked against the tracked schema; production may differ.
- **Do not run the email dispatcher** until the Q3 results are reviewed. Queued rows for false "Expired" alerts would be sent.

## Hotfix vs. waiting for the full release

| Option | Pros | Cons / risks |
|---|---|---|
| **Minimal hotfix (recommended, subject to authorization and the steps below)** | One rule; no schema, migration or data change. Restores the pre-cutover (PostgREST) date contract that the web code was written for. The inventory found nothing that depends on receiving a `Date` (no `.getTime()`, `.toISOString()` or `instanceof Date` on date-column values). Writes are unchanged. Unblocks off-duty approvals and stops false Critical alerts and emails at once. Easy rollback (image). | Changes `/api/mobile/*` date fields from ISO midnight to `YYYY-MM-DD`; the native client must accept that (contract inventory C-items). Fleet alert fingerprints change once, so acknowledgements may reset and one new Pending email may be queued per fleet due-date alert. False certification and qualification alerts clear only when each user next loads My Home or `/notifications`. |
| Wait for the full integration release | One deployment, one native-client verification | Production keeps showing false Critical alerts and keeps blocking off-duty approvals until migrations 038–046, staging verification S1–S17 and your approval are complete. |

**Recommended sequence, if you authorize the hotfix:**

1. Run Q1–Q9 read-only in production and record the results.
2. Confirm the native client parses `YYYY-MM-DD` for the fields listed in the contract inventory, or accept the risk for those screens.
3. Build this branch through the existing native staging lane. Deploy to **staging**. Verify S17 plus an off-duty approval and the equipment readiness page.
4. Only with explicit production authorization: build the production image from the same reviewed SHA and deploy.
5. Afterwards: re-run Q2/Q3. Resolve or cancel the false Pending email rows before any dispatcher is enabled.

## Not covered by this hotfix

- **DC2 (new).** `timestamp` and `timestamptz` columns also arrive as `Date` objects. `command-operations.ts:36-40` accepts only strings, so the Command Dashboard's upcoming-training and training-attention lists are empty. This is tracked for the remediation release, not the hotfix. Changing timestamp parsing has a wider blast radius.

## Rollback

Redeploy the previous task-definition revision. There is no schema or data change.
