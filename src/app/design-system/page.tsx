import { notFound } from "next/navigation";
import { connection } from "next/server";

import TracePointShell from "@/app/components/TracePointShell";

import ComponentGallery from "./ComponentGallery";

export const metadata = { title: "Component gallery · TracePoint" };

/**
 * Living reference for the shared UI kit (blueprint §4 "component gallery page").
 * Visual-regression snapshots are taken here. Hidden in production builds unless
 * TRACEPOINT_COMPONENT_GALLERY=enabled.
 */
export default async function DesignSystemPage() {
  await connection();
  if (process.env.NODE_ENV === "production" && process.env.TRACEPOINT_COMPONENT_GALLERY !== "enabled") {
    notFound();
  }

  return (
    <TracePointShell activePage="Component gallery">
      <ComponentGallery />
    </TracePointShell>
  );
}
