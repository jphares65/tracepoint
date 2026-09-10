import "server-only";

import { S3Client } from "@aws-sdk/client-s3";

import {
  loadSelectedObjectStore,
  type ObjectStore,
  type StorageRuntimeEnvironment,
} from "./object-store-core";
import { requireS3Configuration, S3ObjectStore } from "./s3-object-store-core";

export {
  attachmentPathFromMetadata,
  departmentPatchPathFromMetadata,
  ObjectStoreConfigurationError,
  selectStorageProvider,
} from "./object-store-core";
export type { AttachmentObjectPath, DepartmentAssetObjectPath, ObjectStore } from "./object-store-core";

const s3Clients = new Map<string, S3Client>();

function s3Client(region: string) {
  const existing = s3Clients.get(region);
  if (existing) return existing;
  const client = new S3Client({ region, maxAttempts: 1 });
  s3Clients.set(region, client);
  return client;
}

export async function createObjectStore(
  legacyClient: unknown,
  authorizedDepartmentId: string,
  environment: StorageRuntimeEnvironment = process.env,
): Promise<ObjectStore> {
  return loadSelectedObjectStore(environment, {
    s3: () => {
      const target = requireS3Configuration(environment);
      return new S3ObjectStore(s3Client(target.region), target.bucket, target.account, authorizedDepartmentId);
    },
    supabase: async () => {
      const { createSupabaseObjectStore } = await import("./supabase-object-store");
      return createSupabaseObjectStore(legacyClient, authorizedDepartmentId);
    },
  });
}
