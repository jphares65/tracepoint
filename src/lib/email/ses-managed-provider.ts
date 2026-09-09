import { SesEmailProvider, type SesProviderOptions } from './ses-provider-core';
import { EmailDeliveryUnconfirmedError, type EmailMessage } from './provider-core';
import { parseSesFeedback, type SesFeedbackStore } from './ses-feedback';
import { verifySnsNotification } from './sns-notification';

// Prepared composition only: the live provider selector still rejects SES.
export class ManagedSesProvider {
  readonly name = 'SES' as const;
  private readonly provider: SesEmailProvider;
  constructor(options: Omit<SesProviderOptions, 'isSuppressed'>, private readonly store: SesFeedbackStore,
    private readonly departmentId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(departmentId)) throw new Error('A resolved department is required.');
    this.provider = new SesEmailProvider({ ...options, isSuppressed: email => store.isSuppressed(email) });
  }
  async send(message: EmailMessage) {
    const accepted = await this.provider.send(message);
    try { await this.store.recordAcceptance(accepted.messageId, this.departmentId, message.to.map(recipient => recipient.email)); }
    catch { throw new EmailDeliveryUnconfirmedError('SES accepted the message but persistence is unconfirmed; reconcile before retry.'); }
    return accepted;
  }
}

export async function processSesNotification(body: string, topicArn: string, account: string, store: SesFeedbackStore) {
  if (topicArn.split(':')[4] !== account) throw new Error('SNS feedback account mismatch.');
  const notification = await verifySnsNotification(body, topicArn);
  const event = parseSesFeedback(notification, account);
  return store.apply(event);
}
