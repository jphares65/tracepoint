export const COGNITO_PASSWORD_MIN_LENGTH = 10;
export const COGNITO_PASSWORD_MAX_LENGTH = 256;
// Cognito's documented required-symbol set; an interior space can also satisfy it.
const COGNITO_SYMBOLS = new Set([
  "^", "$", "*", ".", "[", "]", "{", "}", "(", ")", "?", '"', "!", "@", "#", "%",
  "&", "/", "\\", ",", ">", "<", "'", ":", ";", "|", "_", "~", "`", "=", "+", "-",
]);

export function isCognitoCompliantPassword(value: string) {
  return value.length >= COGNITO_PASSWORD_MIN_LENGTH && value.length <= COGNITO_PASSWORD_MAX_LENGTH &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value) &&
    /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) &&
    Array.from(value).some((character, index) => COGNITO_SYMBOLS.has(character) ||
      (character === " " && index > 0 && index < value.length - 1));
}

export const COGNITO_PASSWORD_REQUIREMENTS =
  "Password must contain at least 10 characters (maximum 256), including an uppercase letter, a lowercase letter, a number, and a symbol.";
