// Cognito requires both placeholders. Keep the temporary password alone on its line.
export const PRODUCTION_COGNITO_INVITATION_SUBJECT = 'Your temporary password';
export const PRODUCTION_COGNITO_INVITATION_BODY = [
  '<p>Welcome to TracePoint.</p>',
  '<p>Your username is:</p>',
  '<p>',
  '{username}',
  '</p>',
  '<p>Your temporary password is:</p>',
  '<p>',
  '{####}',
  '</p>',
  '<p>Sign in using your email address and the temporary password above. You will then be prompted to create a new password.</p>',
].join('\n');
