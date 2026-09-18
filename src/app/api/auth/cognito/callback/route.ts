import { cognitoProviderDisabledResponse, createRuntimeCognitoTransport, isCognitoRuntimeEnabled } from "@/lib/authentication/cognito-runtime-transport";

export async function GET(request: Request) {
  if (!isCognitoRuntimeEnabled()) return cognitoProviderDisabledResponse();
  return createRuntimeCognitoTransport().callback(request);
}
