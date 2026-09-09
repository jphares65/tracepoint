import "server-only";
import { S3Client } from "@aws-sdk/client-s3";
import { createObjectStore as createSupabaseStore, type SupabaseStorageClient, type ObjectStore } from "./object-store-core";
import { S3ObjectStore, requireS3Configuration } from "./s3-object-store-core";
export { attachmentPathFromMetadata, ObjectStoreConfigurationError, SupabaseObjectStore } from "./object-store-core";
export { departmentPatchPathFromMetadata } from "./s3-object-store-core";
export type { AttachmentObjectPath, DepartmentAssetObjectPath, ObjectStore } from "./object-store-core";
export function createObjectStore(client:SupabaseStorageClient,authorizedDepartmentId:string,environment:Record<string,string|undefined>=process.env):ObjectStore {
 const provider=environment.TRACEPOINT_STORAGE_PROVIDER?.trim().toLowerCase()||'supabase';
 if(provider!=='s3')return createSupabaseStore(client,environment);
 const target=requireS3Configuration(environment);
 // Default SDK credential chain obtains temporary ECS task-role credentials.
 return new S3ObjectStore(new S3Client({region:target.region,maxAttempts:1}),target.bucket,target.account,authorizedDepartmentId);
}
