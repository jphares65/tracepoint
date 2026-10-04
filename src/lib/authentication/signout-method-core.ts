export const COGNITO_SIGN_OUT_ALLOWED_METHOD = "POST";

export function postOnlySignOutResponse() {
  return {
    body: { error: "Sign out requires POST." },
    init: {
      status: 405,
      headers: {
        Allow: COGNITO_SIGN_OUT_ALLOWED_METHOD,
        "Cache-Control": "no-store",
      },
    },
  };
}
