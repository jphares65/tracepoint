# SES suppression provenance correction

The disabled persistent SES feedback adapter now preserves an explicit OptOut
reason and its provenance when later bounce or complaint events arrive. A later
bounce also preserves the event that originally caused Complaint suppression.
All feedback remains recorded idempotently; no event can unsuppress the recipient.

Seven focused PostgreSQL-backed tests pass, including the two new out-of-order
cases, existing recipient correlation, tenant ownership, duplicate handling and
browser-role denial. TypeScript and changed-file lint pass. No migration was
needed, and no deployed provider selection changed; Brevo remains operational.

Two initial runs passed all assertions but failed in the embedded PostgreSQL
library's Windows directory deletion. The harness now owns deletion after process
shutdown, checks the exact temporary path, retries transient file locks and
verifies directory absence. Both named leftovers were removed and verified absent;
the final test run completed cleanup successfully. No RLS change was made.

SES remains disabled pending real sender/DNS prerequisites, live delivery and
trusted persistent feedback-worker activation. This correction earns no additional
weighted migration credit; readiness remains **66.50%**.
