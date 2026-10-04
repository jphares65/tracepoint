import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { SimpleJwksCache, type Jwk } from "aws-jwt-verify/jwk";
import { createCognitoAuthenticationProvider } from "./cognito-verifier";
import { resolveVerifiedMobileBearer } from "./cognito-mobile-session-core";

const config = { environment: "staging" as const, account: "559054714699", region: "us-east-1", userPoolId: "us-east-1_Synthetic", clientId: "mobileclient" };
const issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
const userId = "11111111-1111-4111-8111-111111111111";
const subject = "22222222-2222-4222-8222-222222222222";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const cache = new SimpleJwksCache({ fetcher: { async fetch() { throw Error("network disabled"); } } });
cache.addJwks(`${issuer}/.well-known/jwks.json`, { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "mobile", alg: "RS256", use: "sig" } as Jwk] });

function token(patch: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ kid: "mobile", alg: "RS256" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iss: issuer, sub: subject, token_use: "access", client_id: config.clientId, iat: now, exp: now + 300, jti: "33333333-3333-4333-8333-333333333333", ...patch })).toString("base64url");
  const unsigned = `${header}.${body}`;
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`;
}

test("a verified mobile client token establishes, reuses, and logout invalidates its durable session", async () => {
  const durable = new Set<string>();
  const active = async (input: { tokenId: string; expiresAt?: number }) => {
    if (durable.has(input.tokenId)) return true;
    if (typeof input.expiresAt !== "number") return false;
    durable.add(input.tokenId);
    return true;
  };
  const mapping = { async findActive(receivedIssuer: string, receivedSubject: string) {
    return receivedIssuer === issuer && receivedSubject === subject ? { userId } : null;
  } };
  const provider = createCognitoAuthenticationProvider(config, mapping, active, { jwksCache: cache });
  const access = token();
  const first = await resolveVerifiedMobileBearer(access, provider, async () => true);
  const reuseOnly = createCognitoAuthenticationProvider(config, mapping, async (input) => durable.has(input.tokenId), { jwksCache: cache });
  const second = await resolveVerifiedMobileBearer(access, reuseOnly, async () => true);
  assert.deepEqual(first, { userId, provider: "cognito", issuer, subject, email: "", fullName: "" });
  assert.deepEqual(second, first);
  durable.clear();
  assert.equal(await resolveVerifiedMobileBearer(access, reuseOnly, async () => true), null);
});

test("invalid, wrong-client, expired, unlinked, and provider-revoked bearer credentials fail closed", async () => {
  const provider = createCognitoAuthenticationProvider(config, { async findActive() { return { userId }; } }, async () => true, { jwksCache: cache });
  const now = Math.floor(Date.now() / 1000);
  for (const access of [token({ client_id: "webclient" }), token({ exp: now - 1 }), `${token()}broken`]) {
    assert.equal(await resolveVerifiedMobileBearer(access, provider, async () => true), null);
  }
  assert.equal(await resolveVerifiedMobileBearer(token(), provider, async () => false), null);
  const unlinked = createCognitoAuthenticationProvider(config, { async findActive() { return null; } }, async () => true, { jwksCache: cache });
  assert.equal(await resolveVerifiedMobileBearer(token(), unlinked, async () => true), null);
});
