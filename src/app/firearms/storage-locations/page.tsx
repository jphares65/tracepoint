"use client";

import TracePointShell from "@/app/components/TracePointShell";
import ArmorySectionShell from "@/app/components/ArmorySectionShell";
import SecureStorageLocationsPanel from "@/app/settings/components/SecureStorageLocationsPanel";

// SV-31: storage-location management reachable from the custody workflow. The
// same panel is also under Settings > Rules Engine > Armory (administrators).
// Access: ROUTE_PERMISSION_RULES "/firearms/storage-locations".
export default function StorageLocationsPage() {
  return (
    <TracePointShell activePage="Armory">
      <div className="mx-auto w-full max-w-[900px] space-y-5">
        <ArmorySectionShell
          title="Secure Storage Locations"
          description="Locations available when a firearm is checked in to secure storage."
          backHref="/firearms"
          backLabel="Back to Firearms"
        />
        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <SecureStorageLocationsPanel />
        </section>
      </div>
    </TracePointShell>
  );
}
