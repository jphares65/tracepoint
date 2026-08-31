import "server-only";

export {
  attachmentPathFromMetadata,
  createObjectStore,
  ObjectStoreConfigurationError,
  SupabaseObjectStore,
} from "./object-store-core";

export type {
  AttachmentObjectPath,
  DepartmentAssetObjectPath,
  ObjectStore,
} from "./object-store-core";
