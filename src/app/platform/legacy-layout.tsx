import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function PlatformLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: isPlatformAdmin, error } = await supabase.rpc(
    "is_platform_admin"
  );

  if (error) {
    console.error("Platform admin check failed:", error);
    redirect("/");
  }

  if (!isPlatformAdmin) {
    redirect("/");
  }

  return <>{children}</>;
}
