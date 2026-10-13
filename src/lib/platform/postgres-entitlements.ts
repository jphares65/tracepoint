export type PlatformEntitlements = {
  departments: Record<string, unknown>[];
  features: Record<string, unknown>[];
  entitlements: Record<string, unknown>[];
};

export type PlatformEntitlementQuery = (
  sql: string,
  values?: readonly unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

export async function listPostgresPlatformEntitlements(
  query: PlatformEntitlementQuery,
): Promise<PlatformEntitlements> {
  const result = await query("select public.get_platform_entitlements() as value");
  const value = result.rows[0]?.value as Partial<PlatformEntitlements> | undefined;
  if (
    !value ||
    !Array.isArray(value.departments) ||
    !Array.isArray(value.features) ||
    !Array.isArray(value.entitlements)
  ) {
    throw new Error("Platform entitlement response is invalid.");
  }
  return value as PlatformEntitlements;
}

export async function setPostgresPlatformEntitlement(
  query: PlatformEntitlementQuery,
  input: {
    departmentId: string;
    featureCode: string;
    isEnabled: boolean;
    reason?: string;
  },
) {
  await query(
    "select public.set_platform_entitlement($1,$2,$3,$4)",
    [input.departmentId, input.featureCode, input.isEnabled, input.reason ?? null],
  );
}
