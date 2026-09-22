export const COGNITO_REGIONS = ["us-east-1", "us-gov-east-1", "us-gov-west-1"] as const;

export type CognitoRegion = (typeof COGNITO_REGIONS)[number];

export function isCognitoRegion(value: string): value is CognitoRegion {
  return COGNITO_REGIONS.includes(value as CognitoRegion);
}

export function isGovCloudCognitoRegion(region: string) {
  return region === "us-gov-east-1" || region === "us-gov-west-1";
}

export function isCognitoPoolForRegion(userPoolId: string, region: string) {
  return isCognitoRegion(region) && new RegExp(`^${region.replaceAll("-", "\\-")}_[A-Za-z0-9]+$`).test(userPoolId);
}

export function cognitoIssuer(region: string, userPoolId: string) {
  if (!isCognitoPoolForRegion(userPoolId, region)) throw new Error("Invalid Cognito issuer target.");
  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
}

export function isCognitoIssuer(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password) return false;
    const match = url.hostname.match(/^cognito-idp\.(us-east-1|us-gov-east-1|us-gov-west-1)\.amazonaws\.com$/);
    const userPoolId = url.pathname.slice(1);
    return Boolean(match && !userPoolId.includes("/") && isCognitoPoolForRegion(userPoolId, match[1]));
  } catch {
    return false;
  }
}

export function cognitoManagedLoginOrigin(environment: "staging" | "production", account: string, region: string) {
  if (!isCognitoRegion(region) || !/^\d{12}$/.test(account)) throw new Error("Invalid Cognito managed-login target.");
  const label = isGovCloudCognitoRegion(region) ? "auth-fips" : "auth";
  return `https://tracepoint-${environment}-${account}.${label}.${region}.amazoncognito.com`;
}

export function cognitoSdkClientConfiguration(region: string) {
  if (!isCognitoRegion(region)) throw new Error("Unsupported Cognito region.");
  return { region, maxAttempts: 1, ...(isGovCloudCognitoRegion(region) ? { useFipsEndpoint: true } : {}) } as const;
}
