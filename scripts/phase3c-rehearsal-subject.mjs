// Cognito sub values are UUID-shaped, but Cognito does not promise a
// particular UUID version or variant. Match the runtime verifier contract.
export function isRehearsalCognitoSubject(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
