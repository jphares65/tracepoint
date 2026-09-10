import { notFound } from "next/navigation";
import Link from "next/link";

import { resolvePlatformAdminAccess } from "@/lib/platform/admin-access";
import ActivationButton from "./ActivationButton";
import AdministratorButton from "./AdministratorButton";
import AccessAgencyButton from "./AccessAgencyButton";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ departmentId: string }>;
};

export default async function PlatformAgencyPage({ params }: PageProps) {
  const { departmentId } = await params;

  const access = await resolvePlatformAdminAccess();
  if (!access.ok) notFound();
  const detail = await access.repository.getAgency(departmentId);
  if (!detail) notFound();
  const { agency: department, members: memberships } = detail;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <Link href="/platform" className="text-sm text-blue-400">
          Back to Agencies
        </Link>

        <h1 className="mt-6 text-3xl font-bold">
          {department.name}
        </h1>

        <div className="mt-2 flex items-center justify-between gap-4">
          <p className="text-sm text-slate-400">
            Personnel and account activation management.
          </p>

          <AccessAgencyButton departmentId={departmentId} />
        </div>

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
              {memberships.map((membership) => {
                return (
                  <tr key={membership.user_id}>
                    <td className="px-5 py-4 font-medium">
                      {membership.full_name ?? "Unknown"}
                    </td>

                    <td className="px-5 py-4">
                      {membership.rank_title ?? "-"}
                    </td>

                    <td className="px-5 py-4">
                      {membership.badge_number ?? "-"}
                    </td>

                    <td className="px-5 py-4">
                      {membership.email ?? "-"}
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
