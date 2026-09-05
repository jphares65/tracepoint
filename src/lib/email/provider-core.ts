export type EmailRecipient = {
  email: string;
  name?: string;
};

export type EmailMessage = {
  to: EmailRecipient[];
  subject: string;
  htmlContent: string;
  textContent: string;
};

export type EmailSendResult = {
  messageId: string | null;
};

export interface EmailProvider {
  readonly name: "Brevo" | "SES";
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export class EmailProviderConfigurationError extends Error {}

export class EmailProviderResponseError extends Error {
  public readonly status: number;
  public readonly providerMessage: string | null;

  constructor(status: number, providerMessage: string | null) {
    super(providerMessage ?? `Email provider returned status ${status}.`);
    this.status = status;
    this.providerMessage = providerMessage;
  }
}

export class EmailDeliveryUnconfirmedError extends EmailProviderResponseError {
  constructor(message = 'Email delivery outcome is unconfirmed; reconcile provider events before retry.') { super(502, message); }
}

type EmailProviderEnvironment = {
  [key: string]: string | undefined;
  TRACEPOINT_EMAIL_PROVIDER?: string;
  BREVO_API_KEY?: string;
  TRACEPOINT_FROM_EMAIL?: string;
};

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function createEmailProvider(
  environment: EmailProviderEnvironment = process.env,
  options: { trimConfiguration?: boolean } = {},
): EmailProvider {
  const configuredProvider =
    environment.TRACEPOINT_EMAIL_PROVIDER?.trim().toLowerCase() || "brevo";

  if (configuredProvider !== "brevo") {
    throw new EmailProviderConfigurationError(
      `Email provider "${configuredProvider}" is not implemented.`,
    );
  }

  const rawApiKey = environment.BREVO_API_KEY;
  const rawFromEmail = environment.TRACEPOINT_FROM_EMAIL;

  if (!rawApiKey?.trim() || !rawFromEmail?.trim()) {
    throw new EmailProviderConfigurationError(
      "Brevo email delivery is not configured.",
    );
  }

  const trimConfiguration = options.trimConfiguration ?? true;
  const apiKey = trimConfiguration ? rawApiKey.trim() : rawApiKey;
  const fromEmail = trimConfiguration ? rawFromEmail.trim() : rawFromEmail;

  return {
    name: "Brevo",
    async send(message) {
      let response: Response;
      try { response = await fetch("https://api.brevo.com/v3/smtp/email", {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: { name: "TracePoint", email: fromEmail },
          to: message.to,
          subject: message.subject,
          htmlContent: message.htmlContent,
          textContent: message.textContent,
        }),
      });

      } catch { throw new EmailDeliveryUnconfirmedError(); }
      if (response.status >= 500 || response.status === 408) { await response.body?.cancel(); throw new EmailDeliveryUnconfirmedError(); }
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new EmailProviderResponseError(
          response.status,
          optionalText(payload?.message),
        );
      }

      const messageId = optionalText(payload?.messageId);
      if (!messageId) throw new EmailDeliveryUnconfirmedError();
      return { messageId };
    },
  };
}
