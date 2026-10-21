import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { HELP_ARTICLES } from "./help-content.ts";
import { getRoutePermissionRequirement, meetsPermissionRequirement } from "../../lib/tracepoint/permissions.ts";

const article = (id: string) => {
  const found = HELP_ARTICLES.find((candidate) => candidate.id === id);
  assert.ok(found, id);
  return found;
};
const text = (id: string) => JSON.stringify(article(id));
const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("ADM-06: notification preferences are reachable by a member with no administrative permission", () => {
  const notifications = article("email-notifications");
  assert.equal(notifications.route, "/notifications");
  assert.ok(meetsPermissionRequirement([], getRoutePermissionRequirement("/notifications")));
  for (const candidate of HELP_ARTICLES.filter((item) => item.roles.includes("Officer"))) {
    assert.notEqual(candidate.route, "/settings", candidate.id);
  }
  const shell = source("../components/TracePointShell.tsx");
  assert.match(shell, /\{ label: "My Notifications", href: "\/notifications", icon: Bell \},/);
  const inbox = source("../notifications/page.tsx");
  assert.match(inbox, /<NotificationPreferencesPanel sources=\{sources\} onSaved=\{\(\) => void load\(\)\} \/>/);
  assert.doesNotMatch(inbox, /\/api\/notifications\/preferences/);
});

test("ADM-08/ADM-07: password help describes the secure sign-in page's Forgot your password? link", () => {
  assert.match(text("password-reset"), /Forgot your password\?/);
  assert.match(text("password-reset"), /authenticator app code is still required/);
  assert.doesNotMatch(text("password-reset"), /select Forgot password\./);
  assert.doesNotMatch(text("activate-account"), /14 days/);
});

test("ADM-08: live modules are not described as planned", () => {
  for (const id of ["agency-training", "fleet-status"]) {
    assert.equal(article(id).status, "Live", id);
    assert.doesNotMatch(text(id), /planned module|Coming soon|until the module is released/i, id);
  }
  assert.ok(HELP_ARTICLES.every((item) => item.status !== "Coming soon"));
  assert.ok(HELP_ARTICLES.every((item) => !JSON.stringify(item).includes("14-day")));
  assert.doesNotMatch(text("export-and-audit"), /when available/);
});

test("ADM-07 (verify): web sign-in hands off to Cognito managed login, whose pool offers email recovery", () => {
  assert.match(source("../login/LoginForm.tsx"), /providerMode === "aws-native"[\s\S]*<form action="\/api\/auth\/cognito\/login" method="post">/);
  assert.match(source("../../lib/authentication/cognito-pkce.ts"), /new URL\(domain\+'\/oauth2\/authorize'\)/);
  assert.match(source("../../../infra/lib/cognito-foundation-stack.ts"), /accountRecovery:cognito\.AccountRecovery\.EMAIL_ONLY/);
});

test("ADM-07: password help names the remedy for each account state", () => {
  const tip = String(article("password-reset").tip);
  assert.match(tip, /Before your first sign-in, Forgot your password\? cannot be used: ask a department administrator to select Send Activation/);
  assert.match(tip, /refused or no code arrives after your first sign-in, ask a department administrator to assign a password/);
});
