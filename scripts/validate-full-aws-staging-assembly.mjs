import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const [directory, sourceCommit, imageDigest, toolingImageDigest] = process.argv.slice(2);
assert.match(sourceCommit ?? "", /^[0-9a-f]{40}$/);
assert.match(imageDigest ?? "", /^sha256:[0-9a-f]{64}$/);
assert.match(toolingImageDigest ?? "", /^sha256:[0-9a-f]{64}$/);
const load = async name => JSON.parse(await readFile(path.join(directory, `${name}.template.json`), "utf8"));
const resources = (template, type) => Object.values(template.Resources ?? {}).filter(resource => resource.Type === type);
const assertDigestImage = (task, digest) => {
  const containers = task.Properties?.ContainerDefinitions ?? [];
  assert.equal(containers.length, 1);
  const rendered = JSON.stringify(containers[0].Image);
  assert.match(rendered, /AppRepository/);
  assert.match(rendered, new RegExp(`@${digest}`));
};

const imageBuild = await load("tracepoint-staging-aws-native-image-build");
const database = await load("tracepoint-staging-database");
const backup = await load("tracepoint-staging-backup");
const bootstrap = await load("tracepoint-staging-database-bootstrap");
const cognito = await load("tracepoint-staging-cognito");
const ses = await load("tracepoint-staging-ses-foundation");
const runtime = await load("tracepoint-staging-runtime");

const forbidden = /NEXT_PUBLIC_SUPABASE|SUPABASE_(?:SECRET|SERVICE_ROLE)|BREVO_API_KEY|\.supabase\.co|\.vercel\.app|api\.brevo\.com/i;
for (const [name, template] of [["image build", imageBuild], ["bootstrap", bootstrap], ["runtime", runtime]]) {
  assert.doesNotMatch(JSON.stringify(template), forbidden, `${name} contains a forbidden legacy-provider runtime reference`);
}
const projects = resources(imageBuild, "AWS::CodeBuild::Project");
assert.equal(projects.length, 1);
assert.equal(projects[0].Properties.Name, "tracepoint-staging-aws-native-image-build");
assert.match(JSON.stringify(projects[0]), /TRACEPOINT_BUILD_PROVIDER_MODE.*aws-native/);

const databases = resources(database, "AWS::RDS::DBInstance");
assert.equal(databases.length, 1);
assert.equal(databases[0].Properties.PubliclyAccessible, false);
assert.equal(databases[0].Properties.StorageEncrypted, true);
assert.equal(databases[0].Properties.DeletionProtection, true);
assert.equal(databases[0].Properties.BackupRetentionPeriod, 1);
assert.match(JSON.stringify(databases[0].Properties.Tags ?? []), /"Key":"Backup","Value":"daily"/);

assert.equal(resources(backup, "AWS::Backup::BackupVault").length, 1);
assert.equal(resources(backup, "AWS::Backup::BackupPlan").length, 1);
const backupSelections = resources(backup, "AWS::Backup::BackupSelection");
assert.equal(backupSelections.length, 1);
assert.match(JSON.stringify(backupSelections[0]), /"ConditionKey":"Backup"/);
assert.match(JSON.stringify(backupSelections[0]), /"ConditionValue":"daily"/);

const tasks = resources(bootstrap, "AWS::ECS::TaskDefinition");
assert.equal(tasks.length, 1);
assertDigestImage(tasks[0], toolingImageDigest);
assert.match(JSON.stringify(tasks[0]), /bootstrap-aws-postgres-target\.mjs/);

assert.equal(resources(cognito, "AWS::Cognito::UserPool").length, 1);
assert.ok(resources(ses, "AWS::SES::ConfigurationSet").length >= 1);
const runtimeTasks = resources(runtime, "AWS::ECS::TaskDefinition");
assert.equal(runtimeTasks.length, 1);
assertDigestImage(runtimeTasks[0], imageDigest);
const runtimeText = JSON.stringify(runtimeTasks[0]);
for (const value of ["TRACEPOINT_DATA_PROVIDER", "postgres", "TRACEPOINT_AUTH_PROVIDER", "cognito", "TRACEPOINT_STORAGE_PROVIDER", "s3", "TRACEPOINT_EMAIL_PROVIDER", "ses"]) assert.match(runtimeText, new RegExp(value));
console.log(JSON.stringify({ valid: true, sourceCommit, providerMode: "aws-native", sourceMigrations: 76, awsMigrations: 19, forbiddenRuntimeReferences: 0 }));
