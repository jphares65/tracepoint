export const IDLE_SESSION_SIGN_OUT_PATH = "/auth/signout";

type IdleSessionDocument = Pick<Document, "body" | "createElement">;

// A form submission intentionally follows the normal navigation redirect chain:
// app-session revocation, Cognito hosted logout, then the user-facing login page.
// An automatic idle expiry passes the page the user was on (A-47/SV-32); the
// server validates it and hands it to the next sign-in. An explicit sign-out
// passes nothing.
export function submitIdleSessionExpiry(document: IdleSessionDocument, returnTo?: string | null) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = IDLE_SESSION_SIGN_OUT_PATH;
  form.hidden = true;
  if (returnTo) {
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = "next";
    field.value = returnTo;
    form.append(field);
  }
  document.body.append(form);
  form.submit();
}

export function currentReturnPath(location: Pick<Location, "pathname" | "search">) {
  return `${location.pathname}${location.search}`;
}
