import { createHmac, timingSafeEqual } from "node:crypto";

import type { CognitoEncryptionKeyring } from "@/lib/authentication/cognito-runtime-configuration-core";
import type { AttachmentObjectPath } from "./object-store-core";

export type MobileUploadIntent = {
  v: 1;
  attachmentId: string;
  departmentId: string;
  userId: string;
  vehicleId: string;
  inspectionId: string;
  checklistItemId: string;
  fileName: string;
  contentType: string;
  size: number;
  path: AttachmentObjectPath;
  expiresAt: number;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_TTL_SECONDS = 120;
const context = "tracepoint-mobile-upload-intent-v1";

function signingKey(keyring: CognitoEncryptionKeyring) {
  const key = keyring.keys.get(keyring.active);
  if (!key) throw new Error("The active upload signing key is unavailable.");
  return createHmac("sha256", key).update(context).digest();
}

function valid(intent: MobileUploadIntent, nowSeconds: number) {
  return intent.v === 1 &&
    [intent.attachmentId, intent.departmentId, intent.userId, intent.vehicleId, intent.inspectionId].every((value) => uuid.test(value)) &&
    intent.checklistItemId.length > 0 && intent.checklistItemId.length <= 100 &&
    intent.fileName.length > 0 && intent.fileName.length <= 500 &&
    intent.contentType.length > 0 && intent.contentType.length <= 255 &&
    Number.isSafeInteger(intent.size) && intent.size > 0 &&
    Number.isSafeInteger(intent.expiresAt) && intent.expiresAt >= nowSeconds && intent.expiresAt <= nowSeconds + TOKEN_TTL_SECONDS;
}

export function sealMobileUploadIntent(
  input: Omit<MobileUploadIntent, "v" | "expiresAt">,
  keyring: CognitoEncryptionKeyring,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const payload: MobileUploadIntent = { ...input, v: 1, expiresAt: nowSeconds + TOKEN_TTL_SECONDS };
  if (!valid(payload, nowSeconds)) throw new Error("Invalid upload intent.");
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", signingKey(keyring)).update(encoded).digest("base64url");
  return `${keyring.active}.${encoded}.${signature}`;
}

export function openMobileUploadIntent(
  token: string,
  keyring: CognitoEncryptionKeyring,
  nowSeconds = Math.floor(Date.now() / 1000),
): MobileUploadIntent | null {
  if (!token || token.length > 4096) return null;
  const [keyId, encoded, supplied] = token.split(".");
  const sourceKey = keyring.keys.get(keyId);
  if (!sourceKey || !encoded || !supplied) return null;
  const derived = createHmac("sha256", sourceKey).update(context).digest();
  const expected = createHmac("sha256", derived).update(encoded).digest();
  let actual: Buffer;
  try { actual = Buffer.from(supplied, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as MobileUploadIntent;
    return valid(parsed, nowSeconds) ? parsed : null;
  } catch {
    return null;
  }
}
