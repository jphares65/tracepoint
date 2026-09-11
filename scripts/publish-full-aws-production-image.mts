import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validateFullAwsProductionTarget, verifyFullAwsProductionIdentity, type FullAwsProductionTarget } from "../infra/lib/full-aws-production-target.ts";
import { validateAwsNativeApplicationSecret } from "./aws-native-application-secret-core.mjs";
import { productionArchivePaths, validateCleanProductionScan, validateProductionArchive } from "./production-publication-core.mjs";

const args = process.argv.slice(2);
const configIndex = args.indexOf("--config");
assert.ok(configIndex >= 0 && args[configIndex + 1], "Reviewed full-AWS production target file required");
const offline = args.includes("--validate-archive-only");
const target: FullAwsProductionTarget = validateFullAwsProductionTarget(
  JSON.parse(readFileSync(args[configIndex + 1], "utf8").replace(/^\uFEFF/, "")),
  { offline },
);
const root = resolve(import.meta.dirname, "..");
const command = (program: string, argv: string[]) => {
  try { return execFileSync(program, argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch { throw new Error("Full-AWS production publication command failed; details suppressed"); }
};
const aws = (argv: string[]) => JSON.parse(command("aws.exe", [...argv, "--region", "us-east-1", "--output", "json"]));
const identityGate = () => {
  if (process.env.TRACEPOINT_PRODUCTION_AUTHORIZATION !== target.deploymentAuthorization?.reference) throw new Error("Production approval reference mismatch");
  verifyFullAwsProductionIdentity(target, aws(["sts", "get-caller-identity"]), process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "");
};

const commit = command("git.exe", ["rev-parse", "HEAD"]);
assert.equal(target.imageTag, `${commit}-aws-native`, "Provider-qualified image tag must identify the reviewed checkout");
assert.equal(command("git.exe", ["status", "--porcelain", "--untracked-files=no", "--", ...productionArchivePaths]), "", "Production archive source has tracked changes");
if (!offline) {
  identityGate();
  const response = aws(["secretsmanager", "get-secret-value", "--secret-id", "tracepoint/production/application/aws-native"]);
  let secret;
  try { secret = JSON.parse(response.SecretString); } catch { throw new Error("AWS-native production secret could not be decoded; values suppressed"); }
  validateAwsNativeApplicationSecret(secret, "production");
  const repository = aws(["ecr", "describe-repositories", "--repository-names", "tracepoint-production"]).repositories[0];
  assert.equal(repository.registryId, target.account);
  assert.equal(repository.imageTagMutability, "IMMUTABLE");
}

const directory = mkdtempSync(join(tmpdir(), "tracepoint-full-aws-production-"));
const archive = join(directory, "source.zip");
try {
  command("git.exe", ["archive", "--format=zip", `--output=${archive}`, commit, "--", ...productionArchivePaths,
    ":(glob,exclude)**/*.backup-*", ":(glob,exclude)**/*.encoding-backup-*", ":(glob,exclude)**/*.before-*", ":(glob,exclude)**/*.bak", ":(glob,exclude)**/*.bak-*"]);
  const entries = command("tar.exe", ["-tf", archive]).split(/\r?\n/).filter(entry => !entry.endsWith("/"));
  const tracked = new Set(command("git.exe", ["ls-tree", "-r", "--name-only", commit]).split(/\r?\n/));
  const count = validateProductionArchive(entries, tracked);
  console.log(JSON.stringify({ archiveValidated: true, providerMode: "aws-native", sourceCommit: commit, imageTag: target.imageTag, trackedFiles: count, productionMutation: false }));
  if (!offline) {
    const existing = aws(["ecr", "batch-get-image", "--repository-name", "tracepoint-production", "--image-ids", `imageTag=${target.imageTag}`]);
    if (existing.images?.length === 1) {
      const scan = aws(["ecr", "describe-image-scan-findings", "--repository-name", "tracepoint-production", "--image-id", `imageTag=${target.imageTag}`]);
      validateCleanProductionScan(scan);
      console.log(JSON.stringify({ existingImmutableImage: true, providerMode: "aws-native", sourceCommit: commit, imageDigest: existing.images[0].imageId.imageDigest, cleanScan: true, productionMutation: false }));
    } else {
      assert.ok(existing.failures?.length === 1 && existing.failures[0].failureCode === "ImageNotFound", "Existing production image lookup failed");
      const bucket = `tracepoint-production-aws-native-build-source-${target.account}`;
      assert.equal(aws(["s3api", "get-bucket-versioning", "--bucket", bucket, "--expected-bucket-owner", target.account]).Status, "Enabled");
      identityGate();
      const version = aws(["s3api", "put-object", "--bucket", bucket, "--expected-bucket-owner", target.account, "--key", "source/tracepoint-production-aws-native-source.zip", "--body", archive]).VersionId;
      assert.ok(version && version !== "null");
      identityGate();
      const build = aws(["codebuild", "start-build", "--project-name", "tracepoint-production-aws-native-image-build", "--source-version", version,
        "--environment-variables-override", `name=IMAGE_TAG,value=${target.imageTag},type=PLAINTEXT`, `name=SOURCE_COMMIT,value=${commit},type=PLAINTEXT`]).build;
      assert.equal(build.arn.split(":")[4], target.account);
      console.log(JSON.stringify({ buildId: build.id, sourceVersion: version, sourceCommit: commit, imageTag: target.imageTag }));
      const deadline = Date.now() + 2_700_000;
      for (;;) {
        const status = aws(["codebuild", "batch-get-builds", "--ids", build.id]).builds[0].buildStatus;
        if (status === "SUCCEEDED") break;
        assert.equal(status, "IN_PROGRESS", "Production build failed");
        assert.ok(Date.now() < deadline, "Production build timed out");
        await new Promise(resolveWait => setTimeout(resolveWait, 20_000));
      }
      command("aws.exe", ["ecr", "wait", "image-scan-complete", "--repository-name", "tracepoint-production", "--image-id", `imageTag=${target.imageTag}`, "--region", "us-east-1"]);
      const scan = aws(["ecr", "describe-image-scan-findings", "--repository-name", "tracepoint-production", "--image-id", `imageTag=${target.imageTag}`]);
      validateCleanProductionScan(scan);
      assert.match(scan.imageId.imageDigest, /^sha256:[0-9a-f]{64}$/);
      console.log(JSON.stringify({ productionImagePublished: true, providerMode: "aws-native", sourceCommit: commit, imageTag: target.imageTag, imageDigest: scan.imageId.imageDigest, cleanScan: true, runtimeDeployed: false, dnsChanged: false }));
    }
  }
} finally {
  try { unlinkSync(archive); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  rmdirSync(directory);
}
