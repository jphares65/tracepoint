import assert from "node:assert/strict";
import test from "node:test";

import {
  cognitoIssuer,
  cognitoManagedLoginOrigin,
  cognitoSdkClientConfiguration,
  isCognitoIssuer,
  isCognitoPoolForRegion,
} from "./cognito-endpoints.ts";

test("commercial and GovCloud Cognito endpoints preserve their distinct security forms", () => {
  assert.equal(cognitoIssuer("us-east-1", "us-east-1_Example"), "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Example");
  assert.equal(cognitoManagedLoginOrigin("production", "222222222222", "us-east-1"), "https://tracepoint-production-222222222222.auth.us-east-1.amazoncognito.com");
  assert.deepEqual(cognitoSdkClientConfiguration("us-east-1"), { region: "us-east-1", maxAttempts: 1 });

  const govIssuer = "https://cognito-idp.us-gov-west-1.amazonaws.com/us-gov-west-1_Example";
  assert.equal(cognitoIssuer("us-gov-west-1", "us-gov-west-1_Example"), govIssuer);
  assert.equal(cognitoManagedLoginOrigin("production", "222222222222", "us-gov-west-1"), "https://tracepoint-production-222222222222.auth-fips.us-gov-west-1.amazoncognito.com");
  assert.deepEqual(cognitoSdkClientConfiguration("us-gov-west-1"), { region: "us-gov-west-1", maxAttempts: 1, useFipsEndpoint: true });
  assert.equal(isCognitoIssuer(govIssuer), true);
});

test("Cognito targets reject region/pool confusion and non-reviewed endpoints", () => {
  assert.equal(isCognitoPoolForRegion("us-east-1_Example", "us-gov-west-1"), false);
  for (const value of [
    "https://cognito-idp.us-gov-west-1.amazonaws.com/us-east-1_Example",
    "https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_Example",
    "https://cognito-idp.us-gov-west-1.amazonaws.com/us-gov-west-1_Example/extra",
  ]) assert.equal(isCognitoIssuer(value), false, value);
  assert.throws(() => cognitoSdkClientConfiguration("eu-west-1"), /Unsupported/);
});
