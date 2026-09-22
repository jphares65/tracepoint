import assert from "node:assert/strict";
import test from "node:test";
import { assertIdentityMutationAllowed, createShadowEmailProvider, notificationMode } from "./notification-mode";

const native = {
  TRACEPOINT_RUNTIME_PROVIDER_MODE: "aws-native",
  TRACEPOINT_DATA_PROVIDER: "postgres",
  TRACEPOINT_AUTH_PROVIDER: "cognito",
  TRACEPOINT_STORAGE_PROVIDER: "s3",
  TRACEPOINT_EMAIL_PROVIDER: "ses",
  TRACEPOINT_NOTIFICATION_MODE: "shadow",
};

test("native shadow mode is explicit and fail closed", () => {
  assert.equal(notificationMode(native), "shadow");
  assert.throws(() => notificationMode({ ...native, TRACEPOINT_NOTIFICATION_MODE: undefined }));
  assert.throws(() => notificationMode({ ...native, TRACEPOINT_DATA_PROVIDER: "supabase" }));
  assert.throws(() => notificationMode({ ...native, TRACEPOINT_EMAIL_PROVIDER: "brevo" }));
  assert.throws(() => assertIdentityMutationAllowed(native), /Shadow identity mutation is disabled/);
  assert.doesNotThrow(() => assertIdentityMutationAllowed({ ...native, TRACEPOINT_NOTIFICATION_MODE: "normal" }));
});

test("bridge and ordinary production mode retain existing behavior", () => {
  assert.equal(notificationMode({}), "normal");
  assert.equal(notificationMode({ TRACEPOINT_NOTIFICATION_MODE: "normal" }), "normal");
  assert.throws(() => notificationMode({ TRACEPOINT_NOTIFICATION_MODE: "shadow" }));
});

test("shadow provider suppresses delivery and logs no recipient or message content", async () => {
  const messages: string[] = [];
  const original = console.info;
  console.info = (value) => { messages.push(String(value)); };
  try {
    await assert.rejects(createShadowEmailProvider().send({
      to: [{ email: "private@example.invalid" }],
      subject: "sensitive subject",
      htmlContent: "sensitive body",
      textContent: "sensitive body",
    }), /Shadow notification delivery is disabled/);
    assert.equal(messages.length, 1);
    assert.deepEqual(JSON.parse(messages[0]), { event: "shadow-notification-suppressed", recipientCount: 1 });
  } finally {
    console.info = original;
  }
});
