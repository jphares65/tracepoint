/* eslint-disable @typescript-eslint/no-explicit-any -- The generated Supabase type snapshot does not yet include the existing Fleet V1 tables queried here. */
import "server-only";

import type { ExistingReference, ImportDomain, ImportReferenceData, PersonReference } from "../types.ts";

async function rows(label: string, result: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
  const resolved = await result;
  if (resolved.error) throw new Error(`Import reference data could not be loaded (${label}).`);
  return (resolved.data ?? []) as ExistingReference[];
}

export async function loadImportReferenceData(admin: any, departmentId: string, domain: ImportDomain): Promise<ImportReferenceData> {
  const empty: ImportReferenceData = { people: [], firearms: [], firearmAssignments: [], certificationTypes: [], certifications: [], vehicles: [], fleetEquipment: [], equipmentTypes: [], equipment: [] };
  const needsPeople = ["personnel", "firearms", "certifications", "equipment"].includes(domain);
  if (needsPeople) {
    const memberships = await rows("personnel memberships", admin.from("department_memberships").select("user_id,badge_number,employee_number,rank_title,unit_name,is_active").eq("department_id", departmentId));
    const ids = memberships.map((membership) => String(membership.user_id));
    const profiles = ids.length ? await rows("personnel profiles", admin.from("profiles").select("id,full_name,email,phone").in("id", ids)) : [];
    const byId = new Map(profiles.map((profile) => [String(profile.id), profile]));
    empty.people = memberships.map((membership): PersonReference => {
      const profile = byId.get(String(membership.user_id));
      return {
        userId: String(membership.user_id), fullName: String(profile?.full_name ?? ""), email: profile?.email ? String(profile.email) : null,
        phone: profile?.phone ? String(profile.phone) : null, badgeNumber: membership.badge_number ? String(membership.badge_number) : null,
        employeeNumber: membership.employee_number ? String(membership.employee_number) : null, rankTitle: membership.rank_title ? String(membership.rank_title) : null,
        unitName: membership.unit_name ? String(membership.unit_name) : null, active: membership.is_active === true,
      };
    });
  }
  if (domain === "firearms") {
    [empty.firearms, empty.firearmAssignments] = await Promise.all([
      rows("firearms", admin.from("firearms").select("id,serial_number,asset_number,make,model,caliber,firearm_type,condition_status,acquisition_date,notes").eq("department_id", departmentId)),
      rows("firearm assignments", admin.from("firearm_assignments").select("id,firearm_id,assigned_to_user_id,returned_at").eq("department_id", departmentId)),
    ]);
  }
  if (domain === "certifications") {
    [empty.certificationTypes, empty.certifications] = await Promise.all([
      rows("certification types", admin.from("certification_types").select("id,name,is_active,issuing_organization,expiration_required").eq("department_id", departmentId)),
      rows("training certifications", admin.from("training_certifications").select("id,user_id,certification_type_id,credential_number,issue_date,expiration_date,issuing_organization,notes").eq("department_id", departmentId)),
    ]);
  }
  if (domain === "vehicles") {
    [empty.vehicles, empty.fleetEquipment] = await Promise.all([
      rows("fleet vehicles", admin.from("fleet_vehicles").select("*").eq("department_id", departmentId)),
      rows("fleet equipment", admin.from("fleet_vehicle_equipment").select("id,vehicle_id,category,serial_number,tuning_fork_serial_number,warranty_expiration_date,status").eq("department_id", departmentId)),
    ]);
  }
  if (domain === "equipment") {
    [empty.equipmentTypes, empty.equipment] = await Promise.all([
      rows("equipment types", admin.from("equipment_types").select("id,name,is_active,expiration_required").eq("department_id", departmentId)),
      rows("equipment assets", admin.from("equipment_assets").select("*").eq("department_id", departmentId)),
    ]);
  }
  return empty;
}
