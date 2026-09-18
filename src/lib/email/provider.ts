import "server-only";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { getPostgresPool } from "@/lib/database/postgres-pool";
import { PostgresSesFeedbackStore } from "./ses-feedback-postgres";
import { ManagedSesProvider } from "./ses-managed-provider";
import {
  createEmailProvider as createBridgeEmailProvider,
  EmailProviderConfigurationError,
  type EmailProvider,
} from "./provider-core";
export * from "./provider-core";

type ServerEmailEnvironment = NodeJS.ProcessEnv & {
  TRACEPOINT_EMAIL_PROVIDER?: string;
  TRACEPOINT_FROM_EMAIL?: string;
  TRACEPOINT_SES_CONFIGURATION_SET?: string;
  AWS_REGION?: string;
};

export function createEmailProvider(
  environment: ServerEmailEnvironment = process.env,
  options: { trimConfiguration?: boolean; departmentId?: string } = {},
): EmailProvider {
  if ((environment.TRACEPOINT_EMAIL_PROVIDER?.trim().toLowerCase() || "brevo") !== "ses") {
    return createBridgeEmailProvider(environment, options);
  }
  if (!options.departmentId) throw new EmailProviderConfigurationError("SES requires a resolved department.");
  const fromEmail = environment.TRACEPOINT_FROM_EMAIL?.trim();
  const configurationSet = environment.TRACEPOINT_SES_CONFIGURATION_SET?.trim();
  const region = environment.AWS_REGION?.trim();
  if (!fromEmail || !configurationSet || !region || !["us-east-1", "us-gov-west-1", "us-gov-east-1"].includes(region)) {
    throw new EmailProviderConfigurationError("SES email delivery is not configured.");
  }
  return new ManagedSesProvider(
    { fromEmail, configurationSet, transport: new SESv2Client({ region, maxAttempts: 1 }) },
    new PostgresSesFeedbackStore(getPostgresPool(environment)),
    options.departmentId,
  );
}
