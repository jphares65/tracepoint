# Integration branch: claude/integration-defects-20261020

This branch is for integration and testing only. Nothing on it is deployed, no migrations have been applied anywhere, and it is not merged to `main`.

## Source commits

| Batch branch | Commit |
|---|---|
| `claude/fix-b0-proof-foundation` | `a39d26329397cd4dddb7018ae72b9b53e1a22c53` |
| `claude/fix-b1-account-access` | `705b540495de091e3f283016eca63cb9c13d10d3` |
| `claude/fix-b1a-reimport-safety` | `6626da75c17afd4de2da5194383f0926ad331d50` |
| `claude/fix-b2-field-write-authorization` | `b5976f4e19db24e243840fd8e208f3d1dd25fcd7` |
| `claude/fix-b3-range-save-integrity` | `6ff687f2ad4978fd79b7135728bb2e0fbd9b1980` |
| `claude/fix-b4-fleet-integrity` | `f43dc42c8c591653010d16a0ac357066ff5104af` |
| `claude/fix-b5-qr-resolve` | `df849ed9bdd12f1a016af9b0a30f46842432bb64` |

Base: `claude/fix-b0-proof-foundation` (`a39d263`), which sits on `codex/staging-mobile-api-release-20261007` @ `555f061`. B1 (`705b540`) comes in through B1a, which is stacked on it.

## Conflict resolution

- The only textual conflicts were in `scripts/validate-clean-bootstrap.mjs`, during the B3 and B4 merges. They were resolved by keeping every AWS-stage assertion from both sides.
- The B2/B4 semantic conflict (the fleet override guard) was fixed in B2 before integration (`b5976f4`).

## CI

`application-quality.yml` also runs on pushes to `claude/integration-**`, so this branch is exercised on a GitHub runner with the real SheetJS package and non-root PostgreSQL. Results are recorded below as they arrive.
