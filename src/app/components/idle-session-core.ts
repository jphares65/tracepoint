export const IDLE_SESSION_SIGN_OUT_PATH = "/auth/signout";

type IdleSessionDocument = Pick<Document, "body" | "createElement">;

// A form submission intentionally follows the normal navigation redirect chain:
// app-session revocation, Cognito hosted logout, then the user-facing login page.
export function submitIdleSessionExpiry(document: IdleSessionDocument) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = IDLE_SESSION_SIGN_OUT_PATH;
  form.hidden = true;
  document.body.append(form);
  form.submit();
}
