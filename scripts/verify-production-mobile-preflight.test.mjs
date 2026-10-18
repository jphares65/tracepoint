import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = await readFile(new URL("./verify-production-mobile-preflight.ps1", import.meta.url), "utf8");
const runner = await readFile(new URL("./run-aws-native-migrations.mjs", import.meta.url), "utf8");
const dockerfile = await readFile(new URL("../Dockerfile.aws-native-production", import.meta.url), "utf8");
const deployScript = await readFile(new URL("./deploy-app.ps1", import.meta.url), "utf8");
const migrationPublisher = await readFile(new URL("./apply-app-migrations.ps1", import.meta.url), "utf8");
const computeStack = await readFile(new URL("../infra/lib/compute-foundation-stack.ts", import.meta.url), "utf8");

test("production preflight pins account, role, and profile before any task launch", () => {
  assert.match(script, /\$profileName = 'tracepoint-production'/);
  assert.match(script, /\$account = '193644343389'/);
  assert.match(script, /\$expectedRole = 'TracePointMigrationProduction'/);
  assert.match(script, /identity\.Account -eq \$account/);
  assert.match(script, /assumed-role\/\$expectedRole/);
  assert.match(script, /TRACEPOINT_PRODUCTION_INSPECTION_AUTHORIZATION/);
  assert.match(script, /Get-OptionalPropertyValue \$target 'inspectionAuthorization'/);
  assert.match(script, /mobile-preflight-inspection/);
  assert.doesNotMatch(script, /TRACEPOINT_PRODUCTION_AUTHORIZATION/);
  assert.match(script, /expiresAt -gt \$now\.AddHours\(24\)/);
  assert.match(script, /AuthorizeOneOffInspection/);
  assert.match(script, /\$expectedMfaConfiguration = 'ON'/);
  assert.doesNotMatch(script, /SoftwareTokenMfaConfiguration|expectedSoftwareTokenMfaEnabled/);
  assert.match(script, /tracepoint:\/\/auth/);
  assert.match(script, /CallbackURLs\)\.Count -eq 1/);
  assert.match(script, /EnableTokenRevocation -eq \$true/);
  assert.doesNotMatch(script, /tracepoint:\/\/logout|LogoutURLs/);
  assert.ok(script.indexOf("if (-not $AuthorizeOneOffInspection") < script.indexOf("Invoke-AwsRead @('sts','get-caller-identity')"));
});

test("inspection task carries only the expected RDS host identity for in-task validation", () => {
  assert.match(script, /production database must expose the expected PostgreSQL endpoint and port/);
  assert.match(script, /TRACEPOINT_EXPECTED_DATABASE_HOST'; value=\[string\]\$db\.Endpoint\.Address/);
  assert.match(runner, /assertExpectedDatabaseHost\(secret\.host, process\.env\.TRACEPOINT_EXPECTED_DATABASE_HOST\)/);
  assert.match(runner, /current_database\(\)[\s\S]*inet_server_addr\(\)[\s\S]*inet_server_port\(\)[\s\S]*current_setting\('search_path'\)[\s\S]*current_user[\s\S]*session_user/);
  assert.match(runner, /DATABASE_TARGET_MISMATCH/);
  assert.doesNotMatch(runner, /console\.(?:error|log)\([^\n]*secret(?:\.host|\.password)/i);
});

test("database preflight is isolated from ECS Exec and injects only the runtime DB secret", () => {
  assert.doesNotMatch(script, /ecs execute-command|enableExecuteCommand|session-manager-plugin/i);
  assert.match(script, /tracepoint-production-mobile-inspection/);
  assert.match(script, /\$inspectionTaskFamily = "\$inspectionTaskFamilyPrefix-\$runId"/);
  assert.ok(script.indexOf("$runId = [Guid]::NewGuid()") < script.indexOf("$inspectionTaskFamily = \"$inspectionTaskFamilyPrefix-$runId\""));
  assert.ok(script.indexOf("$inspectionTaskFamily = \"$inspectionTaskFamilyPrefix-$runId\"") < script.indexOf("family = $inspectionTaskFamily"));
  assert.match(script, /ecs list-task-definitions/);
  assert.match(script, /registration result was ambiguous/);
  assert.match(script, /task launch result remains ambiguous/);
  assert.doesNotMatch(script, /taskRoleArn\s*=/);
  assert.match(script, /Get-OptionalPropertyValue \$registered\.taskDefinition 'taskRoleArn'/);
  assert.match(script, /TRACEPOINT_DATABASE_SECRET_JSON/);
  assert.match(script, /secrets = \$dbSecrets/);
  assert.match(script, /entryPoint = @\('\/nodejs\/bin\/node'\)/);
  assert.match(script, /command = @\('scripts\/run-aws-native-migrations\.mjs','mobile-preflight','production'\)/);
  assert.match(script, /user = '65532:65532'/);
  assert.match(script, /readonlyRootFilesystem = \$true/);
  assert.doesNotMatch(script, /GetSecretValue|SecretString|TARGET_DATABASE_SECRET_JSON/);
});

test("RDS backup validation targets the standalone production DB instance", () => {
  assert.match(script, /\[Parameter\(Mandatory\)\]\[string\]\$DatabaseInstanceIdentifier/);
  assert.match(script, /rds describe-db-instances/);
  assert.match(script, /--db-instance-identifier/);
  assert.match(script, /DBInstanceStatus -eq 'available'/);
  assert.match(script, /ResourceArn -eq \$db\.DBInstanceArn/);
  assert.match(script, /databaseInstanceArn = \$db\.DBInstanceArn/);
  assert.doesNotMatch(script, /describe-db-clusters|DBClusterArn|DatabaseClusterIdentifier/);
});

test("inspection network is explicit, operation-approved, and validated before launch", () => {
  const assignment = script.indexOf("$network = [pscustomobject]@{ subnets = @($InspectionSubnetIds)");
  const firstUse = script.indexOf("$network.securityGroups");
  assert.ok(assignment >= 0, "network configuration assignment must exist");
  assert.ok(firstUse >= 0, "security-group inspection must use network configuration");
  assert.ok(assignment < firstUse, "network configuration must be assigned before it is read");
  assert.match(script, /\$InspectionNetworkAuthorizationReference/);
  assert.match(script, /networkApproval\.connectivityVerified -ne \$true/);
  assert.match(script, /InspectionSubnetIds/);
  assert.match(script, /InspectionSecurityGroupIds/);
  assert.match(script, /InspectionAssignPublicIp/);
  assert.match(script, /networkConfiguration = @\{ awsvpcConfiguration = @\{ subnets = @\(\$InspectionSubnetIds\)/);
  assert.doesNotMatch(script, /networkConfiguration = \$service\.networkConfiguration/);
});
test("one-off mutation surface is explicitly approved and cannot touch the production service", () => {
  assert.match(script, /ecs register-task-definition/);
  assert.match(script, /ecs run-task/);
  assert.match(script, /ecs stop-task/);
  assert.match(script, /ecs deregister-task-definition/);
  assert.doesNotMatch(script, /ecs update-service|ecs delete-service|ecs update-cluster/);
  assert.match(script, /InspectionImageDigest/);
  assert.match(script, /\[Parameter\(Mandatory\)\]\[ValidatePattern\('\^\[0-9a-f\]\{40\}\$'\)\]\[string\]\$InspectionImageSourceCommit/);
  assert.match(script, /\$inspectionImageTag = "migration-\$InspectionImageSourceCommit-aws-native-production"/);
  assert.doesNotMatch(script, /\$inspectionImageTag = "migration-\$\(\$productionTarget\.imageTag\)/);
  assert.match(script, /imageTag=\$inspectionImageTag/);
  assert.match(script, /imageDigest -eq \$InspectionImageDigest/);
  assert.match(script, /\[Parameter\(Mandatory\)\]\[ValidatePattern\('\^arn:aws:iam::193644343389:role/);
  assert.match(script, /taskDefinition\.executionRoleArn -eq \$ExpectedExecutionRoleArn/);
  assert.doesNotMatch(script, /tracepoint-production-ecs-execution/);
  assert.match(computeStack, /roleName: `tracepoint-\$\{props\.environmentName\}-ecs-execution`/);
  assert.match(computeStack, /secretsmanager:GetSecretValue/);
  // The execution role reads only the application secret (one helper applies the same policy per role and secret).
  assert.match(computeStack, /resources: \[applicationSecret\.secretArn\]/);
  assert.match(computeStack, /configureExecutionRole\(this\.executionRole, this\.appSecrets\)/);
  assert.match(script, /awslogs-group/);
  assert.match(script, /ec2 describe-security-groups/);
  assert.match(script, /hasDatabaseEgress -and \$hasDatabaseIngress/);
  assert.match(script, /unrestricted public inbound traffic/);
  assert.match(script, /imageScanStatus\.status -eq 'COMPLETE'/);
  assert.match(script, /\$InspectionImageDigest -ne \$ExpectedProductionImageDigest/);
  assert.match(script, /if \(\$inspectionTaskArns\.Count -gt 0 -and -not \$taskStopped\)/);
  assert.match(script, /Temporary inspection task definition was retained/);
  assert.match(script, /ForEach-Object \{ \$_\.taskArn \}/);
});

test("migration preflight uses a production-only fixed read-only action", () => {
  assert.match(runner, /"mobile-preflight"/);
  const start = runner.indexOf("async function mobilePreflight");
  const end = runner.indexOf("async function rangeWorkspaceContract", start);
  assert.ok(start >= 0 && end > start);
  const body = runner.slice(start, end);
  assert.match(body, /requestedEnvironment !== "production"/);
  assert.match(body, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(body, /await inspectMigrationLedgerEvidence\(client, files\)/);
  assert.match(body, /migrationLineage\.blocked/);
  assert.match(body, /ledgerEvidence: migrationLineage/);
  assert.match(body, /current_user as database_user/);
  assert.match(body, /current_setting\('transaction_read_only'\)/);
  assert.match(body, /rolsuper as is_superuser/);
  assert.match(body, /role\.rolbypassrls as can_bypass_rls|principal_role\.rolbypassrls as can_bypass_rls/);
  assert.match(script, /databasePrincipal\.database_user -eq 'tracepoint_runtime'/);
  assert.match(body, /inspect\(client, \{ transactionAlreadyOpen: true \}\)/);
  assert.match(body, /await client\.query\("COMMIT"\)/);
  assert.match(body, /await client\.query\("ROLLBACK"\)/);
  assert.doesNotMatch(body, /ensureLedger|withLock|migrationSqlWithLedgerEntry|applyRangeWorkspaceHotfix/);
  assert.ok(body.indexOf('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY') < body.indexOf('await inspectMigrationLedgerEvidence(client, files)'));
  assert.ok(body.indexOf('await inspectMigrationLedgerEvidence(client, files)') < body.indexOf('await client.query("COMMIT")'));
  assert.match(runner, /action === "mobile-preflight" && requestedEnvironment !== "production"/);
  assert.ok(runner.indexOf('action === "mobile-preflight" && requestedEnvironment !== "production"') < runner.indexOf('client = await connect()'));
  assert.match(runner, /console\.error\(JSON\.stringify\(\{\s*status: "BLOCKED",\s*inspection: "read-only",\s*reason: "DATABASE_INSPECTION_FAILED",\s*failure: mobilePreflightFailureDetails\(mobilePreflightFailureStage, error\),\s*\.\.\.\(error\?\.migrationLineageEvidence \? \{ migrationLineage: error\.migrationLineageEvidence \} : \{\}\),\s*\}\)\)/);
  assert.doesNotMatch(runner, /console\.(?:error|log)\([^\n]*(?:error\.message|JSON\.stringify\(error\))/);
});

test("production image archive and runtime stage carry the inspection action and all SQL migrations", () => {
  assert.match(deployScript, /'database\/aws'[\s\S]*'scripts'[\s\S]*'Dockerfile\.aws-native-production'/);
  assert.match(dockerfile, /COPY --from=builder --chown=nonroot:nonroot \/app\/database\/aws \.\/database\/aws/);
  assert.match(dockerfile, /COPY --from=builder --chown=nonroot:nonroot \/app\/scripts\/run-aws-native-migrations\.mjs \.\/scripts\/run-aws-native-migrations\.mjs/);
  assert.match(dockerfile, /COPY --from=builder --chown=nonroot:nonroot \/app\/scripts\/aws-native-migration-inspection\.mjs \.\/scripts\/aws-native-migration-inspection\.mjs/);
  assert.match(dockerfile, /COPY --from=builder --chown=nonroot:nonroot \/app\/scripts\/aws-native-production-ledger-adoption\.mjs \.\/scripts\/aws-native-production-ledger-adoption\.mjs/);
  assert.match(migrationPublisher, /\$tag = "migration-\$Commit-aws-native-\$Environment"/);
  assert.match(migrationPublisher, /'database\/aws'[\s\S]*'scripts'[\s\S]*'Dockerfile\.aws-native-production'/);
  assert.match(script, /command = @\('scripts\/run-aws-native-migrations\.mjs','mobile-preflight','production'\)/);
  assert.match(script, /entryPoint = @\('\/nodejs\/bin\/node'\)/);
  assert.match(script, /user = '65532:65532'/);
});
