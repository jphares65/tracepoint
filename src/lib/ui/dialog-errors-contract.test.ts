import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// UX-RB2-7: a failure from a dialog is shown inside that dialog (role=alert) and
// the dialog stays open; before, it went to the page banner behind the backdrop.
// The staging migration image is built from a CRLF archive; the contracts compare LF source.
const read = async (path: string) => (await readFile(new URL(`../../app/${path}`, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
const body = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, start);
  return source.slice(from, source.indexOf(end, from));
};

test("UX-RB2-7 (E-01): invite, member and role-permission failures appear in their dialog", async () => {
  const page = await read("settings/page.tsx");
  assert.match(body(page, "function Modal({", "function RoleSelector("), /\{error \? \(\n\s*<div role="alert"/);
  for (const [start, end] of [["async function inviteUser()", "async function handleSendActivation("], ["async function saveMember()", "function beginEditRolePermissions("], ["async function saveRolePermissions()", "async function inviteUser()"]]) {
    const save = body(page, start, end);
    assert.doesNotMatch(save, /showNotice\(\s*"error"/, start);
    assert.match(save, /setDialogError\(error instanceof Error/, start);
  }
  assert.equal(page.match(/error=\{dialogError\}/g)?.length, 3);
});

test("UX-RB2-7 (B-49, B-R3): certification dialogs show their own failures and never stay stuck saving", async () => {
  const page = await read("training/certifications/page.tsx");
  for (const name of ["saveCredential", "saveType", "saveRequirement"]) {
    const save = body(page, `async function ${name}(`, "\n  }\n");
    assert.match(save, /setDialogError\(\n\s*payload\.error \|\|/, name);
    assert.match(save, /\} finally \{\n\s*setSaving\(false\);/, name);
    assert.doesNotMatch(save, /\bsetError\((?!"")/, name);
  }
  assert.equal(page.match(/\{dialogError\}/g)?.length, 3);
});

test("UX-RB2-7 (D-08): the vehicle dialog shows its failures and asks for the correction reason in a field", async () => {
  const page = await read("fleet-management/page.tsx");
  const save = body(page, "async function saveVehicle()", "\n  }\n");
  assert.doesNotMatch(save, /window\.prompt/);
  assert.doesNotMatch(save, /\bsetError\((?!"")/);
  assert.match(save, /setFormError\(READING_CORRECTION_REQUIRED\);/);
  assert.match(page, /\{formError \? \(\n\s*<div role="alert"/);
  assert.match(page, /label="Reason for the Mileage or Hours Correction"/);
});
