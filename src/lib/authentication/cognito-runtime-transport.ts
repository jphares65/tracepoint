import "server-only";

import { createCognitoSessionEstablisher } from "./cognito-establish";
import { createCognitoPkce } from "./cognito-pkce";
import { createCognitoRefreshRotator } from "./cognito-refresh";
import { parseCognitoRuntimeConfiguration } from "./cognito-runtime-configuration-core";
import { createCognitoTokenEndpoint } from "./cognito-token-endpoint";
import { createCognitoTransport } from "./cognito-transport";
import { PostgresIdentityMappingStore } from "./postgres-mapping";
import { PostgresCognitoRefreshStore, RefreshSessionSealer } from "./postgres-refresh-sessions";
import { PostgresCognitoSessionStore } from "./postgres-sessions";
import { AuthenticationStateSealer, PostgresAuthorizationTransactionStore } from "./postgres-transactions";
import { getPostgresPool } from "@/lib/database/postgres-pool";

export function createRuntimeCognitoTransport(environment = process.env) {
  const configuration = parseCognitoRuntimeConfiguration(environment);
  const pool = getPostgresPool(environment);
  const issuer = `https://cognito-idp.${configuration.verification.region}.amazonaws.com/${configuration.verification.userPoolId}`;
  const transactions = new PostgresAuthorizationTransactionStore(
    pool,
    new AuthenticationStateSealer(configuration.state.active, configuration.state.keys),
  );
  const mapping = new PostgresIdentityMappingStore(pool);
  const sessions = new PostgresCognitoSessionStore(pool);
  const refresh = new PostgresCognitoRefreshStore(
    pool,
    new RefreshSessionSealer(configuration.refresh.active, configuration.refresh.keys),
    { issuer, clientId: configuration.verification.clientId },
  );
  const endpoint = createCognitoTokenEndpoint(configuration.verification);
  const establish = createCognitoSessionEstablisher(configuration.verification, mapping, sessions, refresh);
  const rotate = createCognitoRefreshRotator(
    configuration.verification,
    mapping,
    sessions,
    refresh,
    endpoint.refresh,
  );
  const revoke = async (handle: string) => {
    const consumed = await refresh.consume(handle);
    if (!consumed) throw new Error("Cognito logout could not verify an active refresh session.");
    let providerError: unknown;
    try {
      await endpoint.revoke(consumed.refreshToken);
    } catch (error) {
      providerError = error;
    }
    // This is a single browser-session logout. The refresh family is the
    // browser credential; do not turn it into a global account logout.
    await refresh.revokeFamily(consumed.familyId, { userId: consumed.userId, issuer: consumed.issuer });
    if (providerError) throw new Error("Cognito provider revocation is unconfirmed.");
  };
  return createCognitoTransport(configuration.verification, {
    pkce: createCognitoPkce(configuration.verification, transactions),
    establish,
    rotate,
    revoke,
  }, { enabled: true });
}

export async function resolveRuntimeCognitoSession(handle: string, environment = process.env) {
  const configuration = parseCognitoRuntimeConfiguration(environment);
  const issuer = `https://cognito-idp.${configuration.verification.region}.amazonaws.com/${configuration.verification.userPoolId}`;
  const refresh = new PostgresCognitoRefreshStore(
    getPostgresPool(environment),
    new RefreshSessionSealer(configuration.refresh.active, configuration.refresh.keys),
    { issuer, clientId: configuration.verification.clientId },
  );
  return refresh.resolveReady(handle);
}

export function cognitoProviderDisabledResponse() {
  return Response.json(
    { code: "provider_disabled" },
    { status: 503, headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" } },
  );
}

export function isCognitoRuntimeEnabled(environment = process.env) {
  return environment.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native" &&
    environment.TRACEPOINT_DATA_PROVIDER === "postgres" &&
    environment.TRACEPOINT_AUTH_PROVIDER === "cognito";
}
