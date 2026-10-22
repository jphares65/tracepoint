# Independent review of 3177a83 (third round)

Read-only; proofs in `proofs.test.ts.txt` (each asserts the faulty behaviour). All 3 passed against `3177a83` (`proofs-before.txt`).

- **P1 (High).** The R2-M1 rule "an edit to a conflicted record decides it" compared whole records. A batch save rebuilds every prefilled officer's result on that drill and run, re-stamped with the current instructor. A conflicted score's record therefore changed, the conflict was dropped, and this device's value (held only in the conflict) was lost. After an unforeseeable refusal, where every unsynced change is held back, one batch save wiped the held-back edits on that drill and run.
- **P2 (Medium).** For the same reason, editing any field of a conflicted range day (for example adding an instructor) discarded this device's value for a different field (for example the AAR).
- **P3 (Medium).** Drill removal set the drill list from the list captured at click time, overwriting drill changes, or a recovery, made while the DELETE was in flight.
- **Low.**
  - L-a: the unsuffixed `tracepoint.rangeDays.device.v2` key from unreleased intermediate builds is not read.
  - L-b: a narrow race at the end of recovery.
  - L-c: a legacy or unknown-agency conflict could replace a real one on the same record.
  - L-d: an unknown-agency record is unread once a last-agency pointer exists (harmless today).
- **Checked and sound:**
  - normalization;
  - hold-back after refusal (no loops; it survives reload);
  - malfunction remapping;
  - drill-removal versioning and the epoch;
  - per-user and per-agency isolation;
  - the preview's agency check.
