export type NotificationMode = "normal" | "shadow";
import { EmailProviderConfigurationError, type EmailProvider } from "./provider-core";

export function createShadowEmailProvider(): EmailProvider {
  return {
    name: "SES",
    async send(message) {
      console.info(JSON.stringify({ event: "shadow-notification-suppressed", recipientCount: message.to.length }));
      throw new EmailProviderConfigurationError("Shadow notification delivery is disabled.");
    },
  };
}

export function assertIdentityMutationAllowed(environment: Record<string, string | undefined> = process.env): void {
  if (notificationMode(environment) === "shadow") throw new Error("Shadow identity mutation is disabled.");
}

export function notificationMode(environment: Record<string, string | undefined>): NotificationMode {
  const configured = environment.TRACEPOINT_NOTIFICATION_MODE?.trim().toLowerCase();
  if (environment.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native") {
    if (environment.TRACEPOINT_DATA_PROVIDER !== "postgres" ||
        environment.TRACEPOINT_AUTH_PROVIDER !== "cognito" ||
        environment.TRACEPOINT_STORAGE_PROVIDER !== "s3" ||
        environment.TRACEPOINT_EMAIL_PROVIDER !== "ses" ||
        (configured !== "shadow" && configured !== "normal")) {
      throw new Error("Invalid AWS-native notification boundary.");
    }
    return configured;
  }
  if (configured && configured !== "normal") throw new Error("Shadow notifications require AWS-native mode.");
  return "normal";
}
