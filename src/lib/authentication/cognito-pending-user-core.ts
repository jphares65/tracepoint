import { CognitoDirectoryError, isCognitoDirectoryUsername } from "./cognito-admin-core";

// Email-sign-in pools require the email at create time. Cognito then assigns
// its own immutable Username/sub, which the invite lifecycle reconciles later.
export function pendingUserCreateInput(requestedUsername: string, emailValue: string, fullNameValue: string, temporaryPassword: string) {
  const email = emailValue.trim().toLowerCase();
  const fullName = fullNameValue.trim();
  if (!isCognitoDirectoryUsername(requestedUsername) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || !temporaryPassword)
    throw new CognitoDirectoryError("unavailable");
  return {
    Username: email,
    TemporaryPassword: temporaryPassword,
    MessageAction: "SUPPRESS" as const,
    ForceAliasCreation: false,
    UserAttributes: [{ Name: "email", Value: email }, { Name: "name", Value: fullName }],
  };
}
