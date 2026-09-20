import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const RUN_ID = "4272874f-bae4-49f4-a0b4-67a39cec2874";
export const AUTHORIZATION_REFERENCE = "TP-FINAL-DB-20260920-4272874FBAE4";
export const SOURCE_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/migration/source-supabase-rest-wvh4pi";
export const PROJECT_REF = "izlkwggluhlhzlumtzes";
export const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`;
export const PRIOR_TOTAL_ROWS = 4723;
export const PRIOR_IDENTITIES = 96;
export const PRIOR_MEMBERSHIPS = 95;
export const PRIOR_OBJECTS = 2;
export const PRIOR_OBJECT_BYTES = 522978;

// This contract is deliberately fixed in source. New PostgREST paths cannot become
// migration inputs merely because the service account exposes them.
export const MIGRATION_RELATIONS = Object.freeze([
  "agency_training_attendees", "agency_training_certificates", "agency_training_course_aliases", "agency_training_courses", "agency_training_event_instructors", "agency_training_events", "agency_training_requirement_members", "agency_training_requirements", "ai_migration_workspaces", "alerts", "ammunition_lots", "ammunition_reconciliation_items", "ammunition_reconciliations", "ammunition_transactions", "attachments", "audit_events", "audit_log", "certification_types", "department_certification_capabilities", "department_certification_requirements", "department_equipment_requirements", "department_feature_events", "department_features", "department_group_members", "department_groups", "department_membership_roles", "department_memberships", "department_qualification_standard_components", "department_qualification_standards", "department_role_permissions", "department_rules", "department_security_settings", "department_titles", "department_units", "departments", "drill_documents", "drill_run_results", "drill_templates", "equipment_asset_assignments", "equipment_assets", "equipment_types", "feature_catalog", "firearm_assignments", "firearm_inspection_items", "firearm_inspections", "firearm_malfunctions", "firearm_status_history", "firearms", "fleet_rules", "fleet_vehicle_documents", "fleet_vehicle_equipment", "fleet_vehicle_inspections", "fleet_vehicles", "fleet_work_orders", "inbox_items", "instructor_observations", "notification_email_queue", "notification_events", "notification_preferences", "off_duty_firearm_history", "off_duty_firearm_inspections", "off_duty_firearm_requests", "off_duty_request_actions", "permissions", "personal_rifle_status_history", "personal_rifles", "pilot_ammunition_workspaces", "pilot_range_workspaces", "pilot_remediation_workspaces", "platform_admins", "platform_agency_accounts", "profiles", "qualification_course_versions", "qualification_courses", "qualification_results", "range_day_drills", "range_day_instructors", "range_day_roster", "range_day_roster_firearms", "range_days", "range_packets", "remedial_training_recommendations", "retired_permission_assignment_audit", "role_permissions", "roles", "training_certifications", "user_activation_tokens", "v_active_firearm_assignments", "v_latest_qualification_results", "v_range_day_summary",
]);

// Composite and natural-key relations are explicitly ordered here; all other
// reviewed contract relations have an immutable `id` projection. This is source
// contract, rather than live discovery, so a newly exposed relation cannot alter
// canonical pagination behavior.
export const RELATION_ORDER_COLUMNS = Object.freeze({
  department_memberships: ["department_id", "user_id"],
  department_membership_roles: ["department_id", "user_id", "role_code"],
  department_group_members: ["department_id", "group_id", "user_id"],
  department_features: ["department_id", "feature_code"],
  department_role_permissions: ["department_id", "role_code", "permission_code"],
  department_rules: ["department_id"],
  department_security_settings: ["department_id"],
  department_equipment_requirements: ["department_id"],
  role_permissions: ["role_code", "permission_code"],
  range_day_instructors: ["range_day_id", "user_id"],
  range_day_roster_firearms: ["roster_entry_id", "firearm_id"],
  platform_admins: ["user_id"],
  permissions: ["code"],
  roles: ["code"],
  feature_catalog: ["code"],
  v_latest_qualification_results: ["id"],
  v_active_firearm_assignments: ["id"],
  v_range_day_summary: ["id"],
});

const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const credentialKeys = ["projectUrl", "serviceRoleKey"];

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export const sha256 = value => createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");

export function validateInvocation(environment) {
  assert.equal(environment.TRACEPOINT_MIGRATION_RUN_ID, RUN_ID, "Approved migration run ID is required");
  assert.equal(environment.TRACEPOINT_MIGRATION_AUTHORIZATION_REFERENCE, AUTHORIZATION_REFERENCE, "Approved authorization reference is required");
  assert.equal(environment.SOURCE_SUPABASE_REST_SECRET_ARN, SOURCE_SECRET_ARN, "Only the dedicated REST source secret is permitted");
  assert.equal(environment.TRACEPOINT_EXPECTED_AWS_ACCOUNT, "193644343389", "Production account is required");
}

export function validateSourceSecret(value) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "REST source secret must be an object");
  assert.deepEqual(Object.keys(value).sort(), credentialKeys, "REST source secret has unexpected fields");
  assert.equal(value.projectUrl, PROJECT_URL, "Exact approved Supabase project URL is required");
  assert.ok(typeof value.serviceRoleKey === "string" && value.serviceRoleKey.length >= 20, "Supabase service credential is invalid");
  return { projectUrl: value.projectUrl, serviceRoleKey: value.serviceRoleKey };
}

export function assertReadOnlyRequest(method, url) {
  const normalized = String(method).toUpperCase();
  assert.equal(mutatingMethods.has(normalized), false, "REST migration extractor permits GET requests only");
  assert.equal(normalized, "GET", "REST migration extractor permits GET requests only");
  const parsed = new URL(url);
  assert.equal(parsed.origin, PROJECT_URL, "REST migration extractor only permits the approved Supabase project");
  assert.equal(parsed.protocol, "https:", "REST migration extractor requires HTTPS");
  assert.equal(parsed.pathname.startsWith("/rest/v1/") || parsed.pathname === "/auth/v1/admin/users", true, "REST migration extractor path is not approved");
  return parsed;
}

export function relationUrl(relation, offset, limit = 500) {
  assert.ok(MIGRATION_RELATIONS.includes(relation), "Relation is not in the approved migration contract");
  assert.ok(Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit > 0 && limit <= 1000, "Invalid deterministic page range");
  const columns = RELATION_ORDER_COLUMNS[relation] ?? ["id"];
  assert.ok(columns.every(column => /^[a-z][a-z0-9_]*$/.test(column)), "Invalid relation ordering contract");
  return `${PROJECT_URL}/rest/v1/${relation}?select=*&order=${columns.map(column => `${column}.asc`).join(",")}&offset=${offset}&limit=${limit}`;
}

export function usersUrl(page, perPage = 200) {
  assert.ok(Number.isInteger(page) && page >= 1 && Number.isInteger(perPage) && perPage > 0 && perPage <= 1000, "Invalid identity page");
  return `${PROJECT_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`;
}

export function sanitizedManifest({ capturedAtUtc, tables, identities, memberships, objectManifestSha256, objectCount, objectBytes }) {
  assert.ok(Number.isFinite(Date.parse(capturedAtUtc)), "Capture timestamp is required");
  assert.equal(tables.length, MIGRATION_RELATIONS.length, "Every contract relation must be reconciled");
  const normalizedTables = [...tables].map(table => {
    assert.ok(MIGRATION_RELATIONS.includes(table.name), "Unapproved relation in manifest");
    assert.ok(Number.isSafeInteger(table.rows) && table.rows >= 0, "Invalid relation count");
    assert.match(table.canonicalDataSha256, /^[0-9a-f]{64}$/, "Invalid relation hash");
    return { name: table.name, rows: table.rows, canonicalDataSha256: table.canonicalDataSha256 };
  }).sort((a, b) => a.name.localeCompare(b.name));
  assert.equal(new Set(normalizedTables.map(table => table.name)).size, MIGRATION_RELATIONS.length, "Duplicate relation manifest entry");
  assert.ok(Number.isSafeInteger(identities.count) && identities.count >= 0 && /^[0-9a-f]{64}$/.test(identities.canonicalDataSha256), "Invalid identity evidence");
  assert.ok(Number.isSafeInteger(memberships.count) && memberships.count >= 0 && /^[0-9a-f]{64}$/.test(memberships.canonicalDataSha256), "Invalid membership evidence");
  assert.match(objectManifestSha256, /^[0-9a-f]{64}$/, "Invalid object manifest hash");
  assert.equal(objectCount, PRIOR_OBJECTS, "Object count no longer matches approved source evidence");
  assert.equal(objectBytes, PRIOR_OBJECT_BYTES, "Object byte count no longer matches approved source evidence");
  const totalRows = normalizedTables.reduce((total, table) => total + table.rows, 0);
  const payload = {
    format: "tracepoint-supabase-rest-source-manifest/v1", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, capturedAtUtc,
    source: { provider: "supabase-rest-admin", projectRef: PROJECT_REF, projectUrl: PROJECT_URL, transport: "https", readOnlyMethods: ["GET"] },
    tables: normalizedTables, totalRelationalRows: totalRows,
    identities: { count: identities.count, canonicalDataSha256: identities.canonicalDataSha256 },
    memberships: { count: memberships.count, canonicalDataSha256: memberships.canonicalDataSha256 },
    objects: { count: objectCount, totalBytes: objectBytes, manifestSha256: objectManifestSha256 },
    comparison: { priorRelationalRows: PRIOR_TOTAL_ROWS, freshRelationalRows: totalRows, delta: totalRows - PRIOR_TOTAL_ROWS, priorIdentities: PRIOR_IDENTITIES, freshIdentities: identities.count, identityDelta: identities.count - PRIOR_IDENTITIES, priorMemberships: PRIOR_MEMBERSHIPS, freshMemberships: memberships.count, membershipDelta: memberships.count - PRIOR_MEMBERSHIPS },
    privacy: { credentialsEmitted: false, recordContentsEmitted: false, emailsEmitted: false, userIdsEmitted: false, targetClientsInitialized: false },
  };
  return { ...payload, masterSha256: sha256(payload) };
}
