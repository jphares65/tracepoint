import { notFound } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import ActivationButton from "./ActivationButton";
import AdministratorButton from "./AdministratorButton";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ departmentId: string }>;
};

export default async function PlatformAgencyPage({ params }: PageProps) {
  const { departmentId } = await params;

  const supabase = await createClient();
  const { data: isPlatformAdmin } = await supabase.rpc("is_platform_admin");

  if (!isPlatformAdmin) notFound();

  const admin = createAdminClient();

  const { data: department } = await admin
    .from("departments")
    .select("id,name")
    .eq("id", departmentId)
    .maybeSingle();

  if (!department) notFound();

  const { data: memberships, error } = await admin
    .from("department_memberships")
    .select(`
      user_id,
      badge_number,
      rank_title,
      is_active,
      activation_status,
      profiles (
        full_name,
        email
      )
    `)
    .eq("department_id", departmentId);

  if (error) throw new Error(error.message);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <a href="/platform" className="text-sm text-blue-400">
          Back to Agencies
        </a>

        <h1 className="mt-6 text-3xl font-bold">
          {department.name}
        </h1>

        <p className="mt-2 text-sm text-slate-400">
          Personnel and account activation management.
        </p>

        <div className="mt-8 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-4">Personnel</th>
                <th className="px-5 py-4">Rank</th>
                <th className="px-5 py-4">Badge</th>
                <th className="px-5 py-4">Email</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Activation</th>
                <th className="px-5 py-4">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800">
              {(memberships ?? []).map((membership) => {
                const profile = Array.isArray(membership.profiles)
                  ? membership.profiles[0]
                  : membership.profiles;

                return (
                  <tr key={membership.user_id}>
                    <td className="px-5 py-4 font-medium">
                      {profile?.full_name ?? "Unknown"}
                    </td>

                    <td className="px-5 py-4">
                      {membership.rank_title ?? "-"}
                    </td>

                    <td className="px-5 py-4">
                      {membership.badge_number ?? "-"}
                    </td>

                    <td className="px-5 py-4">
                      {profile?.email ?? "-"}
                    </td>

                    <td className="px-5 py-4">
                      {membership.is_active ? "Active" : "Inactive"}
                    </td>

                    <td className="px-5 py-4">
                      {membership.activation_status?.replaceAll("_", " ") ?? "-"}
                    </td>

                    <td className="px-5 py-4">
                      <ActivationButton
                        departmentId={departmentId}
                        userId={membership.user_id}
                        activationStatus={membership.activation_status}
                      />
                      <AdministratorButton
                        departmentId={departmentId}
                        userId={membership.user_id}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}