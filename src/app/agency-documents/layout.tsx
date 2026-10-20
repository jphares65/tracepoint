import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { agencyDocumentsDisabledResponse } from "@/lib/agency-documents/module-access";
import {
  hasAnyServerPermission,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export default async function AgencyDocumentsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    redirect("/unauthorized?from=/agency-documents");
  }

  if (!hasAnyServerPermission(resolved.context, [
    "view_agency_documents",
    "generate_agency_documents",
    "manage_document_templates",
  ])) {
    redirect("/unauthorized?from=/agency-documents");
  }

  if (agencyDocumentsDisabledResponse(resolved.context)) {
    redirect("/");
  }

  return children;
}
