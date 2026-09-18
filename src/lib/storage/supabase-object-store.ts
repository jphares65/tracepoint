import {
  attachmentPathForUpload,
  attachmentPathFromMetadata,
  departmentPatchPathForUpload,
  departmentPatchPathFromMetadata,
  type AttachmentDomain,
  type AttachmentObjectPath,
  type AttachmentUploadInput,
  type DepartmentAssetObjectPath,
  type DepartmentPatchUploadInput,
  type ObjectStore,
  type ObjectStoreError,
} from "./object-store-core";

type StorageResponse<T = unknown> = {
  data: T | null;
  error: ObjectStoreError | null;
};

type SupabaseBucket = {
  upload(path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }): Promise<StorageResponse>;
  remove(paths: string[]): Promise<StorageResponse>;
  createSignedUrl(path: string, expiresIn: number, options: { download?: string }): Promise<StorageResponse<{ signedUrl?: string }>>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
};

export type SupabaseStorageClient = {
  storage: {
    from(bucket: "tracepoint-attachments" | "department-assets"): SupabaseBucket;
  };
};

export function createSupabaseObjectStore(client: unknown, departmentId: string) {
  if (!client || typeof client !== "object" || !("storage" in client)) {
    throw new Error("Legacy storage client is unavailable");
  }
  return new SupabaseObjectStore(client as SupabaseStorageClient, departmentId);
}

export class SupabaseObjectStore implements ObjectStore {
  constructor(
    private readonly client: SupabaseStorageClient,
    private readonly departmentId: string,
  ) {}

  uploadQualificationEvidence(input: AttachmentUploadInput) {
    return this.uploadAttachment("qualification", input);
  }

  uploadTrainingFile(input: AttachmentUploadInput) {
    return this.uploadAttachment("agency-training", input);
  }

  uploadFirearmAttachment(input: AttachmentUploadInput) {
    return this.uploadAttachment("firearm", input);
  }

  uploadDrillDocument(input: AttachmentUploadInput) {
    return this.uploadAttachment("drill-document", input);
  }

  async removeAttachment(path: AttachmentObjectPath) {
    const result = await this.client.storage.from("tracepoint-attachments").remove([this.attachment(path)]);
    return { error: result.error };
  }

  async createAttachmentDownload(path: AttachmentObjectPath, fileName: string) {
    const result = await this.client.storage
      .from("tracepoint-attachments")
      .createSignedUrl(this.attachment(path), 60, { download: fileName });
    return { signedUrl: result.data?.signedUrl ?? null, error: result.error };
  }

  async createAttachmentView(path: AttachmentObjectPath) {
    const result = await this.client.storage
      .from("tracepoint-attachments")
      .createSignedUrl(this.attachment(path), 60, {});
    return { signedUrl: result.data?.signedUrl ?? null, error: result.error };
  }

  async uploadDepartmentPatch(input: DepartmentPatchUploadInput) {
    const path = departmentPatchPathForUpload(input, this.departmentId);
    const result = await this.client.storage.from("department-assets").upload(path, input.bytes, {
      contentType: input.contentType,
      upsert: true,
    });
    return { path, error: result.error };
  }

  async createDepartmentPatchDelivery(path: DepartmentAssetObjectPath) {
    const validated = this.patch(path);
    return {
      signedUrl: this.client.storage.from("department-assets").getPublicUrl(validated).data.publicUrl,
      error: null,
    };
  }

  createDepartmentPatchView(path: DepartmentAssetObjectPath) {
    return this.createDepartmentPatchDelivery(path);
  }

  async removeDepartmentPatch(path: DepartmentAssetObjectPath) {
    const result = await this.client.storage.from("department-assets").remove([this.patch(path)]);
    return { error: result.error };
  }

  private attachment(path: string) {
    const validated = attachmentPathFromMetadata(path, this.departmentId);
    if (!validated) throw new Error("Invalid authorized object path");
    return validated;
  }

  private patch(path: string) {
    const validated = departmentPatchPathFromMetadata(path, this.departmentId);
    if (!validated) throw new Error("Invalid authorized patch path");
    return validated;
  }

  private async uploadAttachment(domain: AttachmentDomain, input: AttachmentUploadInput) {
    const path = attachmentPathForUpload(domain, input, this.departmentId);
    const result = await this.client.storage.from("tracepoint-attachments").upload(path, input.bytes, {
      contentType: input.contentType,
      upsert: false,
    });
    return { path, error: result.error };
  }
}
