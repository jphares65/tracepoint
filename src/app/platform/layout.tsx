import { redirect } from "next/navigation";
import { resolvePlatformAdminAccess } from "@/lib/platform/admin-access";

export default async function PlatformLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const access = await resolvePlatformAdminAccess();
  if (!access.ok) {
    if (access.status === 401) redirect("/login?next=%2Fplatform");
    if (access.status === 403) redirect("/unauthorized?from=%2Fplatform");
    redirect("/landing");
  }

  return <>{children}</>;
}
