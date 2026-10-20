import { agencyDocumentsDisabledResponse } from "@/lib/agency-documents/module-access";
import { handleGenerate } from "@/lib/agency-documents/generate-handler";
import { attachmentPathFromMetadata, createObjectStore } from "@/lib/storage/object-store";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleGenerate(request, {
    resolveAccess: async () => {
      const access = await resolveServerAccess();
      if (!access.ok) return { ok: false, response: accessFailureResponse(access) };
      const moduleDisabled = agencyDocumentsDisabledResponse(access.context);
      return moduleDisabled ? { ok: false, response: moduleDisabled } : { ok: true, context: access.context };
    },
    hasPermission: (context, permissions) => hasAnyServerPermission(context as never, permissions as never),
    denied: (message) => permissionDeniedResponse(message),
    attachmentPath: (stored, departmentId) => attachmentPathFromMetadata(stored, departmentId),
    store: (admin, departmentId) => createObjectStore(admin, departmentId),
  });
}
