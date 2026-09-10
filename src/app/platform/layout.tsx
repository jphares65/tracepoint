import { redirect } from "next/navigation";
import { resolvePlatformAdminAccess } from "@/lib/platform/admin-access";

export default async function PlatformLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const access = await resolvePlatformAdminAccess();
  if (!access.ok) redirect(access.status === 401 ? "/login" : "/");

  return <>{children}</>;
}
