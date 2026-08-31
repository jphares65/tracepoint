export type ObjectStoreError = { message: string };

export type AttachmentObjectPath = string & {
  readonly __attachmentObjectPath: unique symbol;
};

export type DepartmentAssetObjectPath = string & {
  readonly __departmentAssetObjectPath: unique symbol;
};

export type StoredObjectResult<Path> = {
  path: Path;
  error: ObjectStoreError | null;
};

export type ObjectStoreResult = {
  error: ObjectStoreError | null;
};

export type SignedDownloadResult = {
  signedUrl: string | null;
  error: ObjectStoreError | null;
};

export interface ObjectStore {
  uploadQualificationEvidence(input: AttachmentUploadInput): Promise<StoredObjectResult<AttachmentObjectPath>>;
  uploadTrainingFile(input: AttachmentUploadInput): Promise<StoredObjectResult<AttachmentObjectPath>>;
  uploadFirearmAttachment(input: AttachmentUploadInput): Promise<StoredObjectResult<AttachmentObjectPath>>;
  removeAttachment(path: AttachmentObjectPath): Promise<ObjectStoreResult>;
  createAttachmentDownload(
    path: AttachmentObjectPath,
    fileName: string,
  ): Promise<SignedDownloadResult>;
  uploadDepartmentPatch(input: DepartmentPatchUploadInput): Promise<StoredObjectResult<DepartmentAssetObjectPath>>;
  getDepartmentPatchPublicUrl(path: DepartmentAssetObjectPath): string;
  removeDepartmentPatch(path: DepartmentAssetObjectPath): Promise<ObjectStoreResult>;
}

type AttachmentUploadInput = {
  departmentId: string;
  recordId: string;
  objectId: string;
  fileName: string;
  bytes: Uint8Array;
  contentType: string;
};

type DepartmentPatchUploadInput = {
  departmentId: string;
  extension: "png" | "jpg" | "webp";
  bytes: Uint8Array;
  contentType: string;
  timestamp: number;
};

type StorageResponse<T = unknown> = {
  data: T | null;
  error: ObjectStoreError | null;
};

type SupabaseBucket = {
  upload(
    path: string,
    body: Uint8Array,
    options: { contentType: string; upsert: boolean },
  ): Promise<StorageResponse>;
  remove(paths: string[]): Promise<StorageResponse>;
  createSignedUrl(
    path: string,
    expiresIn: number,
    options: { download: string },
  ): Promise<StorageResponse<{ signedUrl?: string }>>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
};

export type SupabaseStorageClient = {
  storage: {
    from(bucket: "tracepoint-attachments" | "department-assets"): SupabaseBucket;
  };
};

function safeName(name: string, fallback: string, collapseHyphens: boolean) {
  const replaced = name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const normalized = collapseHyphens ? replaced.replace(/-+/g, "-") : replaced;
  return normalized.slice(-120) || fallback;
}

function attachmentPath(path: string): AttachmentObjectPath {
  return path as AttachmentObjectPath;
}

const ATTACHMENT_DOMAINS = new Set([
  "qualification",
  "agency-training",
  "firearm",
]);

function safelyDecodePathSegment(segment: string) {
  let decoded = segment;
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return null;
    }
  }
  return decoded;
}

export function attachmentPathFromMetadata(
  path: string,
  authorizedDepartmentId: string,
): AttachmentObjectPath | null {
  if (!path || !authorizedDepartmentId || path.startsWith("/") || path.includes("\\")) {
    return null;
  }

  const segments = path.split("/");
  if (
    segments.length !== 4 ||
    segments[0] !== authorizedDepartmentId ||
    !ATTACHMENT_DOMAINS.has(segments[1]) ||
    segments.some((segment) => !segment)
  ) {
    return null;
  }

  for (const [index, segment] of segments.entries()) {
    const decoded = safelyDecodePathSegment(segment);
    const decodedParts = decoded?.split("/") ?? [];
    const qualificationRecordSegment =
      index === 2 && segments[1] === "qualification";
    if (
      decoded === null ||
      decoded.includes("\\") ||
      (!qualificationRecordSegment && decoded.includes("/")) ||
      decodedParts.some((part) => !part || part === "." || part === "..")
    ) {
      return null;
    }
  }

  return attachmentPath(path);
}

function departmentAssetPath(path: string): DepartmentAssetObjectPath {
  return path as DepartmentAssetObjectPath;
}

export class SupabaseObjectStore implements ObjectStore {
  private readonly client: SupabaseStorageClient;

  constructor(client: SupabaseStorageClient) {
    this.client = client;
  }

  uploadQualificationEvidence(input: AttachmentUploadInput) {
    return this.uploadAttachment(
      attachmentPath(
        `${input.departmentId}/qualification/${encodeURIComponent(input.recordId)}/${input.objectId}-${safeName(input.fileName, "target-photo", true)}`,
      ),
      input,
    );
  }

  uploadTrainingFile(input: AttachmentUploadInput) {
    return this.uploadAttachment(
      attachmentPath(
        `${input.departmentId}/agency-training/${input.recordId}/${input.objectId}-${safeName(input.fileName, "file", false)}`,
      ),
      input,
    );
  }

  uploadFirearmAttachment(input: AttachmentUploadInput) {
    return this.uploadAttachment(
      attachmentPath(
        `${input.departmentId}/firearm/${input.recordId}/${input.objectId}-${safeName(input.fileName, "attachment", true)}`,
      ),
      input,
    );
  }

  async removeAttachment(path: AttachmentObjectPath): Promise<ObjectStoreResult> {
    const result = await this.client.storage.from("tracepoint-attachments").remove([path]);
    return { error: result.error };
  }

  async createAttachmentDownload(
    path: AttachmentObjectPath,
    fileName: string,
  ): Promise<SignedDownloadResult> {
    const result = await this.client.storage
      .from("tracepoint-attachments")
      .createSignedUrl(path, 60, { download: fileName });
    return {
      signedUrl: result.data?.signedUrl ?? null,
      error: result.error,
    };
  }

  async uploadDepartmentPatch(
    input: DepartmentPatchUploadInput,
  ): Promise<StoredObjectResult<DepartmentAssetObjectPath>> {
    const path = departmentAssetPath(
      `${input.departmentId}/patch-${input.timestamp}.${input.extension}`,
    );
    const result = await this.client.storage.from("department-assets").upload(
      path,
      input.bytes,
      { contentType: input.contentType, upsert: true },
    );
    return { path, error: result.error };
  }

  getDepartmentPatchPublicUrl(path: DepartmentAssetObjectPath) {
    return this.client.storage.from("department-assets").getPublicUrl(path).data.publicUrl;
  }

  async removeDepartmentPatch(path: DepartmentAssetObjectPath): Promise<ObjectStoreResult> {
    const result = await this.client.storage.from("department-assets").remove([path]);
    return { error: result.error };
  }

  private async uploadAttachment(
    path: AttachmentObjectPath,
    input: AttachmentUploadInput,
  ): Promise<StoredObjectResult<AttachmentObjectPath>> {
    const result = await this.client.storage.from("tracepoint-attachments").upload(
      path,
      input.bytes,
      { contentType: input.contentType, upsert: false },
    );
    return { path, error: result.error };
  }
}

export class ObjectStoreConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStoreConfigurationError";
  }
}

export function createObjectStore(
  client: SupabaseStorageClient,
  environment?: { TRACEPOINT_STORAGE_PROVIDER?: string },
): ObjectStore {
  const configuredProvider = environment
    ? environment.TRACEPOINT_STORAGE_PROVIDER
    : process.env.TRACEPOINT_STORAGE_PROVIDER;
  const provider = configuredProvider?.trim().toLowerCase() || "supabase";
  if (provider !== "supabase") {
    throw new ObjectStoreConfigurationError(
      `Unsupported storage provider: ${provider}. Only supabase is implemented.`,
    );
  }
  return new SupabaseObjectStore(client);
}
