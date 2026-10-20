/* eslint-disable @typescript-eslint/no-explicit-any -- legacy dynamic database boundary */
// Ammunition actor names. The AWS runtime client has no Supabase Auth
// directory; its users are represented by profiles.
export async function ammunitionUserNames(admin: any, userIds: unknown[]) {
  if (process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE !== "aws-native") {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw new Error(error.message);
    return new Map<string, string>(
      (data?.users ?? []).map((user: any) => [
        user.id,
        user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Unknown User",
      ]),
    );
  }
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (!ids.length) return new Map<string, string>();
  const { data, error } = await admin.from("profiles").select("id,full_name,email").in("id", ids);
  if (error) throw new Error(error.message);
  return new Map<string, string>(
    (data ?? []).map((profile: any) => [profile.id, profile.full_name || profile.email || "Unknown User"]),
  );
}
