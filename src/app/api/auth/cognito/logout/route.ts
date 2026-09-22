import { cognitoProviderDisabledResponse, createRuntimeCognitoTransport, isCognitoRuntimeEnabled } from "@/lib/authentication/cognito-runtime-transport";

export async function POST(request: Request) {
  if (!isCognitoRuntimeEnabled()) return cognitoProviderDisabledResponse();
  return createRuntimeCognitoTransport().logout(request);
}
