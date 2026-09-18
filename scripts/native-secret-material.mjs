import { randomBytes } from "node:crypto";

const base64url = (bytes) => bytes.toString("base64url");

export function parseNativeKeyring(raw, name) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error(`${name} must be valid JSON.`); }
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.active !== "string" || !value.keys || typeof value.keys !== "object" || Array.isArray(value.keys)) {
    throw new Error(`${name} must be a versioned keyring.`);
  }
  const entries = Object.entries(value.keys);
  if (entries.length < 1 || entries.length > 3 || !Object.hasOwn(value.keys, value.active)) throw new Error(`${name} must contain one to three keys and an existing active key id.`);
  for (const [id, key] of entries) {
    if (!/^[a-z0-9-]{1,48}$/.test(id) || typeof key !== "string" || Buffer.from(key, "base64url").length !== 32) throw new Error(`${name} contains invalid key material.`);
  }
  return value;
}

export function generateNativeSecretMaterial(now = new Date(), random = randomBytes) {
  const id = `v${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const keyring = () => JSON.stringify({ active: id, keys: { [id]: base64url(random(32)) } });
  return {
    TRACEPOINT_IMPORT_APPROVAL_SECRET: base64url(random(32)),
    TRACEPOINT_AUTH_STATE_KEYS: keyring(),
    TRACEPOINT_AUTH_REFRESH_KEYS: keyring(),
  };
}

export function rotateNativeKeyring(raw, name, now = new Date(), random = randomBytes) {
  const current = parseNativeKeyring(raw, name);
  const id = `v${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  if (Object.hasOwn(current.keys, id)) throw new Error(`${name} already contains rotation id ${id}.`);
  const retained = Object.entries(current.keys).filter(([key]) => key === current.active).slice(0, 1);
  return JSON.stringify({ active: id, keys: Object.fromEntries([[id, base64url(random(32))], ...retained]) });
}

export function validateNativeSecretMaterial(secret) {
  if (!secret || typeof secret !== "object" || typeof secret.TRACEPOINT_IMPORT_APPROVAL_SECRET !== "string" || Buffer.from(secret.TRACEPOINT_IMPORT_APPROVAL_SECRET, "base64url").length !== 32) throw new Error("TRACEPOINT_IMPORT_APPROVAL_SECRET must be 32 random bytes encoded as base64url.");
  parseNativeKeyring(secret.TRACEPOINT_AUTH_STATE_KEYS, "TRACEPOINT_AUTH_STATE_KEYS");
  parseNativeKeyring(secret.TRACEPOINT_AUTH_REFRESH_KEYS, "TRACEPOINT_AUTH_REFRESH_KEYS");
  if (secret.TRACEPOINT_AUTH_STATE_KEYS === secret.TRACEPOINT_AUTH_REFRESH_KEYS) throw new Error("State and refresh keyrings must be independent.");
  return true;
}
