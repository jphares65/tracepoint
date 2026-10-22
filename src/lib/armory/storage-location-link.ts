import type { TracePointPermission } from "@/lib/tracepoint/permissions";

// SV-31: the custody workflow links to storage-location management.
//
// The management panel (SecureStorageLocationsPanel) was reachable only through
// Settings > Rules Engine > Armory, which requires administer_department. The
// database lets firearm_custody.manage_storage_locations manage locations
// (028/029/034), so the panel is also served at this Armory route.
export const STORAGE_LOCATIONS_HREF = "/firearms/storage-locations";

/** The permission the database checks for create/update/deactivate (034). */
export const STORAGE_LOCATION_MANAGEMENT_PERMISSION: TracePointPermission = "firearm_custody.manage_storage_locations";

export function canLinkToStorageLocationManagement(hasPermission: (code: TracePointPermission) => boolean) {
  return hasPermission(STORAGE_LOCATION_MANAGEMENT_PERMISSION);
}
