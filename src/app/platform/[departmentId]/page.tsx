import { redirect } from "next/navigation";

type PageProps = { params: Promise<{ departmentId: string }> };
export default async function PlatformAgencyPage(props: PageProps) {
  if (process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native") redirect("/officer-home");
  const LegacyPlatformAgencyPage = (await import("./legacy-page")).default;
  return <LegacyPlatformAgencyPage {...props} />;
}
