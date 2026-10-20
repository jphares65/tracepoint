import { MODULE_FEATURE } from "@/lib/tracepoint/module-catalog";
import { requireServerFeature, type ServerAccessContext } from "@/lib/tracepoint/server-access";

/** A 403 response when the platform administrator has not enabled Agency Documents for this agency; otherwise null. */
export function agencyDocumentsDisabledResponse(context: ServerAccessContext) {
  return requireServerFeature(context, MODULE_FEATURE.AGENCY_DOCUMENTS, "Agency Documents");
}
