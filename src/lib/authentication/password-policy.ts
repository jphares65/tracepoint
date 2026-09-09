export function isCognitoCompliantPassword(value: string) {
  return value.length >= 14 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value) &&
    /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^\sA-Za-z0-9]/.test(value);
}

export const COGNITO_PASSWORD_REQUIREMENTS =
  "Password must be 14–256 characters and include uppercase, lowercase, number, and symbol characters.";
