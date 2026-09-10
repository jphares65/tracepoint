import { createHash } from "node:crypto";

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
} from "./object-store-core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRESIGNED_URL_TTL_SECONDS = 60;
const failure = () => ({ message: "Object storage operation failed." });

export function requireS3Configuration(env: Record<string, string | undefined>) {
  const account = env.TRACEPOINT_S3_EXPECTED_OWNER;
  const region = env.AWS_REGION;
  const environment = env.CONFIGURATION_ENVIRONMENT;
  if (!account || !/^\d{12}$/.test(account) || account === "265544358665" || !region || !/^(us-east-1|us-gov-west-1|us-gov-east-1)$/.test(region)) {
    throw new Error("Invalid private storage target");
  }
  if (environment === "staging" ? account !== "559054714699" || region !== "us-east-1" : environment !== "production" || account === "559054714699") {
    throw new Error("Storage environment mismatch");
  }
  const bucket = `tracepoint-${environment}-private-${account}`;
  if (env.TRACEPOINT_S3_BUCKET !== bucket) throw new Error("Storage bucket mismatch");
  return { account, region, bucket };
}

type Signer = typeof getSignedUrl;

export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly account: string,
    private readonly departmentId: string,
    private readonly sign: Signer = getSignedUrl,
  ) {
    if (!UUID.test(departmentId)) throw new Error("Authorized department is required");
  }

  uploadQualificationEvidence(input: AttachmentUploadInput) {
    return this.upload("qualification", input);
  }

  uploadTrainingFile(input: AttachmentUploadInput) {
    return this.upload("agency-training", input);
  }

  uploadFirearmAttachment(input: AttachmentUploadInput) {
    return this.upload("firearm", input);
  }

  uploadDrillDocument(input: AttachmentUploadInput) {
    return this.upload("drill-document", input);
  }

  async removeAttachment(path: AttachmentObjectPath) {
    const key = `attachments/${this.attachment(path)}`;
    try {
      await this.client.send(new DeleteObjectCommand(this.object(key)));
      return { error: null };
    } catch {
      return { error: failure() };
    }
  }

  createAttachmentDownload(path: AttachmentObjectPath, fileName: string) {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "download";
    return this.signed(`attachments/${this.attachment(path)}`, `attachment; filename="${safeName}"`);
  }

  createAttachmentView(path: AttachmentObjectPath) {
    return this.signed(`attachments/${this.attachment(path)}`, "inline");
  }

  async uploadDepartmentPatch(input: DepartmentPatchUploadInput) {
    const path = departmentPatchPathForUpload(input, this.departmentId);
    try {
      await this.client.send(new PutObjectCommand({
        ...this.object(`department-assets/${path}`),
        Body: input.bytes,
        ContentLength: input.bytes.byteLength,
        ContentType: input.contentType,
        ChecksumSHA256: checksum(input.bytes),
        IfNoneMatch: "*",
        Metadata: { "tracepoint-department-id": this.departmentId, "tracepoint-domain": "department-patch" },
      }));
      return { path, error: null };
    } catch {
      return { path, error: failure() };
    }
  }

  async createDepartmentPatchDelivery(path: DepartmentAssetObjectPath) {
    return { signedUrl: `/api/settings/department-patch?path=${encodeURIComponent(this.patch(path))}`, error: null };
  }

  createDepartmentPatchView(path: DepartmentAssetObjectPath) {
    return this.signed(`department-assets/${this.patch(path)}`, "inline");
  }

  async removeDepartmentPatch(path: DepartmentAssetObjectPath) {
    const key = `department-assets/${this.patch(path)}`;
    try {
      await this.client.send(new DeleteObjectCommand(this.object(key)));
      return { error: null };
    } catch {
      return { error: failure() };
    }
  }

  private attachment(path: string) {
    const safe = attachmentPathFromMetadata(path, this.departmentId);
    if (!safe) throw new Error("Invalid authorized object path");
    return safe;
  }

  private patch(path: string) {
    const safe = departmentPatchPathFromMetadata(path, this.departmentId);
    if (!safe) throw new Error("Invalid authorized patch path");
    return safe;
  }

  private object(key: string) {
    return { Bucket: this.bucket, Key: key, ExpectedBucketOwner: this.account };
  }

  private async upload(domain: AttachmentDomain, input: AttachmentUploadInput) {
    const path = attachmentPathForUpload(domain, input, this.departmentId);
    try {
      await this.client.send(new PutObjectCommand({
        ...this.object(`attachments/${path}`),
        Body: input.bytes,
        ContentLength: input.bytes.byteLength,
        ContentType: input.contentType,
        ChecksumSHA256: checksum(input.bytes),
        IfNoneMatch: "*",
        Metadata: {
          "tracepoint-department-id": this.departmentId,
          "tracepoint-domain": domain,
          "tracepoint-object-id": input.objectId,
        },
      }));
      return { path, error: null };
    } catch {
      return { path, error: failure() };
    }
  }

  private async signed(key: string, disposition?: string) {
    try {
      const command = new GetObjectCommand({ ...this.object(key), ResponseContentDisposition: disposition });
      const signedUrl = await this.sign(this.client, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
      return { signedUrl, error: null };
    } catch {
      return { signedUrl: null, error: failure() };
    }
  }
}

function checksum(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("base64");
}
