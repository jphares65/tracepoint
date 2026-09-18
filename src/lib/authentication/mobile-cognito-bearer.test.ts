import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";

import { SimpleJwksCache, type Jwk } from "aws-jwt-verify/jwk";

import {
  createMobileCognitoBearerResolver,
  isStagingCognitoBearerCandidate,
  type MobileCognitoSessionStore,
  stagingMobileCognitoConfiguration,
} from "./mobile-cognito-bearer";
import type { IdentityMappingStore } from "./provider-core";

const config = {
  environment: "staging" as const,
  account: "559054714699",
  region: "us-east-1",
  userPoolId: "us-east-1_Synthetic",
  clientId: "syntheticclient",
};
const issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
const subject = "cognito-subject-is-an-opaque-string";
const userId = "22222222-2222-4222-8222-222222222222";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const cache = new SimpleJwksCache({ fetcher: { async fetch() { throw Error("Network forbidden in unit tests"); } } });
cache.addJwks(`${issuer}/.well-known/jwks.json`, { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "mobile", alg: "RS256", use: "sig" } as Jwk] });

function token(patch: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ kid: "mobile", alg: "RS256" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: issuer,
    sub: subject,
    token_use: "access",
    client_id: config.clientId,
    iat: now,
    exp: now + 300,
    jti: "33333333-3333-4333-8333-333333333333",
    ...patch,
  })).toString("base64url");
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`;
}

function environment() {
  return {
    CONFIGURATION_ENVIRONMENT: "staging",
    TRACEPOINT_MOBILE_COGNITO_ENABLED: "true",
    TRACEPOINT_MOBILE_COGNITO_ACCOUNT: config.account,
    TRACEPOINT_MOBILE_COGNITO_REGION: config.region,
    TRACEPOINT_MOBILE_COGNITO_USER_POOL_ID: config.userPoolId,
    TRACEPOINT_MOBILE_COGNITO_CLIENT_ID: config.clientId,
} as unknown as NodeJS.ProcessEnv;
}

function resolver(mapping: IdentityMappingStore, active = true) {
  const sessions: MobileCognitoSessionStore = {
    isActive: async () => active,
    revokeToken: async () => true,
  };
  return createMobileCognitoBearerResolver(config, mapping, sessions, { jwksCache: cache });
}

test("staging Cognito candidate dispatch is issuer-only and non-Cognito Bearers remain eligible for Supabase", () => {
  const cognito = token();
  const supabase = `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ iss: "https://example.supabase.co/auth/v1" })).toString("base64url")}.signature`;
  assert.equal(isStagingCognitoBearerCandidate(cognito, environment()), true);
  assert.equal(isStagingCognitoBearerCandidate(supabase, environment()), false);
  assert.deepEqual(stagingMobileCognitoConfiguration(environment()), config);
});

test("a valid mapped Cognito access token resolves the stable TracePoint UUID", async () => {
  const principal = await resolver({ async findActive() { return { userId }; } }).resolve(token());
  assert.equal(principal?.userId, userId);
  assert.equal(principal?.provider, "cognito");
  assert.equal(principal?.subject, subject);
});

test("invalid, unmapped, and revoked Cognito access tokens fail closed", async () => {
  const valid = token();
  assert.equal(await resolver({ async findActive() { return null; } }).resolve(valid), null);
  assert.equal(await resolver({ async findActive() { return { userId }; } }, false).resolve(valid), null);
  assert.equal(await resolver({ async findActive() { return { userId }; } }).resolve(`${valid.slice(0, -8)}tampered`), null);
  assert.equal(await resolver({ async findActive() { return { userId }; } }).resolve(token({ token_use: "id", aud: config.clientId })), null);
});
