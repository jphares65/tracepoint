import "server-only";

import {
  CognitoIdentityProviderClient,
  GetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { getPostgresPool } from "@/lib/database/postgres-pool";
import type { AuthenticatedPrincipal } from "./request-session-core";
import { createCognitoAuthenticationProvider } from "./cognito-verifier";
import { parseCognitoTargetConfiguration } from "./cognito-runtime-configuration-core";
import { PostgresIdentityMappingStore } from "./postgres-mapping";
import { resolveVerifiedMobileBearer } from "./cognito-mobile-session-core";

export async function resolveRuntimeCognitoBearerPrincipal(
  accessToken: string,
  environment = process.env,
): Promise<AuthenticatedPrincipal | null> {
  const configuration = parseCognitoTargetConfiguration(environment);
  const mapping = new PostgresIdentityMappingStore(getPostgresPool(environment));
  const verifier = createCognitoAuthenticationProvider(
    configuration.verification,
    mapping,
    async () => true,
  );
  return resolveVerifiedMobileBearer(accessToken, verifier, async (token) => {
    const client = new CognitoIdentityProviderClient({
      region: configuration.verification.region,
      maxAttempts: 2,
    });
    const active = await client.send(new GetUserCommand({ AccessToken: token }));
    return Boolean(active.Username);
  });
}
