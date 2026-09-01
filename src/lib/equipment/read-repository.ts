import "server-only";

import {
  requireEquipmentReadProvider,
  TenantBoundEquipmentReadRepository,
} from "./read-repository-core";
import {
  SupabaseEquipmentReadDataSource,
  type EquipmentReadSupabaseClient,
} from "./read-repository-supabase";

export function createEquipmentReadRepository(
  client: EquipmentReadSupabaseClient,
  departmentId: string,
  environment?: { TRACEPOINT_DATA_PROVIDER?: string },
) {
  requireEquipmentReadProvider(
    environment
      ? environment.TRACEPOINT_DATA_PROVIDER
      : process.env.TRACEPOINT_DATA_PROVIDER,
  );
  return new TenantBoundEquipmentReadRepository(
    new SupabaseEquipmentReadDataSource(client),
    departmentId,
  );
}
