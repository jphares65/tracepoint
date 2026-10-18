import { handleGenerate } from "@/lib/agency-documents/generate-handler";
import { attachmentPathFromMetadata, createObjectStore } from "@/lib/storage/object-store";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleGenerate(request, {
    resolveAccess: async () => {
      const access = await resolveServerAccess();
      return access.ok ? { ok: true, context: access.context } : { ok: false, response: accessFailureResponse(access) };
    },
    hasPermission: (context, permissions) => hasAnyServerPermission(context as never, permissions as never),
    denied: (message) => permissionDeniedResponse(message),
    attachmentPath: (stored, departmentId) => attachmentPathFromMetadata(stored, departmentId),
    store: (admin, departmentId) => createObjectStore(admin, departmentId),
  });
}
