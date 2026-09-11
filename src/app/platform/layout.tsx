import { redirect } from "next/navigation";

export default async function PlatformLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native") redirect("/officer-home");
  const LegacyPlatformLayout = (await import("./legacy-layout")).default;
  return <LegacyPlatformLayout>{children}</LegacyPlatformLayout>;
}
