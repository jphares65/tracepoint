import "server-only";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { getPostgresPool } from "@/lib/database/postgres-pool";
import { PostgresSesFeedbackStore } from "./ses-feedback-postgres";
import { ManagedSesProvider } from "./ses-managed-provider";
import { createShadowEmailProvider, notificationMode } from "./notification-mode";
import {
  createEmailProvider as createBridgeEmailProvider,
  EmailProviderConfigurationError,
  type EmailProvider,
} from "./provider-core";
export * from "./provider-core";

export function createEmailProvider(
  environment: NodeJS.ProcessEnv = process.env,
  options: { trimConfiguration?: boolean; departmentId?: string } = {},
): EmailProvider {
  let mode;
  try { mode = notificationMode(environment); }
  catch { throw new EmailProviderConfigurationError("Notification provider configuration is invalid."); }
  if (mode === "shadow") {
    return createShadowEmailProvider();
  }
  if (environment.TRACEPOINT_RUNTIME_PROVIDER_MODE !== "aws-native") {
    return createBridgeEmailProvider(environment, options);
  }
  if (!options.departmentId) throw new EmailProviderConfigurationError("SES requires a resolved department.");
  const fromEmail = environment.TRACEPOINT_FROM_EMAIL?.trim();
  const configurationSet = environment.TRACEPOINT_SES_CONFIGURATION_SET?.trim();
  const region = environment.AWS_REGION?.trim();
  if (!fromEmail || !configurationSet || region !== "us-east-1") {
    throw new EmailProviderConfigurationError("SES email delivery is not configured.");
  }
  return new ManagedSesProvider(
    { fromEmail, configurationSet, transport: new SESv2Client({ region, maxAttempts: 1 }) },
    new PostgresSesFeedbackStore(getPostgresPool(environment)),
    options.departmentId,
  );
}
