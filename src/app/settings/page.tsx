import { redirect } from "next/navigation";

export default async function AdminSettingsPage() {
  if (process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native") redirect("/officer-home");
  const LegacyAdminSettingsPage = (await import("./legacy-page")).default;
  return <LegacyAdminSettingsPage />;
}
