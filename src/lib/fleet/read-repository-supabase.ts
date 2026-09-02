import type { FleetReadDataSource, FleetResult } from "./read-repository-core.ts";
export type FleetQuery = PromiseLike<FleetResult> & { select(fields: string): FleetQuery; eq(column: string, value: unknown): FleetQuery; order(column: string, options?: { ascending: boolean }): FleetQuery; limit(value: number): FleetQuery; in(column: string, values: string[]): FleetQuery; maybeSingle(): FleetQuery };
export type FleetClient = { from(table: string): FleetQuery };
export class SupabaseFleetReadDataSource implements FleetReadDataSource {
  private readonly client: FleetClient; constructor(client: FleetClient) { this.client = client; }
  getRules(id: string, fields: string) { return this.client.from("fleet_rules").select(fields).eq("department_id", id).maybeSingle(); }
  listVehicles(id: string, fields: string) { return this.client.from("fleet_vehicles").select(fields).eq("department_id", id).order("unit_number", { ascending: true }); }
  getVehicle(id: string, vehicleId: string) { return this.client.from("fleet_vehicles").select("*").eq("department_id", id).eq("id", vehicleId).maybeSingle(); }
  listWorkOrders(id: string, vehicleId: string) { return this.client.from("fleet_work_orders").select("*").eq("department_id", id).eq("vehicle_id", vehicleId).order("reported_at", { ascending: false }); }
  listEquipment(id: string, vehicleId: string) { return this.client.from("fleet_vehicle_equipment").select("*").eq("department_id", id).eq("vehicle_id", vehicleId).order("category"); }
  listDocuments(id: string, vehicleId: string) { return this.client.from("fleet_vehicle_documents").select("*").eq("department_id", id).eq("vehicle_id", vehicleId).order("created_at", { ascending: false }); }
  listInspections(id: string, vehicleId: string) { return this.client.from("fleet_vehicle_inspections").select("*").eq("department_id", id).eq("vehicle_id", vehicleId).order("inspected_at", { ascending: false }).limit(100); }
  listHistory(id: string, vehicleId: string) { return this.client.from("audit_events").select("id,action,details,actor_user_id,created_at").eq("department_id", id).eq("entity_type", "fleet_vehicle").eq("entity_id", vehicleId).order("created_at", { ascending: false }).limit(100); }
  listProfiles(ids: string[]) { return this.client.from("profiles").select("id,full_name").in("id", ids); }
}
