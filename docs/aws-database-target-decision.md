# AWS database target decision

## Decision

Retain Supabase PostgreSQL through the first AWS hosting release. For a later
database migration, use **Aurora PostgreSQL (serverless capacity)** as the
primary target. Provisioned RDS PostgreSQL is the credible low-cost alternative
for continuously active staging and predictable small production workloads.

This is a PostgreSQL migration, not a greenfield choice: the repository depends
on PL/pgSQL functions, triggers, views, partial/unique indexes, `pgcrypto`, RLS,
security-definer functions and `auth.*` integration. Aurora PostgreSQL preserves
the broadest required surface. A distributed SQL refactor is excluded because
the current stored procedures/triggers are required.

## Comparison

| Option | Fit | Low-volume cost posture | Decision |
|---|---|---|---|
| Retain Supabase | zero initial data/Auth cutover; current RLS/PostgREST intact | no incremental AWS DB charge; existing vendor plan continues | Initial staging |
| Aurora PostgreSQL serverless | strongest PostgreSQL compatibility plus elastic capacity/managed HA | active minimum capacity can cost materially more than a tiny single instance; storage/I/O/backups additional; pausing behavior and minimum ACUs must be verified at provisioning time | Eventual primary target |
| RDS PostgreSQL provisioned | exact managed PostgreSQL engine, simple cost model | a small single-AZ burstable staging instance plus storage is often cheaper than continuously active Aurora; Multi-AZ production roughly increases compute footprint | Staging alternative / production if steady-small |

Planning ranges only: a small single-AZ RDS instance and 20 GB storage is
commonly in the low tens of USD/month; continuously active Aurora at 0.5 ACU is
commonly several tens/month before storage/I/O. Current `us-east-1` pricing,
engine-version eligibility, minimum capacity, pause/resume behavior and support
requirements must be recalculated with the AWS Pricing Calculator before
approval. Retaining Supabase avoids duplicate DB cost during hosting migration.

## Target by stage

- First AWS staging: Supabase remains authoritative.
- Migration rehearsals: isolated Aurora PostgreSQL serverless test cluster using
  synthetic or approved staging-only export; never production/live data here.
- Eventual production: Aurora PostgreSQL with at least two AZs if workload and
  recovery requirements justify it. Choose provisioned Aurora/RDS instead if
  measured steady load makes serverless less economical.

## Transfer risks

Validate PostgreSQL version, `pgcrypto`, `citext`/other live-only extensions,
PL/pgSQL, partial indexes, generated/default expressions, trigger order,
security-definer `search_path`, grants, sequences, RLS and `auth.uid()`/
`auth.role()` dependencies. Supabase-managed `auth.users`, Storage metadata,
PostgREST RPC/error behavior and dashboard-created objects do not transfer as
ordinary application schema without explicit replacement.

The 2026-08-31 source inventory adds concrete coupling evidence: 543 static data
calls across 87 distinct targets, 65 RPC calls, 24 browser data calls, 106
`auth.uid()` occurrences, and 38 `security definer` declarations. This reinforces
Aurora/RDS PostgreSQL compatibility as the eventual target and rules out a bulk
ORM or generic repository rewrite. It does not alter the decision to retain
Supabase for initial staging.

## Approval evidence required

Live metadata-only schema export, database size/growth, peak connections/TPS,
extension list, PostgreSQL version, recovery objectives, maintenance window and
measured staging duty cycle. The decision must be revisited if an extension is
unsupported or the workload is consistently active and small enough that
provisioned RDS is materially cheaper.
