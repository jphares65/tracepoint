import { redirect } from "next/navigation";

export default async function PlatformAdminPage() {
  if (process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native") redirect("/officer-home");
  const LegacyPlatformAdminPage = (await import("./legacy-page")).default;
  return <LegacyPlatformAdminPage />;
}
