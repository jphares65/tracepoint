import { SendEmailCommand, type SendEmailCommandOutput } from '@aws-sdk/client-sesv2';
import { EmailProviderConfigurationError, EmailDeliveryUnconfirmedError, EmailProviderResponseError, type EmailMessage, type EmailProvider } from './provider-core';

export type SesTransport = {
  send(command: SendEmailCommand): Promise<Pick<SendEmailCommandOutput, 'MessageId'>>;
};
export type SesProviderOptions = {
  fromEmail: string;
  configurationSet: string;
  // Must cover application opt-outs plus imported/provider bounce and complaint suppression.
  // There is deliberately no permissive default and lookup failures block delivery.
  isSuppressed(email: string): Promise<boolean>;
  transport: SesTransport;
};
function address(value: string) {
  const normalized = value.trim();
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(normalized)) {
    throw new EmailProviderConfigurationError('SES requires an unambiguous email address.');
  }
  return normalized;
}
function mailbox(email: string, name?: string) {
  const value = address(email);
  if (!name?.trim()) return value;
  if (/[\r\n]/.test(name)) throw new EmailProviderConfigurationError('Invalid email display name.');
  return `=?UTF-8?B?${Buffer.from(name.trim()).toString('base64')}?= <${value}>`;
}

// Prepared adapter only. createEmailProvider and ECS startup still reject selecting SES.
// Enable only after sender/configuration-set, suppression persistence and event delivery pass live tests.
export class SesEmailProvider implements EmailProvider {
  readonly name = 'SES' as const;
  private readonly options: SesProviderOptions;
  constructor(options: SesProviderOptions) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.configurationSet) || typeof options.isSuppressed !== 'function') {
      throw new EmailProviderConfigurationError('SES configuration set and suppression lookup are required.');
    }
    this.options = { ...options, fromEmail: address(options.fromEmail) };
  }
  async send(message: EmailMessage) {
    if (!message.to.length || message.to.length > 50 || /[\r\n]/.test(message.subject)) {
      throw new EmailProviderConfigurationError('Invalid SES recipient count or subject.');
    }
    const recipients = message.to.map(recipient => ({ email: address(recipient.email), mailbox: mailbox(recipient.email, recipient.name) }));
    try {
      for (const recipient of recipients) {
        if (await this.options.isSuppressed(recipient.email.toLowerCase()) !== false) {
          throw new Error('Suppressed');
        }
      }
    } catch {
      throw new EmailProviderResponseError(409, 'Delivery blocked by suppression state or unavailable suppression lookup.');
    }
    try {
      const result = await this.options.transport.send(new SendEmailCommand({
        FromEmailAddress: `TracePoint <${this.options.fromEmail}>`,
        ConfigurationSetName: this.options.configurationSet,
        Destination: { ToAddresses: recipients.map(recipient => recipient.mailbox) },
        Content: { Simple: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: message.htmlContent, Charset: 'UTF-8' },
            Text: { Data: message.textContent, Charset: 'UTF-8' },
          },
        } },
      }));
      if (!result.MessageId) throw new Error('No acceptance identifier');
      return { messageId: result.MessageId };
    } catch {
      // Avoid logging recipient/content/provider diagnostic details. Do not automatically retry:
      // a timeout may occur after acceptance. Reconcile outbox/events before resending.
      throw new EmailDeliveryUnconfirmedError('SES delivery outcome is unconfirmed; reconcile provider events before retry.');
    }
  }
}
