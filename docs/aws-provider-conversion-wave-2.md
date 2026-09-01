# Provider conversion wave 2 and staging readiness decision

**Date:** 2026-08-31
**Starting checkpoint:** `b5e1611`
**Evidence boundary:** repository source, deterministic static inventory, mocks, and local/offline validation only. No live provider or AWS evidence was used. Static signals do not prove runtime authorization defects.

## Inventory reconciliation

Two independent pre-change runs were byte-identical to the checked-in JSON (`ADF6E4...A7BE`). They contained 202 source files, 543 data calls (478 `from`, 65 RPC), 39 Auth calls, 87 targets, 24 browser and 519 server calls, 483 service-role-associated calls, and 193 service-role calls without a same-statement department filter. The older prose count of 200 files was stale.

After this wave the call totals remain 543/478/65/39/87/24/519. Six repository source/wrapper files bring the scanned source-file count to 208. Moving three calls out of routes changes static client attribution from 483 service-role/22 uncertain to 480 service-role/25 uncertain because the narrow core files intentionally do not import the admin-client constructor. The 193 review signals are unchanged. This attribution change is a scanner limitation, not a privilege change.

## Candidate evidence and disposition

| Candidate | Context and client | Query contract | Authorization and tenant behavior | Other behavior and risk | Decision |
|---|---|---|---|---|---|
| `GET /api/settings/current-rules` | settings; server service-role | `department_rules`; nine named fields; `department_id`; `maybeSingle`; no order/page | `resolveServerAccess` first; explicit department; admin bypasses RLS | No browser, audit, notification, storage, cleanup, cross-agency, support mode, or hidden workflow. Policy defaults are deterministic. | **Selected**; low risk with explicit default tests. |
| `GET /api/agency-training/courses` | agency training; server service-role | course/alias projection; department + active filters; usage descending then title ascending | `resolveServerAccess` first; explicit department; permission only affects returned `canManage` | Read has no side effect; `null` list becomes empty; no pagination. Colocated POST/cleanup workflow remains untouched. | **Selected**; low/medium nested-projection risk. |
| `GET /api/training/certification-types` | certifications; server service-role | `certification_types`; `*`; department; category then name | `resolveServerAccess` and feature gate first; explicit department | Empty list preserved; no read side effects. Colocated mutations/RPC permission checks untouched. | **Selected**; low risk. |
| `GET /api/equipment/types` | equipment; server helper (`db`, statically uncertain) | `equipment_types`; `*`; department; category then name | `getEquipmentServerContext`; explicit department; helper calculates manage permission | No GET side effects, but helper/client typing and response includes policy-derived `canManage`; colocated mutations. | Deferred: first characterize helper/client and permission response in a dedicated equipment wave. |
| `GET /api/settings/off-duty-rules` | off-duty settings; service-role | `department_rules`; five fields; department; `maybeSingle` | access plus feature gate; explicit department | Deterministic defaults, but same table as selected rules pilot and colocated PATCH. | Deferred: adds little new pattern value in this small wave. |
| `GET /api/fleet/rules` | fleet; service-role | `fleet_rules`; department; `maybeSingle` | access plus fleet feature/permission helpers | Large policy default normalization; PATCH performs upsert and audit. | Rejected: policy mapping and audit-adjacent mutation require a fleet-specific contract wave. |
| `GET /api/command-dashboard/operations` | dashboard; service-role | concurrent training-event and vehicle reads | access first; explicit department on both | Cross-context, clock-derived aggregates, missing-table fallback. | Rejected: violates one-context/simple-workflow criteria. |
| `evaluateCertificationCapability` | shared certification utility; service-role plus internal HTTP | capability read then fetches readiness API | explicit department and calling route context | Hidden multi-step, cookie forwarding, cross-route dependency. | Rejected: not a deterministic single repository read. |

Selected ranking was current rules, certification types, then course catalog on tenant simplicity, contract clarity, independent pattern value, and rollback isolation.

## Implemented contracts

- `CurrentRulesRepository.getCurrentRules`: exact nine-field projection, department equality and `maybeSingle`; the route retains every legacy fallback and numeric/null rule.
- `CertificationTypeCatalogRepository.listTypes`: exact wildcard projection, department equality, category/name ordering, and empty-list behavior.
- `CourseCatalogRepository.listActiveCourses`: exact nested-alias projection, department and `is_active=true`, usage descending/title ascending, empty-list behavior and response mapping (including aliases and `topics ?? []`).

Each Supabase implementation is sole/default, server construction is guarded by `server-only`, constructor and method both require the same authorized department, unsupported `TRACEPOINT_DATA_PROVIDER` values fail closed, provider messages are replaced by stable domain errors, and no interface exposes mutation, generic table/filter/RPC, SQL, or client access. Existing access/feature checks, success status/body, course `Cache-Control: no-store`, and mutation handlers remain unchanged.

## Prioritized service-role tenant review queue

These are review signals, not vulnerability findings. Grouping across all 193: settings 64, armory 23, agency training 23, notifications 12, training 12, fleet 12, off-duty 8, pilot 7, activation 6, platform 6, and smaller contexts 20. Most use `resolveServerAccess` or explicit Auth/RPC gates; same-statement detection misses earlier validation, linked-resource ownership, and RPC internals.

| Priority instance | Why review | Other source control evidenced | Likely classification |
|---|---|---|---|
| onboarding personnel `profiles`/membership upserts | Privileged identity + tenant membership creation | Auth user plus permission/platform RPCs precede writes | Architectural transaction/identity boundary |
| settings user invite profile/membership/role/group workflow | Auth Admin and several writes/notification/audit | permission RPCs and selected department precede workflow | Architectural atomicity and tenant linkage |
| activation token update + membership activation | Token can bridge identity and department | token/member lookups and activation checks exist | Procedural/architectural linkage review |
| firearm `update_firearm_with_audit` RPC | security-definer mutation semantics hidden from route scanner | access context and route resource checks exist | RPC/SQL architectural review |
| agency-training closeout RPC | multi-record close/audit/certificate semantics | route access and event ID validation exist | RPC transaction review |
| ammunition reconciliation item delete/insert | child rows lack same-statement department field | parent reconciliation is department-scoped earlier | Cross-resource linkage/static uncertainty |
| fleet work-order delete/reinsert workflow | child operation keyed by vehicle/work-order | vehicle read is department-scoped earlier | Cross-resource linkage/procedural review |
| off-duty submission/decision RPCs | high-impact transactional workflow | access, feature, request and permission checks occur | RPC/SQL architectural review |
| notification email queue claim/update | worker-like service-role processing is intentionally broad | dispatch secret and event department linkage exist | Operational boundary review |
| auth setup `create_department_with_owner` RPC | creates tenant and owner in one privileged action | authenticated user/setup eligibility checks exist | Onboarding architecture review |

Human review should trace trusted department derivation through every linked key and inspect retained RPC SQL, grants, ownership, fixed `search_path`, audit atomicity, and deny behavior.

## Browser query migration plan

All 24 calls occur in four locations: `TracePointShell.tsx` (1 department read), `app/page.tsx` (3 profile/membership/role reads), `RangeQualificationRulesPanel.tsx` (rule read + upsert), and `settings/page.tsx` (17 calls: four reference/standards reads, six direct mutations, three department/settings mutations, and four membership/role/group RPCs). Every call is browser-user/RLS-coupled; none is converted here.

First server-API wave: (1) shell department display read, (2) landing profile + membership + roles as one authenticated bootstrap contract, (3) range qualification rules GET, (4) settings titles/units/groups reference bundle, and (5) qualification standards/components read bundle. Contract tests must cover identity-derived department binding, permission/feature denial, exact fields/order/defaults, empty/null/not-found behavior, cross-tenant rejection, stable errors, cache policy, and proof no mutation is exposed. A later mutation wave must characterize RPC authorization, optimistic UI, conflicts, audit, atomicity, idempotency, and RLS defense in depth before removing browser access.

## Minimum viable staging slice and gates

The safe first slice remains ALB-only HTTPS to one public-IP Fargate task in two public subnets, ECR immutable image, ECS cluster/service/task definition, ALB/target group/security groups, retained KMS key, retained JSON application secret, and CloudWatch log group. Supabase remains database/Auth/Storage and Brevo remains email; outbound HTTPS is therefore required. No production data, production DNS, Aurora/RDS/Cognito/S3/SES provider, CloudFront, WAF, or account-wide security service is part of the slice.

Required runtime/build inputs are staging-only Supabase URL/publishable key/secret key, Brevo key, notification dispatch secret, site URL, deployment version, and the same protected Server Action encryption key at build and runtime. Use a new synthetic Supabase staging tenant with synthetic users, rules, certification types, courses and qualification history; never copy agency records.

**Must resolve before any deployment:** dedicated member-account identity evidence for `559054714699`; CDK bootstrap with approved qualifier/boundary/execution policy; platform-owned exact-name ACM certificate; retained secret created/populated without exposure; immutable image built/scanned/pushed with staging public values and protected build secret; real image tag/certificate inputs; least-privilege builder/deployer roles; reviewed real synth/diff; explicit cost approval/budget alarm; confirmation no production values/data; and ownership of public ingress. Account/environment/management-account guards and lowercase names are implemented locally.

**Before acceptance testing:** create staging DNS alias (not production DNS), verify outbound Supabase/Brevo/Storage connectivity, seed synthetic tenant/users/data, validate health/target health/logging, add actionable target-health/5xx alarms, exercise login/session and selected read paths, disable onboarding/platform admin/export/bulk notification and other destructive/high-impact workflows, document operator rollback, and confirm one-task downtime is accepted.

**Before production:** multi-AZ task capacity and scaling, WAF/public-ingress policy, production DNS/certificate ownership, CI/CD GitHub OIDC and approvals, mature alarms/synthetics/runbooks, backup/restore and data-residency decisions, DR/rollback rehearsal, security baseline ownership, production budgets, final tagging/removal-policy review, data migration validation, and full threat/security review.

**Provider-cutover only:** Aurora/RDS schema/data/RLS/RPC work, Cognito, S3 object migration, SES, browser-query removal, dual-read validation, data reconciliation, and Auth subject mapping.

First tests: `/api/health`, authenticated shell/login/session, current rules, qualifications history, certification types and course catalog using synthetic data. Success means healthy deployment and rollback alarms, correct access denials/tenant-negative behavior, exact response contracts, required outbound provider connectivity, usable logs, no production access, and no secret output. Rollback is ECS circuit-breaker return to the preceding immutable task definition/image (or service desired count zero for the first failed launch), followed by removal of staging DNS alias if created; external providers/data remain authoritative and unchanged.

## AWS preflight decision and recommendation

The existing script performs local gates plus `sts get-caller-identity`; it does not inventory bootstrap, certificate, ECR image, secret metadata, budget, DNS, or roles. Fresh AWS evidence is not necessary to decide the next action: the locally documented pre-deployment prerequisites already require separately authorized platform work, and an identity-only call cannot clear them. Therefore no AWS CLI/MCP call was made.

**Recommendation: begin the first AWS staging deployment preparation/deployment workflow, subject to the pre-deployment gates above.** Four distinct read patterns (including qualifications) now demonstrate the boundary, while the first hosting slice intentionally continues using Supabase/Brevo. Another local read abstraction wave would not retire a staging blocker or test the largest unvalidated assumption: the containerized application’s real staging runtime/network/secret integration.
