export type ObjectStoreError = { message: string };

export type AttachmentObjectPath = string & { readonly __attachmentObjectPath: unique symbol };
export type DepartmentAssetObjectPath = string & { readonly __departmentAssetObjectPath: unique symbol };
export type StoredObjectResult<Path> = { path: Path; error: ObjectStoreError | null };
export type ObjectStoreResult = { error: ObjectStoreError | null };
export type SignedDownloadResult = { signedUrl: string | null; error: ObjectStoreError | null };

export interface ObjectStore {
  uploadQualificationEvidence(input: AttachmentUploadInput): Promise<StoredObjectResult<AttachmentObjectPath>>;
  uploadTrainingFile(input: AttachmentUploadInput): Promise<StoredObjectResult<AttachmentObjectPath>>;
  uploadFirearmAttachment(input: AttachmentUploadInput): Promise<StoredObjectResult<AttachmentObjectPath>>;
  uploadDrillDocument(input: AttachmentUploadInput): Promise<StoredObjectResult<AttachmentObjectPath>>;
  removeAttachment(path: AttachmentObjectPath): Promise<ObjectStoreResult>;
  createAttachmentDownload(path: AttachmentObjectPath, fileName: string): Promise<SignedDownloadResult>;
  createAttachmentView(path: AttachmentObjectPath): Promise<SignedDownloadResult>;
  uploadDepartmentPatch(input: DepartmentPatchUploadInput): Promise<StoredObjectResult<DepartmentAssetObjectPath>>;
  createDepartmentPatchDelivery(path: DepartmentAssetObjectPath): Promise<SignedDownloadResult>;
  createDepartmentPatchView(path: DepartmentAssetObjectPath): Promise<SignedDownloadResult>;
  removeDepartmentPatch(path: DepartmentAssetObjectPath): Promise<ObjectStoreResult>;
}

export type AttachmentUploadInput = {
  departmentId: string;
  recordId: string;
  objectId: string;
  fileName: string;
  bytes: Uint8Array;
  contentType: string;
};

export type DepartmentPatchUploadInput = {
  departmentId: string;
  extension: "png" | "jpg" | "webp";
  bytes: Uint8Array;
  contentType: string;
  timestamp: number;
};

export type AttachmentDomain = "qualification" | "agency-training" | "firearm" | "drill-document";
export type StorageProvider = "s3" | "supabase";
export type StorageRuntimeEnvironment = Record<string, string | undefined> & {
  TRACEPOINT_RUNTIME_PROVIDER_MODE?: string;
  TRACEPOINT_STORAGE_PROVIDER?: string;
};

export class ObjectStoreConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStoreConfigurationError";
  }
}

const ATTACHMENT_POLICIES: Record<AttachmentDomain, { maxBytes: number; contentTypes?: ReadonlySet<string> }> = {
  qualification: { maxBytes: 15 * 1024 * 1024, contentTypes: new Set(["image/jpeg", "image/png", "image/webp"]) },
  "agency-training": { maxBytes: 25 * 1024 * 1024 },
  firearm: { maxBytes: 15 * 1024 * 1024, contentTypes: new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]) },
  "drill-document": { maxBytes: 15 * 1024 * 1024, contentTypes: new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]) },
};

const CONTENT_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATTACHMENT_DOMAINS = new Set<AttachmentDomain>(Object.keys(ATTACHMENT_POLICIES) as AttachmentDomain[]);

function attachmentPath(path: string): AttachmentObjectPath {
  return path as AttachmentObjectPath;
}

function departmentAssetPath(path: string): DepartmentAssetObjectPath {
  return path as DepartmentAssetObjectPath;
}

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

function safeName(name: string, fallback: string, collapseHyphens: boolean) {
  const replaced = name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const normalized = collapseHyphens ? replaced.replace(/-+/g, "-") : replaced;
  return normalized.slice(-120) || fallback;
}

function assertSafeIdentifier(value: string, label: string) {
  if (!value || value.startsWith("/") || value.includes("\\") || /[\x00-\x1f\x7f]/.test(value) || value === "." || value === "..") {
    throw new Error(`Invalid ${label}`);
  }
  const encoded = encodeURIComponent(value);
  if (safelyDecodePathSegment(encoded) !== value) throw new Error(`Invalid ${label}`);
}

export function selectStorageProvider(environment: StorageRuntimeEnvironment): StorageProvider {
  const mode = environment.TRACEPOINT_RUNTIME_PROVIDER_MODE?.trim().toLowerCase();
  const provider = environment.TRACEPOINT_STORAGE_PROVIDER?.trim().toLowerCase();
  if (provider === "s3" && (mode === "aws-native" || mode === "bridge")) return "s3";
  if (provider === "supabase" && mode === "bridge") return "supabase";
  throw new ObjectStoreConfigurationError("Storage provider configuration is missing or incompatible with the runtime mode.");
}

export async function loadSelectedObjectStore(
  environment: StorageRuntimeEnvironment,
  providers: Record<StorageProvider, () => ObjectStore | Promise<ObjectStore>>,
) {
  return providers[selectStorageProvider(environment)]();
}

export function attachmentPathFromMetadata(path: string, authorizedDepartmentId: string): AttachmentObjectPath | null {
  if (!path || !authorizedDepartmentId || path.startsWith("/") || path.includes("\\")) return null;
  const segments = path.split("/");
  if (segments.length !== 4 || segments[0] !== authorizedDepartmentId || !ATTACHMENT_DOMAINS.has(segments[1] as AttachmentDomain) || segments.some((segment) => !segment)) return null;

  for (const [index, segment] of segments.entries()) {
    const decoded = safelyDecodePathSegment(segment);
    const decodedParts = decoded?.split("/") ?? [];
    const qualificationRecordSegment = index === 2 && segments[1] === "qualification";
    if (decoded === null || decoded.includes("%") || decoded.includes("\\") || /[\x00-\x1f\x7f]/.test(decoded) || (!qualificationRecordSegment && decoded.includes("/")) || decodedParts.some((part) => !part || part === "." || part === "..")) return null;
  }
  return attachmentPath(path);
}

export function attachmentPathForUpload(domain: AttachmentDomain, input: AttachmentUploadInput, authorizedDepartmentId: string): AttachmentObjectPath {
  const policy = ATTACHMENT_POLICIES[domain];
  if (input.departmentId !== authorizedDepartmentId) throw new Error("Department mismatch");
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength <= 0 || input.bytes.byteLength > policy.maxBytes) throw new Error("Invalid attachment size");
  if (!CONTENT_TYPE.test(input.contentType) || (policy.contentTypes && !policy.contentTypes.has(input.contentType))) throw new Error("Invalid attachment content type");
  assertSafeIdentifier(input.recordId, "record identifier");
  assertSafeIdentifier(input.objectId, "object identifier");
  const encodedRecordId = domain === "qualification" || domain === "drill-document" ? encodeURIComponent(input.recordId) : input.recordId;
  const fallback = domain === "qualification" ? "target-photo" : domain === "firearm" ? "attachment" : domain === "drill-document" ? "document" : "file";
  const path = `${input.departmentId}/${domain}/${encodedRecordId}/${input.objectId}-${safeName(input.fileName, fallback, domain !== "agency-training")}`;
  const validated = attachmentPathFromMetadata(path, authorizedDepartmentId);
  if (!validated) throw new Error("Invalid attachment path");
  return validated;
}

export function departmentPatchPathFromMetadata(path: string, authorizedDepartmentId: string): DepartmentAssetObjectPath | null {
  if (!UUID.test(authorizedDepartmentId) || !path.startsWith(`${authorizedDepartmentId}/`)) return null;
  return /^patch-[0-9]+\.(png|jpg|webp)$/.test(path.slice(authorizedDepartmentId.length + 1)) ? departmentAssetPath(path) : null;
}

export function departmentPatchPathForUpload(input: DepartmentPatchUploadInput, authorizedDepartmentId: string): DepartmentAssetObjectPath {
  const expectedContentType = input.extension === "jpg" ? "image/jpeg" : `image/${input.extension}`;
  if (input.departmentId !== authorizedDepartmentId) throw new Error("Department mismatch");
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength <= 0 || input.bytes.byteLength > 5 * 1024 * 1024) throw new Error("Invalid patch size");
  if (input.contentType !== expectedContentType || !Number.isSafeInteger(input.timestamp) || input.timestamp <= 0) throw new Error("Invalid patch metadata");
  const path = departmentPatchPathFromMetadata(`${input.departmentId}/patch-${input.timestamp}.${input.extension}`, authorizedDepartmentId);
  if (!path) throw new Error("Invalid patch path");
  return path;
}
