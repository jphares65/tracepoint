# Remediation DC: AWS-native calendar-date contract

Base: `claude/integration-defects-20261020`. Found during B6 and confirmed here.

## Defect (Critical where AWS-native is live)

- **What happens:** the AWS-native PostgreSQL client (`src/lib/database/postgres-pool.ts`) keeps the provider (PostgREST/Supabase) contract for `int8` and `numeric` through `postgresRuntimeTypes`. It has no rule for `date` (OID 1082), so `pg` turns every `date` column into a JavaScript `Date` at local midnight.
- **Why it breaks:** web code written against Supabase expects `YYYY-MM-DD` text. A `Date` makes calendar logic fail, and in JSON it becomes `2028-03-01T00:00:00.000Z`.
- **Effect:** a certification valid until 2028 is evaluated as **expired**, with no expiration date. That drives My Home and inbox alerts and readiness views. With scheduled generation (B6) it would also email a false Critical alert to every member.
- **Other readers:** any reader that builds `${value}T00:00:00` or displays the value is likely affected too. Examples: fleet due-date alerts, training records, qualification history.

## Fix

- One rule, next to the existing contract parsers: `date` text is returned unchanged (`YYYY-MM-DD`), exactly as PostgREST returned it before the cutover.
- `timestamptz` is unchanged.

## Verification (local; no remote systems)

**Real PostgreSQL 16** with the app's `postgresRuntimeTypes`, feeding the real `evaluateCertificationReadiness`:

| | Driver value | Readiness for a credential expiring 2028-03-01 |
|---|---|---|
| Before (integration head) | `"2028-03-01T00:00:00.000Z"` (object) | **expired**, expirationDate `null` |
| After | `"2028-03-01"` (string) | **current**, 498 days remaining |

**Other checks:**

- Unit test `postgres-type-parsers.test.ts`: the new test fails before the fix and passes after.
- `tsc`: clean.
- App tests: 630/634. The 4 failures are the sandbox xlsx stub; CI runs the real package.

## Owner decision / compatibility

- **Contract change for the native client:** `/api/mobile/*` responses now carry `date` fields as `YYYY-MM-DD` instead of an ISO midnight timestamp. This is the pre-cutover web contract, but the native client was built against AWS-native staging. **Confirm the native client parses `YYYY-MM-DD`** (staging S2–S5) before deploying.
- **Production impact:** if production is AWS-native, this defect is likely live now. Check: open My Home for a user who has a current certification with an expiration date.
- **B6 interaction:** B6's narrow `calendarDate` normaliser still accepts strings, so it is harmless alongside this fix. It can be removed in a later clean-up.

## Rollback

Revert the commit and redeploy the image. There is no schema or data change.
