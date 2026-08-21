import { createClient } from "@/lib/supabase/server";
import CreateAgencyForm from "./CreateAgencyForm";

export const dynamic = "force-dynamic";

export default async function PlatformAdminPage() {
  const supabase = await createClient();

  const { data: departments, error: departmentError } = await supabase
    .from("departments")
    .select(`
      id,
      name,
      short_name,
      slug,
      state,
      county,
      agency_type,
      timezone,
      sworn_officers,
      civilian_staff,
      is_active,
      created_at
    `)
    .order("name");

  const { data: accounts, error: accountError } = await supabase
    .from("platform_agency_accounts")
    .select(`
      department_id,
      account_status,
      plan_type,
      onboarding_status,
      pilot_start_date,
      production_start_date
    `);

  const error = departmentError || accountError;

  const accountMap = new Map(
    (accounts ?? []).map((account) => [account.department_id, account])
  );

  const agencies = (departments ?? []).map((department) => ({
    ...department,
    platformAccount: accountMap.get(department.id) ?? null,
  }));

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 flex items-start justify-between gap-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-blue-400">
              TracePoint Platform Administration
            </p>

            <h1 className="mt-2 text-3xl font-bold">
              Agencies
            </h1>

            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Provision and manage TracePoint agency tenants.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs font-medium text-amber-300">
              PLATFORM ADMIN
            </div>

            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:text-white"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        <div className="mb-8">
          <CreateAgencyForm />
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">
            Unable to load platform agency information.
          </div>
        )}

        {!error && agencies.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
            <h2 className="text-lg font-semibold">
              No agencies
            </h2>

            <p className="mt-2 text-sm text-slate-400">
              Create the first TracePoint agency to begin.
            </p>
          </div>
        )}

        {!error && agencies.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 bg-slate-900/80 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-5 py-4">Agency</th>
                    <th className="px-5 py-4">Location</th>
                    <th className="px-5 py-4">Account</th>
                    <th className="px-5 py-4">Plan</th>
                    <th className="px-5 py-4">Onboarding</th>
                    <th className="px-5 py-4">Status</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800">
                  {agencies.map((agency) => (
                    <tr
                      key={agency.id}
                      className="hover:bg-slate-800/40"
                    >
                      <td className="px-5 py-4">
                        <div className="font-medium text-white">
                          {agency.name}
                        </div>

                        <div className="mt-1 text-xs text-slate-500">
                          {agency.slug}
                        </div>

                        <a
                          href={`/settings/import-export?platformDepartmentId=${agency.id}`}
                          className="mt-2 inline-flex text-xs font-medium text-blue-400 transition hover:text-blue-300"
                        >
                          Import / Onboard Data
                        </a>
                      </td>

                      <td className="px-5 py-4 text-slate-300">
                        {[agency.county, agency.state]
                          .filter(Boolean)
                          .join(", ") || "-"}
                      </td>

                      <td className="px-5 py-4">
                        <StatusBadge
                          value={
                            agency.platformAccount?.account_status ??
                            "legacy"
                          }
                        />
                      </td>

                      <td className="px-5 py-4 text-slate-300">
                        {formatLabel(
                          agency.platformAccount?.plan_type ?? "-"
                        )}
                      </td>

                      <td className="px-5 py-4 text-slate-300">
                        {formatLabel(
                          agency.platformAccount?.onboarding_status ?? "-"
                        )}
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={
                            agency.is_active
                              ? "text-emerald-400"
                              : "text-slate-500"
                          }
                        >
                          {agency.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function formatLabel(value: string) {
  if (value === "-") return value;

  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();

  let classes =
    "border-slate-700 bg-slate-800 text-slate-300";

  if (normalized === "pilot") {
    classes =
      "border-blue-800 bg-blue-950/50 text-blue-300";
  }

  if (normalized === "active") {
    classes =
      "border-emerald-800 bg-emerald-950/50 text-emerald-300";
  }

  if (normalized === "onboarding") {
    classes =
      "border-amber-800 bg-amber-950/50 text-amber-300";
  }

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${classes}`}
    >
      {formatLabel(value)}
    </span>
  );
}
