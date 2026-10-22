// A-65: fixed /login notices for sign-in and sign-out failures. Only these
// codes are rendered; any other ?notice= value shows nothing, so the URL can
// never inject text into the sign-in page.
export type LoginNotice = { tone: "error" | "info"; message: string };

const NOTICES: Record<string, LoginNotice> = {
  authorization_rejected: {
    tone: "error",
    message: "Sign-in did not finish. It may have timed out, been cancelled, or been opened twice. Try again.",
  },
  authorization_unavailable: {
    tone: "error",
    message: "Secure sign-in is temporarily unavailable. Wait a moment and try again.",
  },
  logout_unconfirmed: {
    tone: "info",
    message: "You were signed out on this device, but the sign-out could not be confirmed everywhere. On a shared device, close the browser.",
  },
  session_expired: {
    tone: "info",
    message: "Your session ended. Sign in again to continue.",
  },
};

export function loginNotice(code: unknown): LoginNotice | null {
  return typeof code === "string" && Object.hasOwn(NOTICES, code) ? NOTICES[code] : null;
}
