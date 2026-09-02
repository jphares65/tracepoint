import type { TracePointPermission } from "@/lib/tracepoint/permissions";

export type ReportFilter = "officer" | "date" | "status" | "notes" | "workflow" | "inspections";
export type ReportDefinition = {
  key: string; label: string; group: string; featureCode: string | null;
  permissions: readonly TracePointPermission[]; filters: readonly ReportFilter[];
  endpoint: string | null; collectionPath: readonly string[]; csv: boolean;
};

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  { key:"complete",label:"Complete TracePoint Report",group:"Complete",featureCode:null,permissions:["administer_department"],filters:["officer","date","notes","workflow","inspections"],endpoint:null,collectionPath:[],csv:false },
  { key:"personnel",label:"Personnel Directory",group:"Personnel and Readiness",featureCode:null,permissions:["manage_users","view_command_dashboard"],filters:["officer"],endpoint:"/api/pilot/personnel",collectionPath:["personnel"],csv:true },
  { key:"readiness",label:"Equipment Standards and Readiness",group:"Personnel and Readiness",featureCode:"equipment_readiness",permissions:["manage_equipment","view_command_dashboard","view_analytics"],filters:["officer","status"],endpoint:"/api/readiness/equipment",collectionPath:["rows"],csv:true },
  { key:"certification-readiness",label:"Certification Standards and Readiness",group:"Personnel and Readiness",featureCode:"certifications",permissions:["manage_certifications","view_command_dashboard","view_analytics"],filters:["officer","status"],endpoint:"/api/readiness/certifications",collectionPath:["rows"],csv:true },
  { key:"alerts",label:"Current Alerts and Unresolved Items",group:"Personnel and Readiness",featureCode:null,permissions:["view_command_dashboard","view_analytics"],filters:["officer","status"],endpoint:"/api/notifications",collectionPath:["items"],csv:true },
  { key:"firearms",label:"Firearms and Assignments",group:"Armory and Ammunition",featureCode:"firearms",permissions:["manage_firearms","view_command_dashboard"],filters:["officer","status","notes","inspections"],endpoint:"/api/armory/firearms",collectionPath:["firearms"],csv:true },
  { key:"firearm-inspections",label:"Firearm Inspection History",group:"Armory and Ammunition",featureCode:"firearms",permissions:["manage_inspections","manage_firearms","view_command_dashboard"],filters:["officer","date","status","notes"],endpoint:"/api/armory/inspections",collectionPath:["inspections"],csv:true },
  { key:"off-duty-firearms",label:"Off-Duty Firearms",group:"Armory and Ammunition",featureCode:"off_duty",permissions:["submit_off_duty_requests","review_off_duty_requests"],filters:["officer","date","status","notes","workflow","inspections"],endpoint:"/api/off-duty-firearms",collectionPath:["records"],csv:true },
  { key:"ammunition",label:"Ammunition Inventory",group:"Armory and Ammunition",featureCode:"ammunition",permissions:["manage_firearms","view_command_dashboard"],filters:["status","notes"],endpoint:"/api/armory/ammunition",collectionPath:["lots"],csv:true },
  { key:"ammunition-transactions",label:"Ammunition Transactions",group:"Armory and Ammunition",featureCode:"ammunition",permissions:["manage_firearms","view_command_dashboard"],filters:["officer","date","status","notes"],endpoint:"/api/armory/ammunition",collectionPath:["transactions"],csv:true },
  { key:"personal-rifles",label:"Personally Owned Rifle Records",group:"Armory and Ammunition",featureCode:"firearms",permissions:["manage_firearms","view_command_dashboard"],filters:["officer","date","status","notes","workflow","inspections"],endpoint:"/api/armory/personal-rifles",collectionPath:["rifles"],csv:true },
  { key:"qualifications",label:"Qualification History",group:"Training and Qualifications",featureCode:"qualifications",permissions:["manage_qualifications","score_range_days","view_analytics"],filters:["officer","date","status","notes"],endpoint:"/api/pilot/range-workspace",collectionPath:["workspace","results"],csv:true },
  { key:"range-days",label:"Range Days and Digital Range Packets",group:"Training and Qualifications",featureCode:"range_training",permissions:["manage_range_days","score_range_days","view_command_dashboard"],filters:["date","status","notes"],endpoint:"/api/pilot/range-workspace",collectionPath:["workspace","rangeDays"],csv:true },
  { key:"training-records",label:"Range Training Records",group:"Training and Qualifications",featureCode:"range_training",permissions:["manage_training","manage_range_days","view_command_dashboard"],filters:["officer","date","status","notes"],endpoint:"/api/pilot/range-workspace",collectionPath:["workspace","results"],csv:true },
  { key:"agency-training",label:"Agency Training Events and Rosters",group:"Training and Qualifications",featureCode:"range_training",permissions:["manage_training","manage_certifications","view_command_dashboard"],filters:["officer","date","status","notes"],endpoint:"/api/agency-training/events",collectionPath:["events"],csv:true },
  { key:"certifications",label:"Training Certifications",group:"Training and Qualifications",featureCode:"certifications",permissions:["manage_certifications","view_command_dashboard"],filters:["officer","date","status","notes"],endpoint:"/api/training/certifications",collectionPath:["certifications"],csv:true },
  { key:"equipment",label:"Equipment Inventory and Assignments",group:"Equipment",featureCode:"equipment_readiness",permissions:["manage_equipment","view_command_dashboard"],filters:["officer","date","status","notes","inspections"],endpoint:"/api/equipment/assets",collectionPath:["items"],csv:true },
  { key:"fleet",label:"Fleet Vehicles",group:"Fleet",featureCode:null,permissions:["view_fleet","manage_fleet"],filters:["date","status","notes","inspections"],endpoint:"/api/fleet/report",collectionPath:["vehicles"],csv:true },
  { key:"fleet-inspections",label:"Fleet Inspections",group:"Fleet",featureCode:null,permissions:["view_fleet","perform_fleet_inspections"],filters:["date","status","notes"],endpoint:"/api/fleet/report",collectionPath:["inspections"],csv:true },
  { key:"fleet-maintenance",label:"Fleet Maintenance and Work Orders",group:"Fleet",featureCode:null,permissions:["view_fleet","manage_fleet_maintenance"],filters:["date","status","notes"],endpoint:"/api/fleet/report",collectionPath:["workOrders"],csv:true },
  { key:"fleet-equipment",label:"Vehicle-Associated Equipment",group:"Fleet",featureCode:null,permissions:["view_fleet","manage_fleet"],filters:["status","notes"],endpoint:"/api/fleet/report",collectionPath:["equipment"],csv:true },
  { key:"audit-history",label:"Audit History",group:"Administration and Audit",featureCode:null,permissions:["view_audit_log","administer_department"],filters:["officer","date","notes"],endpoint:"/api/settings/audit-log/export?purpose=complete_report",collectionPath:["events"],csv:true },
] as const;

export function reportCollection(payload: unknown, path: readonly string[]) {
  let value: unknown = payload;
  for (const key of path) value = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return Array.isArray(value) ? value as Record<string, unknown>[] : [];
}
