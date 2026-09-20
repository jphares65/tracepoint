import assert from "node:assert/strict";

export const PRODUCTION_SUPABASE_URL = "https://izlkwggluhlhzlumtzes.supabase.co";

function decodeLegacyJwtPayload(value) {
  try {
    return JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

export function extractDedicatedSupabaseRestSecret(applicationSecret) {
  assert.equal(typeof applicationSecret, "object");
  assert.equal(applicationSecret?.NEXT_PUBLIC_SUPABASE_URL, PRODUCTION_SUPABASE_URL, "Application secret is not bound to the approved production Supabase project");
  const serviceRoleKey = applicationSecret?.SUPABASE_SECRET_KEY;
  assert.equal(typeof serviceRoleKey, "string");
  assert.ok(serviceRoleKey.length >= 20, "Supabase server-side key is malformed");

  if (!serviceRoleKey.startsWith("sb_secret_")) {
    const payload = decodeLegacyJwtPayload(serviceRoleKey);
    assert.equal(payload?.role, "service_role", "Supabase server-side key is not a service-role credential");
    assert.equal(payload?.ref, "izlkwggluhlhzlumtzes", "Supabase server-side key is not bound to the approved production project");
  }

  return Object.freeze({ projectUrl: PRODUCTION_SUPABASE_URL, serviceRoleKey });
}

export async function createDedicatedSupabaseRestSecret({ client, applicationSecretArn, destinationSecretName }) {
  assert.equal(applicationSecretArn, "arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/application-mkGidl");
  assert.equal(destinationSecretName, "tracepoint/production/migration/source-supabase-rest");

  let sourceSecretText;
  let sourceSecret;
  let destination;
  try {
    const source = await client.getSecretValue(applicationSecretArn);
    sourceSecretText = source.SecretString;
    assert.equal(typeof sourceSecretText, "string", "Application secret must be a JSON SecretString");
    sourceSecret = JSON.parse(sourceSecretText);
    destination = extractDedicatedSupabaseRestSecret(sourceSecret);
    const created = await client.createSecret(destinationSecretName, JSON.stringify(destination));
    assert.equal(typeof created?.ARN, "string");
    assert.equal(typeof created?.Name, "string");
    assert.equal(typeof created?.VersionId, "string");
    return Object.freeze({ ARN: created.ARN, Name: created.Name, VersionId: created.VersionId });
  } finally {
    sourceSecretText = undefined;
    sourceSecret = undefined;
    destination = undefined;
  }
}
