import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmailProvider,
  EmailProviderConfigurationError,
  EmailProviderResponseError,
} from "./provider-core.ts";

test("defaults to Brevo and preserves its request contract", async (t) => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;

  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init };
    return Response.json({ messageId: "brevo-message-1" });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const provider = createEmailProvider({
    BREVO_API_KEY: " test-key ",
    TRACEPOINT_FROM_EMAIL: " sender@example.test ",
  });
  const result = await provider.send({
    to: [{ email: "recipient@example.test", name: "Recipient" }],
    subject: "Subject",
    htmlContent: "<p>Body</p>",
    textContent: "Body",
  });

  assert.equal(provider.name, "Brevo");
  assert.deepEqual(result, { messageId: "brevo-message-1" });
  assert.equal(request?.url, "https://api.brevo.com/v3/smtp/email");
  assert.deepEqual(request?.init?.headers, {
    "api-key": "test-key",
    "Content-Type": "application/json",
    Accept: "application/json",
  });
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    sender: { name: "TracePoint", email: "sender@example.test" },
    to: [{ email: "recipient@example.test", name: "Recipient" }],
    subject: "Subject",
    htmlContent: "<p>Body</p>",
    textContent: "Body",
  });
});

test("fails closed for unsupported providers", () => {
  assert.throws(
    () =>
      createEmailProvider({
        TRACEPOINT_EMAIL_PROVIDER: "ses",
        BREVO_API_KEY: "unused",
        TRACEPOINT_FROM_EMAIL: "unused@example.test",
      }),
    (error) =>
      error instanceof EmailProviderConfigurationError &&
      error.message === 'Email provider "ses" is not implemented.',
  );
});

test("fails closed when Brevo configuration is incomplete", () => {
  assert.throws(
    () => createEmailProvider({}),
    (error) =>
      error instanceof EmailProviderConfigurationError &&
      error.message === "Brevo email delivery is not configured.",
  );
});

test("retains Brevo response status and provider error message", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ message: "Rejected by provider" }, { status: 400 });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const provider = createEmailProvider({
    BREVO_API_KEY: "test-key",
    TRACEPOINT_FROM_EMAIL: "sender@example.test",
  });

  await assert.rejects(
    provider.send({
      to: [{ email: "recipient@example.test" }],
      subject: "Subject",
      htmlContent: "Body",
      textContent: "Body",
    }),
    (error) =>
      error instanceof EmailProviderResponseError &&
      error.status === 400 &&
      error.providerMessage === "Rejected by provider",
  );
});

test("can preserve legacy configuration whitespace for digest parity", async (t) => {
  const originalFetch = globalThis.fetch;
  let request: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    request = init;
    return Response.json({messageId:"synthetic-accepted"});
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const provider = createEmailProvider(
    {
      BREVO_API_KEY: " key-with-whitespace ",
      TRACEPOINT_FROM_EMAIL: " sender@example.test ",
    },
    { trimConfiguration: false },
  );
  await provider.send({
    to: [{ email: "recipient@example.test" }],
    subject: "Subject",
    htmlContent: "Body",
    textContent: "Body",
  });

  assert.equal(
    (request?.headers as Record<string, string>)["api-key"],
    " key-with-whitespace ",
  );
  assert.equal(
    JSON.parse(String(request?.body)).sender.email,
    " sender@example.test ",
  );
});
test('Brevo ambiguous outcomes are sanitized and never automatically retried', async (t) => {
 const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch});
 for(const mode of ['transport','server','missing-id']){let calls=0;globalThis.fetch=async()=>{calls++;if(mode==='transport')throw Error('private');return mode==='server'?Response.json({message:'private'},{status:503}):Response.json({});};
 const provider=createEmailProvider({BREVO_API_KEY:'synthetic',TRACEPOINT_FROM_EMAIL:'synthetic@example.invalid'});
 await assert.rejects(provider.send({to:[{email:'synthetic@example.invalid'}],subject:'Synthetic',htmlContent:'Synthetic',textContent:'Synthetic'}),error=>error instanceof Error&&error.message.includes('unconfirmed')&&!error.message.includes('private'));assert.equal(calls,1);
 }
});
