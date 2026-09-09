import 'server-only';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SesEmailProvider, type SesProviderOptions } from './ses-provider-core';

// Not wired into the runtime selector. No long-lived credential parameter or custom endpoint.
export function createPreparedSesProvider(options: Omit<SesProviderOptions, 'transport'> & { region: string }) {
  if (!['us-east-1', 'us-gov-west-1', 'us-gov-east-1'].includes(options.region)) {
    throw new Error('SES region must be explicitly reviewed.');
  }
  return new SesEmailProvider({
    ...options,
    transport: new SESv2Client({ region: options.region, maxAttempts: 1 }),
  });
}
