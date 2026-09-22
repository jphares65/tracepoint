/* eslint-disable @typescript-eslint/no-explicit-any -- The generated Supabase type snapshot does not yet include the existing Fleet V1 tables used by this adapter. */
import { createHash, randomUUID } from "node:crypto";

import type { ImportDomain, ImportExecutionResult, ImportPayload, PreviewRow } from "../types.ts";

const BATCH_SIZE = 100;

function nullable(value: unknown) {
  return value === "" || value === null || value === undefined ? null : value;
}

function compact(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "" && value !== null && value !== undefined));
}

async function assertResult(result: { data?: unknown; error?: { message?: string; code?: string } | null }, fallback: string) {
  if (result.error) throw new Error(result.error.code === "23505" ? "A duplicate identifier was detected after approval. Run validation again." : fallback);
  return result.data as any;
}

async function findAuthUser(admin: any, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw new Error("Personnel account lookup failed.");
    const match = result.data.users.find((user: { email?: string }) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (result.data.users.length < 100) break;
  }
  return null;
}

async function persistPersonnel(admin: any, departmentId: string, actorId: string, row: PreviewRow, writer?: PersonnelImportWriter) {
  if (writer) return writer({ admin, departmentId, actorId, row });
  const value = row.values;
  const fullName = String(value.fullName || [value.firstName, value.middleName, value.lastName].filter(Boolean).join(" "));
  if (row.action === "UPDATE" && row.matchId) {
    await assertResult(await admin.from("profiles").update(compact({ full_name: fullName, email: value.email, phone: value.phone })).eq("id", row.matchId), "Personnel profile update failed.");
    const membershipUpdate = compact({ badge_number: value.badgeNumber, employee_number: value.employeeNumber, rank_title: value.rankTitle, unit_name: value.unitName, is_active: value.active, deactivated_at: value.active === false ? new Date().toISOString() : undefined });
    if (value.active === true) membershipUpdate.deactivated_at = null;
    await assertResult(await admin.from("department_memberships").update(membershipUpdate).eq("department_id", departmentId).eq("user_id", row.matchId), "Personnel membership update failed.");
    return;
  }
  let user = await findAuthUser(admin, String(value.email));
  let created = false;
  if (!user) {
    const result = await admin.auth.admin.createUser({ email: value.email, email_confirm: true, user_metadata: { full_name: fullName, onboarding_status: "pending_activation" } });
    if (result.error || !result.data.user) throw new Error("Personnel account creation failed.");
    user = result.data.user;
    created = true;
  }
  try {
    if (created) {
      await assertResult(await admin.from("profiles").upsert({ id: user.id, full_name: fullName, email: value.email, phone: nullable(value.phone) }, { onConflict: "id" }), "Personnel profile creation failed.");
    } else {
      const profile = await admin.from("profiles").select("id").eq("id", user.id).maybeSingle();
      await assertResult(profile, "Existing personnel profile lookup failed.");
      if (!profile.data) await assertResult(await admin.from("profiles").insert({ id: user.id, full_name: fullName, email: value.email, phone: nullable(value.phone) }), "Personnel profile creation failed.");
    }
    await assertResult(await admin.from("department_memberships").insert({ department_id: departmentId, user_id: user.id, badge_number: value.badgeNumber, employee_number: nullable(value.employeeNumber), rank_title: nullable(value.rankTitle), unit_name: nullable(value.unitName), is_active: value.active !== false, deactivated_at: value.active === false ? new Date().toISOString() : null, activation_status: created ? "pending_activation" : "activated" }), "Personnel membership creation failed.");
    await assertResult(await admin.from("department_membership_roles").upsert({ department_id: departmentId, user_id: user.id, role_code: "officer", assigned_by: actorId }, { onConflict: "department_id,user_id,role_code" }), "Personnel role assignment failed.");
  } catch (error) {
    if (created) await admin.auth.admin.deleteUser(user.id);
    throw error;
  }
}

const FIREARM_STATUS: Record<string, string> = {
  "In Service": "in_service", "Out of Service": "out_of_service", Maintenance: "maintenance", "Inspection Required": "inspection_required", Retired: "retired",
};

async function persistFirearm(admin: any, departmentId: string, actorId: string, row: PreviewRow) {
  const value = row.values;
  const record = compact({
    serial_number: row.action === "CREATE" ? value.serialNumber : undefined, asset_number: value.assetNumber, make: value.make || (row.action === "CREATE" ? "TBD / Unknown" : null),
    model: value.model || (row.action === "CREATE" ? "TBD / Unknown" : null), caliber: value.caliber || (row.action === "CREATE" ? "TBD / Unknown" : null),
    firearm_type: value.firearmType || (row.action === "CREATE" ? "other" : null), condition_status: value.conditionStatus,
    status: value.conditionStatus ? FIREARM_STATUS[String(value.conditionStatus)] : undefined, acquisition_date: value.acquisitionDate, notes: value.notes,
    needs_attention: row.action === "CREATE" ? !value.make || !value.model || !value.caliber : undefined,
    attention_reasons: row.action === "CREATE" ? [!value.make ? "missing_make" : "", !value.model ? "missing_model" : "", !value.caliber ? "missing_caliber" : ""].filter(Boolean) : undefined,
  });
  let firearmId = row.matchId;
  if (row.action === "CREATE") {
    const result = await admin.from("firearms").insert({ ...record, department_id: departmentId, created_by: actorId, status: value.assignedUserId ? "assigned" : (record.status ?? "in_service") }).select("id").single();
    firearmId = (await assertResult(result, "Firearm creation failed.")).id;
  } else if (firearmId) {
    await assertResult(await admin.from("firearms").update(record).eq("department_id", departmentId).eq("id", firearmId), "Firearm update failed.");
  }
  if (value.assignedUserId && firearmId) {
    const active = await admin.from("firearm_assignments").select("id").eq("department_id", departmentId).eq("firearm_id", firearmId).is("returned_at", null).maybeSingle();
    await assertResult(active, "Firearm assignment lookup failed.");
    if (!active.data) await assertResult(await admin.from("firearm_assignments").insert({ department_id: departmentId, firearm_id: firearmId, assigned_to_user_id: value.assignedUserId, assigned_by_user_id: actorId, condition_at_issue: value.conditionStatus || "In Service", magazines_issued: 0 }), "Firearm assignment failed.");
  }
}

async function persistCertification(admin: any, departmentId: string, actorId: string, row: PreviewRow) {
  const value = row.values;
  const record = compact({ certification_type_id: value.certificationTypeId, certification_title: value.certificationTitle, issuing_organization: value.issuingOrganization, credential_number: value.credentialNumber, issue_date: value.issueDate, expiration_date: value.expirationDate, notes: value.notes, updated_by_user_id: actorId });
  if (row.action === "CREATE") await assertResult(await admin.from("training_certifications").insert({ ...record, department_id: departmentId, user_id: value.userId, reminder_days: [180, 90, 60, 30, 14, 7, 0], document_url: null, created_by_user_id: actorId }), "Certification creation failed.");
  else if (row.matchId) await assertResult(await admin.from("training_certifications").update(record).eq("department_id", departmentId).eq("id", row.matchId), "Certification update failed.");
}

async function persistInstalledAssets(admin: any, departmentId: string, actorId: string, vehicleId: string, value: Record<string, unknown>) {
  const categories: Array<[string, string, string, string?]> = [
    ["MDT", "mdtSerial", "mdtWarrantyExpiration"], ["Modem", "modemSerial", "modemWarrantyExpiration"],
    ["MVR", "mvrSerial", "mvrWarrantyExpiration"], ["Radar", "radarSerial", "radarWarrantyExpiration", "radarTuningForkSerial"],
  ];
  for (const [category, serialField, warrantyField, tuningField] of categories) {
    if (!value[serialField] && !value[warrantyField] && !(tuningField && value[tuningField])) continue;
    const existing = await admin.from("fleet_vehicle_equipment").select("id").eq("department_id", departmentId).eq("vehicle_id", vehicleId).ilike("category", category).neq("status", "Removed").limit(1).maybeSingle();
    await assertResult(existing, `${category} lookup failed.`);
    const record = compact({ serial_number: value[serialField], warranty_expiration_date: value[warrantyField], tuning_fork_serial_number: tuningField ? value[tuningField] : undefined, updated_by_user_id: actorId });
    if (existing.data) await assertResult(await admin.from("fleet_vehicle_equipment").update(record).eq("department_id", departmentId).eq("id", existing.data.id), `${category} update failed.`);
    else await assertResult(await admin.from("fleet_vehicle_equipment").insert({ ...record, department_id: departmentId, vehicle_id: vehicleId, source_type: "Fleet Checklist", category, name: `${category} equipment`, quantity: 1, status: "Current", created_by_user_id: actorId }), `${category} creation failed.`);
  }
}

async function persistVehicle(admin: any, departmentId: string, actorId: string, row: PreviewRow) {
  const value = row.values;
  const record = compact({ unit_number: row.action === "CREATE" ? value.unitNumber : undefined, vin: value.vin, license_plate: value.licensePlate, year: value.year, make: value.make, model: value.model, vehicle_type: value.vehicleType, status: value.status, current_mileage: value.currentMileage, current_hours: value.currentHours, comments: value.comments, updated_by_user_id: actorId });
  let id = row.matchId;
  if (row.action === "CREATE") {
    const result = await admin.from("fleet_vehicles").insert({ ...record, department_id: departmentId, assignment_type: "Pool", current_mileage: value.currentMileage ?? 0, current_hours: value.currentHours ?? 0, status: value.status ?? "Available", created_by_user_id: actorId }).select("id").single();
    id = (await assertResult(result, "Vehicle creation failed.")).id;
  } else if (id) await assertResult(await admin.from("fleet_vehicles").update(record).eq("department_id", departmentId).eq("id", id), "Vehicle update failed.");
  if (id) await persistInstalledAssets(admin, departmentId, actorId, id, value);
}

async function persistEquipment(admin: any, departmentId: string, actorId: string, row: PreviewRow) {
  const value = row.values;
  const record = compact({ equipment_type_id: value.equipmentTypeId, asset_number: value.assetNumber, serial_number: row.action === "CREATE" ? value.serialNumber : undefined, manufacturer: value.manufacturer, model: value.model, lot_number: value.lotNumber, lifecycle_status: value.lifecycleStatus, assigned_user_id: value.assignedUserId, assigned_location: value.assignedLocation, issue_date: value.issueDate, expiration_date: value.expirationDate, last_inspection_date: value.lastInspectionDate, next_inspection_date: value.nextInspectionDate, notes: value.notes, updated_by: actorId });
  if (row.action === "CREATE") await assertResult(await admin.from("equipment_assets").insert({ ...record, department_id: departmentId, lifecycle_status: value.lifecycleStatus ?? "active", created_by: actorId }), "Equipment creation failed.");
  else if (row.matchId) await assertResult(await admin.from("equipment_assets").update(record).eq("department_id", departmentId).eq("id", row.matchId), "Equipment update failed.");
}

async function persistRow(admin: any, domain: ImportDomain, departmentId: string, actorId: string, row: PreviewRow, services: ImportExecutionServices) {
  if (domain === "personnel") return persistPersonnel(admin, departmentId, actorId, row, services.personnel);
  if (domain === "firearms") return persistFirearm(admin, departmentId, actorId, row);
  if (domain === "certifications") return persistCertification(admin, departmentId, actorId, row);
  if (domain === "vehicles") return persistVehicle(admin, departmentId, actorId, row);
  return persistEquipment(admin, departmentId, actorId, row);
}

type ExecutionAuditContext = {
  workspaceId?: string;
  sourceFiles?: Array<{ filename: string; sha256: string; sheet: string }>;
  mappings?: Array<{ sourceId: string; sourceColumn: string; targetField: string | null; confidence: string }>;
  remediations?: Array<{ sourceId: string; rowNumber: number; sourceColumn: string; targetField: string; originalValue: string; replacementValue: string; scope: string }>;
  mergeRules?: Array<{ domain: string; strategy: string; groupKey?: string; field?: string; preferredSourceId?: string }>;
};

export type PersonnelImportWriter = (input: {
  admin: any;
  departmentId: string;
  actorId: string;
  row: PreviewRow;
}) => Promise<void>;

export type ImportExecutionServices = { personnel?: PersonnelImportWriter };

function valueFingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function executeApprovedImport(admin: any, payload: ImportPayload, departmentId: string, actorId: string, rows: PreviewRow[], auditContext: ExecutionAuditContext = {}, services: ImportExecutionServices = {}): Promise<ImportExecutionResult> {
  const jobId = randomUUID();
  const result: ImportExecutionResult = { jobId, created: 0, updated: 0, skipped: 0, failed: 0, warnings: rows.filter((row) => row.status === "warning").length, failures: [], rejectedRows: [] };
  const startAudit = await admin.from("audit_events").insert({
    department_id: departmentId, actor_user_id: actorId, action: "ai_import_approved", entity_type: "ai_import_job", entity_id: jobId,
    summary: `${payload.domain} import approved for ${rows.length} rows.`,
    details: { source: { filename: payload.file.name, size: payload.file.size, sha256: payload.file.sha256, sheet: payload.sheetName, header_row: payload.headerRow }, workspace_id: auditContext.workspaceId, workspace_sources: auditContext.sourceFiles, domain: payload.domain, mappings: auditContext.mappings ?? payload.mappings.map((mapping) => ({ source: mapping.sourceColumn, target: mapping.targetField, confidence: mapping.confidence })), remediations: [...(payload.overrides ?? []), ...(auditContext.remediations ?? [])].map((override) => ({ source_id: "sourceId" in override ? override.sourceId : undefined, row_number: override.rowNumber, source_column: override.sourceColumn, target_field: override.targetField, scope: override.scope, original_value_sha256: valueFingerprint(override.originalValue), replacement_value_sha256: valueFingerprint(override.replacementValue) })), conflict_decisions: payload.rowDecisions ?? [], merge_rules: auditContext.mergeRules, final_validation: { total: rows.length, valid: rows.filter((row) => row.status === "valid").length, warnings: rows.filter((row) => row.status === "warning").length, blocked: rows.filter((row) => row.status === "blocked").length, create: rows.filter((row) => row.action === "CREATE").length, update: rows.filter((row) => row.action === "UPDATE").length, skip: rows.filter((row) => row.action === "SKIP").length, conflict: rows.filter((row) => row.action === "CONFLICT").length }, proposed: { create: rows.filter((row) => row.action === "CREATE").length, update: rows.filter((row) => row.action === "UPDATE").length, skip: rows.filter((row) => row.action === "SKIP").length }, raw_file_stored: false },
  });
  await assertResult(startAudit, "Import approval could not be audited, so no records were written.");
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    for (const row of rows.slice(offset, offset + BATCH_SIZE)) {
      if (row.action === "SKIP") { result.skipped += 1; continue; }
      try {
        await persistRow(admin, payload.domain, departmentId, actorId, row, services);
        if (row.action === "CREATE") result.created += 1;
        if (row.action === "UPDATE") result.updated += 1;
      } catch (error) {
        result.failed += 1;
        const message = error instanceof Error ? error.message : "The database rejected this row.";
        result.failures.push({ rowNumber: row.rowNumber, message });
        result.rejectedRows.push({ rowNumber: row.rowNumber, reason: message, values: row.values });
      }
    }
  }
  const finalAudit = await admin.from("audit_events").insert({ department_id: departmentId, actor_user_id: actorId, action: result.failed ? "ai_import_completed_with_failures" : "ai_import_completed", entity_type: "ai_import_job", entity_id: jobId, summary: `${payload.domain} import completed: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.failed} failed.`, details: { domain: payload.domain, source_sha256: payload.file.sha256, results: { created: result.created, updated: result.updated, skipped: result.skipped, failed: result.failed, warnings: result.warnings }, failed_row_numbers: result.failures.map((failure) => failure.rowNumber), raw_file_stored: false } });
  if (finalAudit.error) {
    result.failed += 1;
    result.failures.push({ rowNumber: 0, message: "Records were processed, but the completion audit could not be written. Do not retry this file until an administrator reviews the approval audit." });
  }
  return result;
}
